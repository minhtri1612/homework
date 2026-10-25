# Architecture

## Folders

```
src/
  server.js         entry point: load .env, open DB, applyMigrations(), listen on PORT (default 3000)
  app.js            createApp({ prisma }): builds the Express app (tests call this with their own DB)
  load-env.js       process.loadEnvFile() if .env exists; import first in every entry point
  vietnam-time.js   Vietnam time (UTC+7) <-> UTC ISO; date formatting for views
  shared/parser.js  syntax parser, used by browser AND server (see parser.md)
  config/client.js  createPrisma(): the Prisma client (libSQL adapter); isUniqueViolation()
  config/migrate.js applyMigrations(): runs prisma/migrations/*/migration.sql (see database.md)
  db/client.js      openDb(): plain libSQL client for migrations, db:reset and SQL in tests
  services/         data access + business rules on Prisma: teacher, session, homework, share-code, password
  generated/prisma/ output of prisma generate (gitignored)
  grading.js        computeScore(correct, total) (see grading.md)
  auth/             session cookie middleware, Origin check (see auth.md)
  routes/           Express routers: auth.js, teacher.js, student.js
  views/            EJS templates; partials/head.ejs and partials/foot.ejs wrap every page
  public/           static files: style.css, js/editor.js, js/copy.js
prisma/             schema.prisma + migrations/ (the database schema)
scripts/            CLI tools behind npm scripts: db-init.js, db-seed.js, parse.js
test/               node:test files (see testing.md)
examples/mau.txt    sample syntax text covering every format
data/               local SQLite file (data/*.db is gitignored)
```

There is no build step. Files under `src/public/` and `src/shared/` are served as-is.

## Request flow (`src/app.js`, in order)

1. `express.static(src/public)`: `/style.css`, `/js/editor.js`
2. `express.static(src/shared)` mounted at `/shared`: `/shared/parser.js` for the browser
3. `express.urlencoded({ extended: false, limit: '1mb' })`: forms only, no JSON body parser.
   1 MB because 200 long questions exceed the 100 KB default.
4. `loadTeacher(prisma)`: reads cookie `sid`, sets `req.teacher` / `res.locals.teacher` (or null)
5. `sameOriginPosts`: rejects POSTs whose `Origin` host differs from `Host` (403)
6. `GET /`, then `authRoutes(prisma)`, `teacherRoutes(prisma)`, `studentRoutes(prisma)`
7. 404 handler renders `error.ejs`; error handler logs and renders a generic Vietnamese 500.
   Express 5 forwards rejected promises from async handlers here, so routes do not need try/catch
   for unexpected errors.

`app.set('trust proxy', 1)` is set for Render's proxy (Step 8). `app.locals.formatDate` /
`formatDateTime` are available in every view.

## Routes

| Method | Path | File | Notes |
|---|---|---|---|
| GET | `/` | `app.js` | home; links differ when logged in |
| GET/POST | `/register` | `routes/auth.js` | logged-in users are redirected to `/teacher` |
| GET/POST | `/login` | `routes/auth.js` | |
| POST | `/logout` | `routes/auth.js` | deletes the session row, clears the cookie |
| GET | `/teacher` | `routes/teacher.js` | dashboard (`listHomeworks`) |
| GET | `/teacher/homeworks/new` | `routes/teacher.js` | empty editor |
| POST | `/teacher/homeworks` | `routes/teacher.js` | create → 302 `/teacher/homeworks/:id/edit?saved=new` |
| GET | `/teacher/homeworks/:id/edit` | `routes/teacher.js` | `?saved=1` / `?saved=new` / `?saved=vN` show a notice |
| POST | `/teacher/homeworks/:id` | `routes/teacher.js` | update → 302 back to edit page |
| GET | `/join?code=…` | `routes/student.js` | home-page code box (GET form) → 302 `/h/CODE`; bad/empty code → 400 home with error |
| GET | `/h/:code` | `routes/student.js` | student page; non-canonical code (lower case…) → 302 to `/h/CODE`; unknown → 404 |

Everything under `/teacher` goes through `requireTeacher` (302 to `/login`). Routes with `:id` use
`ownHomework()`, which returns a 404 page when the id is not a safe integer, does not exist, or
belongs to another teacher. Unknown and someone else's homework look the same on purpose.

The teacher router also sets `res.locals.siteUrl` (`req.protocol://host`) for the full student links;
it comes from the request's `Host` header (no configured public URL yet).

Student routes need no login. Share codes go through `normalizeShareCode()` (any case, spaces,
dashes, or a pasted `.../h/CODE` link). `/h/:code` uses `findSharedHomework()`, which returns no
questions or answers; for now the page shows title, teacher, question count, deadline / "Đã hết hạn
nộp bài", and a "(sắp có)" notice where answering will go.

Not built yet: answering and submitting (Step 6), results/CSV (Step 7), deleting a homework.

## Views (`src/views/`)

`home` (code box + teacher links), `register`, `login`, `dashboard`, `editor`, `share` (student page),
`error`, plus `partials/head` (topbar, logout form), `partials/foot` and `partials/share-link` (readonly
link box + copy button + "Xem trang học sinh"; pages using it also load `/js/copy.js`). Every page passes `title`. Use `<%= %>` (escaped) for all data; `<%- %>`
is only used for `include` and for `initialJson`, which is pre-escaped by `scriptJson()`.

## Server vs browser code

- Server only: everything in `src/` except `src/public/` and `src/shared/`.
- Browser only: `src/public/js/editor.js`, `src/public/js/copy.js` (ES modules, `<script type="module">`).
  `copy.js` un-hides the copy buttons and falls back to selecting the text when `navigator.clipboard`
  is unavailable (plain http other than localhost).
- Both: `src/shared/parser.js`. It must not import Node modules or use DOM APIs.

## Editor data flow (`views/editor.ejs` + `public/js/editor.js` + `routes/teacher.js`)

1. Server renders the form and embeds the questions (without ids) as JSON in
   `<script type="application/json" id="initial-questions">`, escaped with `scriptJson()`.
2. In the browser the **cards array is the source of truth**. Opening the "Cú pháp" tab runs
   `serialize(cards)` into the textarea; going back to "Dạng thẻ" (or "Chuyển sang dạng thẻ") runs
   `parse()` only if the text changed. A title found by the parser fills an empty title field, or offers
   a "Dùng làm tiêu đề" button.
3. On submit: completely blank cards are dropped; if any card has errors or there are none, submit
   is blocked. Otherwise the cards go into the hidden `questions` field as JSON
   (`[{ text, answers: [{ text, correct }], shuffleAnswers }]`).
4. Server `readEditorForm()` parses that JSON defensively (coerces types; unreadable JSON produces a
   `BAD_FORM` error), converts the deadline with `fromVietnamInput()`, then `createHomework` /
   `updateHomework` validate again. On validation failure the editor re-renders with status 400,
   the errors listed, and the teacher's input kept.
5. Settings fields: `title`, `revealMode` (radio), `deadline` (`datetime-local`, Vietnam time),
   `shuffleQuestions` (`'1'` when checked). The editor opens on the card tab when there are questions
   or errors, otherwise on the syntax tab (`data-start-tab`).

The editor needs JavaScript (a `<noscript>` notice says so). There is no test that runs `editor.js`
in a browser.
