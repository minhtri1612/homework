# CLAUDE.md

Index for agents and developers new to this repo. Details live in `.claude/docs/`; read the relevant
file before touching that area.

## Project Overview

Website for Vietnamese teachers to set single-correct-answer multiple-choice homework. Teachers
register, then write questions either as pasted text in a small syntax (`==` marks the correct answer)
or as editable cards, and share the homework by link (`/h/CODE`) or 6-character code. Students (no
account) open it; answering and server-side grading on a 10-point scale are Step 6, not built yet
(see `PLAN.md`).

## Tech Stack

- Node.js 24 (`.nvmrc`: `24`; `package.json` `engines`: `>=24`), ES modules (`"type": "module"`)
- Express `5.3.0`, server-rendered EJS `7.0.1` views, plain browser JavaScript (no bundler, no framework)
- `@libsql/client` `0.18.0`: SQLite file `data/local.db` locally, Turso when deployed
- Tests: built-in `node:test` + `node:assert/strict` (no test dependencies)
- Password hashing: `node:crypto` scrypt (no native modules)
- No linter or formatter configured; `.editorconfig` sets UTF-8, LF, 2-space indent

## Dev Commands

The project lives at `~/homework` inside WSL Ubuntu (Linux filesystem, not `/mnt/c`). Run `nvm use`
first so the Node version matches `.nvmrc`.

```bash
npm install                          # after any package.json change
npm run dev                          # http://localhost:3000, restarts on file changes (node --watch)
npm start                            # same without watch; PORT env var overrides 3000
npm test                             # node --test "test/**/*.test.js"
npm run db:init                      # create missing tables (idempotent)
npm run db:seed                      # sample teacher giaovien@example.com / matkhau123 + 2 homeworks
npm run db:reset                     # DROP all tables and recreate; refuses non-file: DATABASE_URL
npm run parse -- examples/mau.txt    # run the parser on a file (or pipe text on stdin)
```

`npm run dev` / `npm start` also create missing tables on startup (`src/server.js`).
Database selection: copy `.env.example` to `.env`; empty `DATABASE_URL` means `file:data/local.db`.

## Core Logic Summary

**Parser** (`src/shared/parser.js`, details in `.claude/docs/parser.md`):
- A question is its text plus 2–6 answers; exactly one answer starts with `==` (or `==` after the letter).
- Three accepted styles: plain lines (`==2` / `3` / `4`), lettered lines (`A.` `a)` `(A)` `A:`), and
  compact one-line (`1. A. cat   B. dog   ==C. pencil`).
- Questions are split by a blank line, by numbering (`1.`, `1)`, `Câu 1:`, `Bài 1 -`), or by heuristics.
- First line followed by a blank line is the homework title (unless it is an answer line).
- `parse()` never drops a line: problems become errors/warnings with line numbers. `serialize()` writes
  cards back as text that `parse()` reads back to the same questions.

**Grading** (decided, implemented in Step 6; see `.claude/docs/grading.md`):
`score = Math.round(correct * 40 / total) / 4`, i.e. `correct / total × 10` rounded to the **nearest**
0.25 (7.1 → 7, 7.13 → 7.25; an exact tie such as 7.125 goes up). Stored in `submissions.score` with
`correct_count` and `total_count`; a blank answer is `answer_id NULL` and counts as wrong.

## Key Constraints

- **Correct answers never reach a student's browser before submission.** `getHomework()` returns
  `answers[].correct` for the teacher and grading only. Student pages must strip it; grading happens
  on the server.
- **One parser for browser and server.** `src/shared/parser.js` is served to the browser at
  `/shared/parser.js` and imported by the server. It stays a dependency-free ES module with no Node or
  DOM APIs. Change it once, and the editor preview and the save-time validation change together.
- **The server re-validates everything.** `validateHomework()` in `src/db/homeworks.js` runs on every
  save; the browser check is only a convenience. Schema `CHECK`/`UNIQUE` constraints are a second line of defence.
- **Editing questions after submissions creates a new version** (`updateHomework`). Old submissions
  keep pointing at the old version's question/answer rows. Never update or delete rows of a version
  that has submissions. Settings (title, deadline, reveal mode, shuffle) are updated in place.
- **All UI text, error messages and the README are Vietnamese.** Code, comments and identifiers are English.
  Validation messages are written in Vietnamese at the source (parser, `validateHomework`, routes).
- **Times are stored as UTC ISO strings**; teachers type and read Vietnam time (UTC+7) via
  `src/vietnam-time.js`. Do not store local times.
- **Text is NFC-normalised** before comparing or storing (Vietnamese from macOS arrives as NFD).
- **Tests never touch `data/local.db`**; they use a fresh temp database (`test/helpers.js`).
- **Security rules in `.claude/docs/auth.md` are not optional**: hashed session tokens, Origin check
  on POST, ownership check (404) on every teacher route, EJS `<%= %>` escaping, `scriptJson()` for
  JSON inside `<script>`.
- **Work in `PLAN.md` steps.** Do one step, then stop and summarise for review; the user is a beginner
  and reviews each step. Update the step's checkboxes in `PLAN.md` to match what is actually done.
  Keep the README (Vietnamese) in sync with user-visible changes.
- **Commit and push only when the user says so.** Always report whether a push actually succeeded.
- Do not add dependencies without asking; the stack is deliberately small.

## Additional Documentation

- [.claude/docs/architecture.md](.claude/docs/architecture.md): folders, middleware order, routes, views, browser vs server code, editor data flow
- [.claude/docs/parser.md](.claude/docs/parser.md): syntax rules, splitting heuristics, title rule, error codes, normalisation, serialize round-trip
- [.claude/docs/database.md](.claude/docs/database.md): tables, constraints, homework versioning, validation limits, libSQL local vs Turso, scripts
- [.claude/docs/auth.md](.claude/docs/auth.md): teacher registration/login, sessions and cookies, CSRF/Origin check, ownership, escaping
- [.claude/docs/grading.md](.claude/docs/grading.md): what the schema fixes for scoring, reveal modes and shuffling; open decisions for Step 6
- [.claude/docs/testing.md](.claude/docs/testing.md): `node:test` layout, `startApp()` helper, how to add a test, known gaps
- `PLAN.md`: the 8-step plan and its current status
- `README.md`: user-facing setup and syntax guide (Vietnamese)
