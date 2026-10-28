# CLAUDE.md

Index for agents and developers new to this repo. Details live in `.claude/docs/`; read the relevant
file before touching that area.

## Project Overview

Website for Vietnamese teachers to set single-correct-answer multiple-choice homework. Teachers
register, then write questions either as pasted text in a small syntax (`==` marks the correct answer)
or as editable cards, and share the homework by link (`/h/CODE`) or 6-character code. Students (no
account) open it, enter a name, answer and submit; the server grades on a 10-point scale and shows the
result by a private link, revealing the answers according to the homework's reveal mode. A homework can
have a time limit: the server records when the student starts and the page submits by itself when time is up;
the teacher sees how often each student left the answer page and who started without submitting. Teachers see the results (per version,
per question), download them as CSV, and can delete a submission or a whole homework after a
confirmation. Everything is organised by grade (Lớp 6–12), each with three sections: Từ vựng and Ngữ pháp
(placeholders, no content yet) and Bài tập (the homeworks of that grade). Students browse publicly
(`/lop/12/bai-tap`); the teacher's dashboard uses the same structure plus a "Chưa xếp lớp" box. The site is
live on Render + Turso (see `PLAN.md`).

## Tech Stack

- Node.js 24 (`.nvmrc`: `24`; `package.json` `engines`: `>=24`), ES modules (`"type": "module"`)
- **TypeScript everywhere** (`src`, `scripts`, `test`), run by Node 24's built-in type stripping: `node src/server.ts`,
  no compile step for the server. Only erasable syntax (no `enum`, `namespace`, parameter properties) and
  imports name the real file (`./x.ts`). `tsc` (`7.0.2`, dev, with `@types/node` `24.19.2`, `@types/express`
  `5.0.6`) only type-checks (`npm run typecheck`, strict). `src/types/express.d.ts` types `req.prisma` /
  `req.teacher` / `req.sessionToken`.
- Express `5.3.0`, server-rendered EJS `7.0.1` views (untyped: a wrong variable in a view is only caught by
  tests). Browser code is TypeScript compiled by `tsc` to `dist/browser/` (no bundler, no framework).
- Prisma `7.10.1` (`prisma`, `@prisma/client`, `@prisma/adapter-libsql`) over `@libsql/client` `0.17.4`:
  SQLite file `data/local.db` locally, Turso when deployed. Services in `src/services/` query with Prisma
  Client; migrations are applied by our own `src/config/migrate.ts`
- `zod` `4.6.7`: form input schemas in `src/validation/` (shape and coercion only)
- Layers: `routes/web.ts` → `controllers/` → `services/` → Prisma; `req.prisma`, no global client
  (see `.claude/docs/architecture.md`)
- Tests: built-in `node:test` + `node:assert/strict` (no test dependencies)
- Password hashing: `node:crypto` scrypt (no native modules)
- No linter or formatter configured; `.editorconfig` sets UTF-8, LF, 2-space indent

## Dev Commands

The project lives at `~/homework` inside WSL Ubuntu (Linux filesystem, not `/mnt/c`). Run `nvm use`
first so the Node version matches `.nvmrc`.

```bash
npm install                          # after any package.json change
npm run dev                          # build:browser, then http://localhost:3000 with node --watch (server files only)
npm start                            # build:browser, then the same without watch; PORT env var overrides 3000
npm test                             # prisma generate + typecheck + build:browser, then node --test "test/**/*.test.ts"
npm run typecheck                    # tsc -p . (server) and tsc -p tsconfig.browser.json --noEmit (browser)
npm run build:browser                # compile parser.ts + src/public/js/*.ts to dist/browser/ (gitignored)
npm run build                        # prisma generate + build:browser (the deploy build)
npm run db:init                      # apply pending migrations (idempotent)
npm run db:seed                      # sample teacher giaovien@example.com / matkhau123 + 2 homeworks
npm run db:reset                     # DROP all tables + _migrations, re-apply; refuses non-file: DATABASE_URL
npm run db:migration -- <name>       # after editing prisma/schema.prisma: write the next migration (review it!)
npm run db:generate                  # regenerate the Prisma client (npm install and npm test do it too)
npm run smoke                        # one real cycle against the (Turso) database in .env, then cleans up
npm run parse -- examples/mau.txt    # run the parser on a file (or pipe text on stdin)
docker compose up --build            # the image on http://localhost:3000, local SQLite in volume homework-data
```

Docker (`Dockerfile`, `docker-compose.yml`, `.dockerignore`) is extra: the live site still deploys on Render
from GitHub. `.github/workflows/docker.yml` runs `npm test` on every push/PR and, on `main`, pushes
`minhtri16122004/homework:latest` + `:<sha>` to Docker Hub (repository secret `DOCKERHUB_TOKEN`). The image
defaults to `NODE_ENV=production`; compose overrides it to `development`. `.env` must stay out of the image.

`npm run dev` / `npm start` also apply pending migrations on startup (`src/server.ts`). The schema lives in
`prisma/migrations/*/migration.sql` (applied by `src/config/migrate.ts`), not in a `schema.sql`.
Database selection: copy `.env.example` to `.env`; empty `DATABASE_URL` means `file:data/local.db`.

## Core Logic Summary

**Parser** (`src/shared/parser.ts`, details in `.claude/docs/parser.md`):
- A question is its text plus 2–6 answers; exactly one answer starts with `==` (or `==` after the letter).
- Three accepted styles: plain lines (`==2` / `3` / `4`), lettered lines (`A.` `a)` `(A)` `A:`), and
  compact one-line (`1. A. cat   B. dog   ==C. pencil`).
- Questions are split by a blank line, by numbering (`1.`, `1)`, `Câu 1:`, `Bài 1 -`), or by heuristics.
- First line followed by a blank line is the homework title (unless it is an answer line).
- `parse()` never drops a line: problems become errors/warnings with line numbers. `serialize()` writes
  cards back as text that `parse()` reads back to the same questions.

**Grading** (`computeScore()` in `src/grading.ts`, used by `submitAnswers()`; see `.claude/docs/grading.md`):
`score = Math.round(correct * 40 / total) / 4`, i.e. `correct / total × 10` rounded to the **nearest**
0.25 (7.1 → 7, 7.13 → 7.25; an exact tie such as 7.125 goes up). Stored in `submissions.score` with
`correct_count` and `total_count`; a blank answer is `answer_id NULL` and counts as wrong.

## Key Constraints

- **Correct answers never reach a student's browser before submission.** `getHomework()` returns
  `answers[].correct` for the teacher and grading only. Student pages use `getQuestionsForStudent()` (no
  correct flag) and `getResult()` (correct answers only when `canReveal()`); grading happens on the server.
- **One parser for browser and server.** The server imports `src/shared/parser.ts`; the browser gets the
  same file compiled to `/shared/parser.js` (`npm run build:browser`). It stays a dependency-free module
  with no Node or DOM APIs (`tsconfig.browser.json` has no Node types; the server config has no DOM).
  Change it once, and the editor preview and the save-time validation change together.
  `test/browser-build.test.ts` fails if the served JavaScript is not the current build.
  `node --watch` does not rebuild browser code: restart `npm run dev` after editing it.
- **The server re-validates everything.** `validateHomework()` in `src/services/homework.service.ts` runs on every
  save; the browser check is only a convenience. Schema `CHECK`/`UNIQUE` constraints are a second line of defence.
- **Schema changes go through migrations.** Edit `prisma/schema.prisma`, run `npm run db:migration -- <name>`,
  then review the SQL: a `-- RedefineTables` migration silently drops the hand-written `CHECK`s,
  `COLLATE NOCASE` and the `answers_one_correct` index of that table, so add them back. Never edit an
  applied migration. Details: `.claude/docs/database.md`.
- **Time limits are enforced by the server** (`attempts.started_at`, `secondsLeft()`, 60 s `SUBMIT_GRACE_MS`
  for the limit and the deadline); the countdown in `answer.ts` is only a convenience. See `grading.md`.
- **Grades and sections are defined once in `src/catalog.ts`.** A homework with a `grade` is listed publicly
  in that grade's Bài tập (all teachers together); `grade` NULL ("Chưa xếp lớp") is reachable by link/code only.
  The grade is a setting: changing it never creates a version. Public lists use `listGradeHomeworks()`
  (no questions or answers).
- **Single server process assumed** for the share-code and new-version checks (see `database.md`).
- **Editing questions after submissions creates a new version** (`updateHomework`). Old submissions
  keep pointing at the old version's question/answer rows. Never update or delete rows of a version
  that has submissions. Settings (title, deadline, reveal mode, shuffle) are updated in place.
- **All UI text, error messages and the README are Vietnamese.** Code, comments and identifiers are English.
  Validation messages are written in Vietnamese at the source (parser, `validateHomework`, Zod schemas, controllers).
- **Times are stored as UTC ISO strings**; teachers type and read Vietnam time (UTC+7) via
  `src/vietnam-time.ts`. Do not store local times.
- **Text is NFC-normalised** before comparing or storing (Vietnamese from macOS arrives as NFD).
- **Tests never touch `data/local.db`**; they use a fresh temp database (`test/helpers.ts`).
- **Security rules in `.claude/docs/auth.md` are not optional**: hashed session tokens, Origin check
  on POST, ownership check (404) on every teacher route, EJS `<%= %>` escaping, `scriptJson()` for
  JSON inside `<script>`.
- **Work in `PLAN.md` steps.** Do one step, then stop and summarise for review; the user is a beginner
  and reviews each step. Update the step's checkboxes in `PLAN.md` to match what is actually done.
  Keep the README (Vietnamese) in sync with user-visible changes.
- **Deployed on Render + Turso** (README "Triển khai"). With `NODE_ENV=production` the server refuses to start
  without a Turso `DATABASE_URL`, `DATABASE_AUTH_TOKEN` and an `INVITE_CODE` of ≥ 12 characters
  (`src/config/production.ts`). Teacher registration requires the invite code when set; locally it is open.
  Never print, commit or paste tokens; `.env` is gitignored.
- **Every statement is a network round trip on Turso (~0.1–0.2 s).** Keep the number of statements per request
  and per transaction small and independent of input size (`createMany`, `createManyAndReturn`), never one
  statement per question or answer. Run `npm run smoke` against a throwaway Turso database after such changes.
- **Commit and push only when the user says so.** Always report whether a push actually succeeded.
- Do not add dependencies without asking; the stack is deliberately small.
- **Branch Managemnet**: Before adding any features or fix bugs, always work on a new git branch. Never commit directly on main. Bug branches must follow naming convention bug/[des], feature branches follow naming conveion feature/[desc]

## Additional Documentation

- [.claude/docs/architecture.md](.claude/docs/architecture.md): folders, middleware order, routes, views, layers, browser vs server code, editor data flow
- [.claude/docs/parser.md](.claude/docs/parser.md): syntax rules, splitting heuristics, title rule, error codes, normalisation, serialize round-trip
- [.claude/docs/database.md](.claude/docs/database.md): tables, constraints, homework versioning, validation limits, libSQL local vs Turso, scripts
- [.claude/docs/auth.md](.claude/docs/auth.md): teacher registration/login, sessions and cookies, CSRF/Origin check, ownership, escaping
- [.claude/docs/grading.md](.claude/docs/grading.md): score formula, Step 6 decisions (blank answers, names, shuffle, deadline, reveal, result link), submitting, teacher results and CSV
- [.claude/docs/testing.md](.claude/docs/testing.md): `node:test` layout, `startApp()` helper, how to add a test, known gaps
- `PLAN.md`: the 8-step plan and its current status
- `README.md`: user-facing setup and syntax guide (Vietnamese)
