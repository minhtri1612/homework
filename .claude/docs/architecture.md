# Architecture

## Folders

```
src/
  server.ts         entry point: load .env, open DB, applyMigrations(), listen on PORT (default 3000)
  app.ts            createApp({ prisma }): builds the Express app (tests call this with their own DB)
  load-env.ts       process.loadEnvFile() if .env exists; import first in every entry point
  vietnam-time.ts   Vietnam time (UTC+7) <-> UTC ISO; date formatting for views
  shared/parser.ts  syntax parser, used by browser (compiled) AND server (see parser.md)
  types/express.d.ts types of req.prisma, req.teacher, req.sessionToken
  config/client.ts  createPrisma() (the app's Prisma client, libSQL adapter), openDb() (plain libSQL
                    client for migrations, db:reset and SQL in tests), isUniqueViolation()
  config/migrate.ts applyMigrations(), dropSchema() (see database.md)
  routes/web.ts     every page: path → middleware → controller
  routes/status.ts  notFound (404) and serverError (500)
  middleware/       auth.ts (cookie, loadTeacher, requireTeacher), same-origin.ts (sameOriginPosts)
  controllers/      read req, call validation + services, render/redirect; no database queries
                    home, auth, homework (dashboard + editor), share (/join, /h/:code)
  validation/       Zod schemas: shape and coercion of form input, Vietnamese messages
                    form.ts (formText, formLine, fieldErrors), auth, homework, share
  services/         data access + business rules on Prisma: teacher, session, homework, share-code, password
  generated/prisma/ output of prisma generate (gitignored)
  grading.ts        computeScore(correct, total) (see grading.md)
  views/            EJS templates; partials/head.ejs and partials/foot.ejs wrap every page
  public/           style.css (served as-is) and js/editor.ts, js/copy.ts (browser code, compiled)
prisma/             schema.prisma + migrations/ (the database schema; see database.md)
prisma.config.js    settings for the Prisma CLI only
scripts/            CLI tools behind npm scripts: db-migrate.ts (db:init), db-reset.ts, db-seed.ts,
                    db-new-migration.ts (db:migration), parse.ts
test/               node:test files (see testing.md)
examples/mau.txt    sample syntax text covering every format
data/               local SQLite file (data/*.db is gitignored)
dist/browser/       output of npm run build:browser (gitignored)
tsconfig.json       type checking of src (except src/public), scripts, test; noEmit
tsconfig.browser.json compiles the browser code (DOM types, no Node types)
```

The server has no build step: Node 24 runs the `.ts` files by stripping the types. Only the browser code
is compiled:

| Source | Output | URL |
|---|---|---|
| `src/shared/parser.ts` | `dist/browser/shared/parser.js` | `/shared/parser.js` |
| `src/public/js/editor.ts` | `dist/browser/public/js/editor.js` | `/js/editor.js` |
| `src/public/js/copy.ts` | `dist/browser/public/js/copy.js` | `/js/copy.js` |
| `src/public/js/answer.ts` | `dist/browser/public/js/answer.js` | `/js/answer.js` |

`editor.ts` imports the parser by its URL (`'/shared/parser.js'`); `paths` in `tsconfig.browser.json`
points the type checker at `parser.ts`. `.ts` files are never served (404). `npm run build:browser`
runs before `dev`, `start` and `test`; the server warns at startup if `dist/browser` is missing.

## Request flow (`src/app.ts`, in order)

1. `express.static(dist/browser/public)`: `/js/editor.js`, `/js/copy.js`; `express.static(dist/browser/shared)`
   at `/shared`: `/shared/parser.js`; then `express.static(src/public)` for `/style.css`, skipping `*.ts`
2. `express.urlencoded({ extended: false, limit: '1mb' })`: forms only, no JSON body parser.
   1 MB because 200 long questions exceed the 100 KB default.
3. Sets `req.prisma` (the client passed to `createApp`). There is no global Prisma client: middleware and
   controllers use `req.prisma` and pass it to the services, so each test has its own database.
4. `loadTeacher`: reads cookie `sid`, sets `req.teacher` / `res.locals.teacher` (or null)
5. `sameOriginPosts`: rejects POSTs whose `Origin` host differs from `Host` (403)
6. `webRoutes()` (`routes/web.ts`)
7. `notFound` renders `error.ejs`; `serverError` logs and renders a generic Vietnamese 500.
   Express 5 forwards rejected promises from async handlers here, so controllers do not need try/catch
   for unexpected errors.

`app.set('trust proxy', 1)` is set for Render's proxy (Step 8). `app.locals.formatDate` /
`formatDateTime` are available in every view.

## Routes

All listed in `routes/web.ts`; controllers in `src/controllers/`.

| Method | Path | Controller | Notes |
|---|---|---|---|
| GET | `/healthz` | `status.healthz` (in `app.ts`) | `ok` when the database answers, 503 otherwise (Render health check) |
| GET | `/` | `home.getHomePage` | home; links differ when logged in |
| GET/POST | `/register` | `auth.getRegisterPage` / `postRegister` | logged-in users are redirected to `/teacher` |
| GET/POST | `/login` | `auth.getLoginPage` / `postLogin` | |
| POST | `/logout` | `auth.postLogout` | deletes the session row, clears the cookie |
| GET | `/teacher` | `homework.getDashboardPage` | dashboard (`listHomeworks`) |
| GET | `/teacher/homeworks/new` | `homework.getNewHomeworkPage` | empty editor |
| POST | `/teacher/homeworks` | `homework.postCreateHomework` | create → 302 `/teacher/homeworks/:id/edit?saved=new` |
| GET | `/teacher/homeworks/:id/edit` | `homework.getEditHomeworkPage` | `?saved=1` / `?saved=new` / `?saved=vN` show a notice |
| POST | `/teacher/homeworks/:id` | `homework.postUpdateHomework` | update → 302 back to edit page |
| GET | `/teacher/homeworks/:id/results?version=N` | `results.getResultsPage` | submissions (oldest first), average; version tabs when > 1 version; per-question stats for the selected version (the only one is selected automatically); unknown version 404 |
| GET | `/teacher/homeworks/:id/results.csv?version=N` | `results.getResultsCsv` | CSV attachment `ket-qua-CODE[-vN].csv` (see `grading.md`) |
| GET/POST | `/teacher/homeworks/:id/submissions/:submissionId/delete` | `results.getDeleteSubmissionPage` / `postDeleteSubmission` | confirmation page, then delete → 303 results `?notice=submission-deleted`; the name can submit again |
| GET/POST | `/teacher/homeworks/:id/delete` | `results.getDeleteHomeworkPage` / `postDeleteHomework` | confirmation page (checkbox required when there are submissions, checked in the delete transaction), then delete → 303 `/teacher?notice=homework-deleted` |
| GET | `/join?code=…` | `share.getJoin` | home-page code box (GET form) → 302 `/h/CODE`; bad/empty code → 400 home with error |
| GET | `/h/:code` | `share.getSharedHomework` | student start page (name form); non-canonical code (lower case…) → 302 to `/h/CODE`; unknown → 404 |
| GET | `/h/:code/answer?name=…` | `share.getAnswerPage` | questions without correct answers; bad name 400, name already used 409, closed 403 |
| POST | `/h/:code/submit` | `share.postSubmit` | grade + save → 303 to the result link, sets cookie `result_<CODE>`; closed 403, name used / questions changed 409, bad data 400 |
| GET | `/h/:code/result/:token` | `share.getResultPage` | score, and the answers when the reveal mode allows; unknown token 404 |

Everything under `/teacher` goes through `requireTeacher` (302 to `/login`) and `setSiteUrl`. Routes with
`:id` use `ownHomework()` (`homework.controller.ts`), which returns a 404 page when the id is not a
positive integer written plainly (`homeworkIdParam`: `abc`, `01`, `1e2` → 404), does not exist, or
belongs to another teacher. Unknown and someone else's homework look the same on purpose.

`setSiteUrl` sets `res.locals.siteUrl` (`req.protocol://host`) for the full student links;
it comes from the request's `Host` header (no configured public URL yet).

Student routes need no login. Share codes go through `joinSchema` / `shareCodeParam`
(`validation/share.schema.ts`), which use `normalizeShareCode()` (any case, spaces, dashes, or a pasted
`.../h/CODE` link). `/h/:code` uses `findSharedHomework()`, which returns no
questions or answers: title, teacher, question count, deadline or "Đã hết hạn nộp bài", the name form,
and this browser's last result link (cookie). Sub-routes with a lower-case code redirect (GET) to the
upper-case address, keeping the rest of the URL. The answer page uses `getQuestionsForStudent()`, which
builds each answer as `{ id, text }` only. Grading, reveal and the result link: `grading.md`.

Not built yet: deploying (Step 8).

## Views (`src/views/`)

`home` (code box + teacher links), `register`, `login`, `dashboard`, `editor`, `share` (student start page),
`answer` (questions, loads `/js/answer.js`), `result` (score and review, loads `/js/copy.js`),
`results` (teacher: table + per-question stats), `confirm-delete` (shared by both deletes: `lines`, `action`,
`cancel`, `button`, optional `check` label, `error`),
`error`, plus `partials/head` (topbar, logout form), `partials/foot` and `partials/share-link` (readonly
link box + copy button + "Xem trang học sinh"; pages using it also load `/js/copy.js`). Every page passes `title`. Use `<%= %>` (escaped) for all data; `<%- %>`
is only used for `include` and for `initialJson`, which is pre-escaped by `scriptJson()`.

## Layers (rules for new code)

Add a route to `routes/web.ts`, its handler to a controller, input parsing to a Zod schema in
`validation/`, and database work to a service. Controllers never query Prisma directly; schemas never
query the database (an "email already exists" check inside validation would reveal which emails
exist). Business rules (`validateHomework`, the parser's `validateQuestion`) stay in services, so the
server re-validates with the editor's messages. Security rules for new routes: `auth.md`.

## Server vs browser code

- Server only: everything in `src/` except `src/public/` and `src/shared/`.
- Browser only: `src/public/js/editor.ts`, `src/public/js/copy.ts`, compiled to ES modules loaded with
  `<script type="module">`. Element lookups are cast to their real types (`as HTMLInputElement`), which
  the checker cannot verify against the EJS views. `copy.ts` un-hides the copy buttons and falls back to selecting the text when `navigator.clipboard`
  is unavailable (plain http other than localhost).
- Both: `src/shared/parser.ts`. It must not import Node modules or use DOM APIs: the browser config has
  no Node types and the server config has no DOM types, so either mistake fails `npm run typecheck`.

## Editor data flow (`views/editor.ejs` + `public/js/editor.ts` + `controllers/homework.controller.ts`)

1. Server renders the form and embeds the questions (without ids) as JSON in
   `<script type="application/json" id="initial-questions">`, escaped with `scriptJson()`.
2. In the browser the **cards array is the source of truth**. Opening the "Cú pháp" tab runs
   `serialize(cards)` into the textarea; going back to "Dạng thẻ" (or "Chuyển sang dạng thẻ") runs
   `parse()` only if the text changed. A title found by the parser fills an empty title field, or offers
   a "Dùng làm tiêu đề" button.
3. On submit: completely blank cards are dropped; if any card has errors or there are none, submit
   is blocked. Otherwise the cards go into the hidden `questions` field as JSON
   (`[{ text, answers: [{ text, correct }], shuffleAnswers }]`).
4. Server `editorSchema` (`validation/homework.schema.ts`) parses that JSON defensively (coerces types,
   never fails; unreadable JSON sets `unreadable`, which the controller reports as a `BAD_FORM` error), converts the deadline with `fromVietnamInput()`, then `createHomework` /
   `updateHomework` validate again. On validation failure the editor re-renders with status 400,
   the errors listed, and the teacher's input kept.
5. Settings fields: `title`, `revealMode` (radio), `deadline` (`datetime-local`, Vietnam time),
   `shuffleQuestions` (`'1'` when checked). The editor opens on the card tab when there are questions
   or errors, otherwise on the syntax tab (`data-start-tab`).

The editor needs JavaScript (a `<noscript>` notice says so). There is no test that runs `editor.ts`
in a browser (`test/browser-build.test.ts` only checks that the served build is current).
