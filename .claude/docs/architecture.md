# Architecture

## Folders

```
src/
  server.ts         entry point: load .env, open DB, applyMigrations(), listen on PORT (default 3000)
  app.ts            createApp({ prisma }): builds the Express app (tests call this with their own DB)
  load-env.ts       process.loadEnvFile() if .env exists; import first in every entry point
  vietnam-time.ts   Vietnam time (UTC+7) <-> UTC ISO; date formatting for views
  shared/parser.js  syntax parser, used by browser AND server (see parser.md)
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
  public/           static files: style.css, js/editor.js, js/copy.js
prisma/             schema.prisma + migrations/ (the database schema; see database.md)
prisma.config.js    settings for the Prisma CLI only
scripts/            CLI tools behind npm scripts: db-migrate.ts (db:init), db-reset.ts, db-seed.ts,
                    db-new-migration.ts (db:migration), parse.ts
test/               node:test files (see testing.md)
examples/mau.txt    sample syntax text covering every format
data/               local SQLite file (data/*.db is gitignored)
```

There is no build step. Files under `src/public/` and `src/shared/` are served as-is.

## Request flow (`src/app.ts`, in order)

1. `express.static(src/public)`: `/style.css`, `/js/editor.js`
2. `express.static(src/shared)` mounted at `/shared`: `/shared/parser.js` for the browser
3. `express.urlencoded({ extended: false, limit: '1mb' })`: forms only, no JSON body parser.
   1 MB because 200 long questions exceed the 100 KB default.
4. Sets `req.prisma` (the client passed to `createApp`). There is no global Prisma client: middleware and
   controllers use `req.prisma` and pass it to the services, so each test has its own database.
5. `loadTeacher`: reads cookie `sid`, sets `req.teacher` / `res.locals.teacher` (or null)
6. `sameOriginPosts`: rejects POSTs whose `Origin` host differs from `Host` (403)
7. `webRoutes()` (`routes/web.ts`)
8. `notFound` renders `error.ejs`; `serverError` logs and renders a generic Vietnamese 500.
   Express 5 forwards rejected promises from async handlers here, so controllers do not need try/catch
   for unexpected errors.

`app.set('trust proxy', 1)` is set for Render's proxy (Step 8). `app.locals.formatDate` /
`formatDateTime` are available in every view.

## Routes

All listed in `routes/web.ts`; controllers in `src/controllers/`.

| Method | Path | Controller | Notes |
|---|---|---|---|
| GET | `/` | `home.getHomePage` | home; links differ when logged in |
| GET/POST | `/register` | `auth.getRegisterPage` / `postRegister` | logged-in users are redirected to `/teacher` |
| GET/POST | `/login` | `auth.getLoginPage` / `postLogin` | |
| POST | `/logout` | `auth.postLogout` | deletes the session row, clears the cookie |
| GET | `/teacher` | `homework.getDashboardPage` | dashboard (`listHomeworks`) |
| GET | `/teacher/homeworks/new` | `homework.getNewHomeworkPage` | empty editor |
| POST | `/teacher/homeworks` | `homework.postCreateHomework` | create → 302 `/teacher/homeworks/:id/edit?saved=new` |
| GET | `/teacher/homeworks/:id/edit` | `homework.getEditHomeworkPage` | `?saved=1` / `?saved=new` / `?saved=vN` show a notice |
| POST | `/teacher/homeworks/:id` | `homework.postUpdateHomework` | update → 302 back to edit page |
| GET | `/join?code=…` | `share.getJoin` | home-page code box (GET form) → 302 `/h/CODE`; bad/empty code → 400 home with error |
| GET | `/h/:code` | `share.getSharedHomework` | student page; non-canonical code (lower case…) → 302 to `/h/CODE`; unknown → 404 |

Everything under `/teacher` goes through `requireTeacher` (302 to `/login`) and `setSiteUrl`. Routes with
`:id` use `ownHomework()` (`homework.controller.ts`), which returns a 404 page when the id is not a
positive integer written plainly (`homeworkIdParam`: `abc`, `01`, `1e2` → 404), does not exist, or
belongs to another teacher. Unknown and someone else's homework look the same on purpose.

`setSiteUrl` sets `res.locals.siteUrl` (`req.protocol://host`) for the full student links;
it comes from the request's `Host` header (no configured public URL yet).

Student routes need no login. Share codes go through `joinSchema` / `shareCodeParam`
(`validation/share.schema.ts`), which use `normalizeShareCode()` (any case, spaces, dashes, or a pasted
`.../h/CODE` link). `/h/:code` uses `findSharedHomework()`, which returns no
questions or answers; for now the page shows title, teacher, question count, deadline / "Đã hết hạn
nộp bài", and a "(sắp có)" notice where answering will go.

Not built yet: answering and submitting (Step 6), results/CSV (Step 7), deleting a homework.

## Views (`src/views/`)

`home` (code box + teacher links), `register`, `login`, `dashboard`, `editor`, `share` (student page),
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
- Browser only: `src/public/js/editor.js`, `src/public/js/copy.js` (ES modules, `<script type="module">`).
  `copy.js` un-hides the copy buttons and falls back to selecting the text when `navigator.clipboard`
  is unavailable (plain http other than localhost).
- Both: `src/shared/parser.js`. It must not import Node modules or use DOM APIs.

## Editor data flow (`views/editor.ejs` + `public/js/editor.js` + `controllers/homework.controller.ts`)

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

The editor needs JavaScript (a `<noscript>` notice says so). There is no test that runs `editor.js`
in a browser.
