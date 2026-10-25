# Kế hoạch xây dựng (8 bước)

> Rebuilt on 2026-10-25 from the git history, README and session notes: the
> original plan was only in a chat that was lost. Steps 0–4 match the commits;
> the details listed under steps 5–8 are what the schema and README already
> imply, not the original wording.

## Next session (stopped 2026-10-25)

**Where we stopped:** Step 4.6 part 1 is committed and pushed (a9d31bf). Part 2 (config, services, validation in
TypeScript) is done, **not committed yet, waiting for review**. All 141 tests pass; `npm run typecheck` passes.

**Next: Step 4.6 part 3 (middleware, controllers, routes, app, server)**, after the user approves part 2.

**Decided 2026-10-25:**
- Step 4.6 uses Node 24's built-in TypeScript type stripping (no `tsx`).
- Grading ties round **up** (7.125 → 7.25). `computeScore()` in `src/grading.js` with tests; Step 6 uses it.

- [x] **Step 0 — Project setup**: Node 24, `.nvmrc`, `.editorconfig`, `.gitignore`, README (commit 63a380b)
- [x] **Step 1 — Parser**: `src/shared/parser.js` (3 syntax styles, title line, errors with line numbers,
      Unicode normalisation, `serialize`), `npm run parse`, `test/parser.test.js` (commits 63a380b, 19ee034)
- [x] **Step 2 — Database**: `src/db/schema.sql` (8 tables, versions), `createHomework` / `getHomework`
      with server-side validation, `db:init` / `db:seed` / `db:reset`, scrypt passwords, `test/db.test.js` (commit 27681cb)
- [x] **Step 3 — Teacher accounts**: register / login / logout, hashed session tokens, Origin check,
      dashboard, `test/auth.test.js` (commit 88873ad)
- [x] **Step 4 — Homework editor**: syntax tab + card tab, settings (reveal mode, Vietnam-time deadline,
      shuffle), new version when questions change after submissions, `test/editor.test.js` (commit 4622932)
- [x] **Step 4.5 — Refactor to LaptopShop architecture** (confirmed 2026-10-25; done, see below)
  - [x] part 1: Prisma schema + migrations alongside the app
  - [x] part 2: migrations replace `schema.sql`
  - [x] part 3: services on Prisma
  - [x] part 4: validation + controllers + routes
  - [x] part 5: scripts, docs, cleanup
- [ ] **Step 4.6 — Convert to TypeScript** (parts 1–2 of 6 done, see below) ← **next**
- [x] **Step 5 — Sharing**: link `/h/CODE` and a "nhập mã" box on the home page (commit 2258768)
  - [x] `/h/CODE` finds the homework (code typed in any letter case), 404 in Vietnamese otherwise
  - [x] code entry form on the home page
  - [x] teacher sees and can copy the full link (dashboard + editor)
- [ ] **Step 6 — Student flow**: enter name, answer, submit, get the score
  - [ ] questions sent without the correct answers; question/answer shuffling
  - [ ] one attempt per name (`student_key`), deadline enforced
  - [ ] server-side grading on a 10-point scale, rounded to the nearest 0.25, saved in `submissions` / `submission_answers`
  - [ ] result page following the reveal mode (after submit / after deadline / never)
- [ ] **Step 7 — Results for the teacher**: submissions list per homework, per-version view, CSV export
- [ ] **Step 8 — Deploy**: Render (web service) + Turso (database), production settings

---

## Step 4.5 — Refactor to LaptopShop architecture

Goal: `routes → controllers → services → Prisma`, Zod schemas in `src/validation/`,
`prisma/schema.prisma` + `prisma/migrations/`, the same layout as `~/LaptopShop`. JavaScript stays; SQLite
locally and Turso in production stay; `src/shared/parser.js` is not touched; behaviour does not change.
LaptopShop is a **structure** reference only. Its auth, sessions, CORS and validation code are not copied.

### Facts checked on 2026-10-25 (npm registry + a throwaway install of Prisma 7.10.1)

- Stable Prisma is **7.10.1** (`prisma`, `@prisma/client`, `@prisma/adapter-libsql`). npm's `latest` tag for
  `prisma` points to **8.0.0-rc.27** (a release candidate), so a plain `npm install prisma` would pull an RC.
  Pin exact versions.
- Turso/libSQL works through the driver adapter `PrismaLibSql` (`@prisma/adapter-libsql`), which takes
  `{ url, authToken }`. The same adapter works with a local `file:` URL (tested).
- The Prisma 7 generator `prisma-client` writes **TypeScript** files to an `output` folder. Plain JavaScript
  on Node 24 can import them directly (built-in type stripping, no warnings; tested). They must live outside
  `node_modules`, where Node does not strip types.
- `prisma.config.js` (not only `.ts`) is accepted.
- Tested with the adapter: foreign keys, including the two-column `submission_answers → answers(id, question_id)`,
  are enforced (P2003); `$transaction(async (tx) => …)` rolls back on error; `$queryRaw` works.
- **Migrations to Turso:** Prisma's own docs and Turso's say `prisma migrate dev`/`deploy` do not work against
  Turso. Their workflow is to generate the SQL with Prisma and apply it with the Turso CLI.
  `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` generates
  the next migration from the folder alone, with no database or shadow database (tested).
- Things Prisma cannot express in `schema.prisma`: `CHECK` constraints, `COLLATE NOCASE`, and the partial unique index
  `answers_one_correct … WHERE is_correct = 1`. Written by hand in the migration SQL, they cause **no** drift in
  `migrate diff` (tested).
- **A `dbgenerated("(strftime(...))")` default causes false drift.** `migrate diff` then rebuilds the whole
  table every time, even with no change (tested). So timestamps get no DB default; the services set them
  (`new Date().toISOString()`, the same format as today).
- `@prisma/adapter-libsql@7.10.1` depends on `@libsql/client ^0.17.0`. With our `0.18.0`, npm installs both
  (two native binaries). Plan: pin `@libsql/client` to `0.17.4` so there is one copy.
- npm 11 blocks Prisma's own install scripts by default (`allowScripts` warning). `prisma generate` and
  `prisma migrate diff` still worked without them.

### Target folder layout

```
prisma/
  schema.prisma                 models (below); the source of truth instead of src/db/schema.sql
  migrations/
    20261025000000_init/migration.sql   generated by migrate diff + hand-added CHECK/COLLATE/partial index
    migration_lock.toml          provider = "sqlite"
prisma.config.js                schema + migrations paths, datasource url (for the Prisma CLI only)
src/
  server.js                     load .env, apply pending migrations, createPrisma(), listen
  app.js                        createApp({ prisma }): middleware, routes/web.js, routes/status.js
  config/
    client.js                   createPrisma({ url, authToken }) → PrismaClient with PrismaLibSql adapter
    migrate.js                  applyMigrations({ url, authToken }): runs pending prisma/migrations/*/migration.sql
  generated/prisma/             output of `prisma generate` (gitignored, TypeScript, imported from JS)
  routes/
    web.js                      every page route in one list: path → middleware → controller
    status.js                   404 and 500 handlers
  controllers/                  read req, call validation + services, render/redirect; no DB access
    home.controller.js          GET /
    auth.controller.js          register / login / logout
    homework.controller.js      dashboard + editor (create, edit, save)
    share.controller.js         /join, /h/:code
  services/                     business rules + Prisma queries; first argument is the PrismaClient (or tx)
    password.service.js         scrypt hash/verify (from src/auth/password.js, unchanged logic)
    teacher.service.js          createTeacher, findTeacherByEmail
    session.service.js          createSession, findSessionTeacher, deleteSession
    homework.service.js         validateHomework, create/update (versioning), get, list, findSharedHomework
    share-code.service.js       generateShareCode, normalizeShareCode
  validation/                   Zod schemas: shape and coercion of form input, Vietnamese messages
    auth.schema.js              register, login
    homework.schema.js          editor form (today's readEditorForm) and :id param
    share.schema.js             join code
  middleware/
    auth.js                     loadTeacher, requireTeacher, cookie name/options
    same-origin.js              sameOriginPosts
  shared/parser.js              UNCHANGED
  vietnam-time.js, load-env.js  unchanged
  views/, public/               unchanged
scripts/  db-migrate.js (db:init), db-reset.js, db-seed.js, db-new-migration.js, parse.js
test/     same files; only DB setup and direct-SQL lines change (see risks)
```

Deliberate differences from LaptopShop:
- **No global Prisma singleton.** `createApp({ prisma })` receives the client and services take it as the first
  argument, as `db` is passed today. Every test file keeps its own temporary database.
- **Validation is shape-only.** Zod schemas never query the database: no "email already exists" refine like
  LaptopShop's `register.schema.ts`, because a DB call inside validation leaks which emails exist.
- **Business rules stay in services.** `validateHomework` and the parser's `validateQuestion` stay there, so the
  server still re-validates everything with the same Vietnamese messages.
- **Our own sessions stay.** Hashed tokens, our cookie and the Origin check remain; no express-session or
  passport. No `cors()`, no `express.json()`.

### Prisma schema (converted from src/db/schema.sql)

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "sqlite"   // url comes from prisma.config.js (CLI) / the adapter (app)
}

// Times are UTC ISO 8601 text set by the services (no DB default: see "false drift" above).

model Teacher {
  id           Int        @id @default(autoincrement())
  email        String     @unique                 // + COLLATE NOCASE in migration SQL
  name         String
  passwordHash String     @map("password_hash")
  createdAt    String     @map("created_at")
  sessions     Session[]
  homeworks    Homework[]
  @@map("teachers")
}

model Session {
  id        String  @id                            // SHA-256 hex of the cookie token
  teacherId Int     @map("teacher_id")
  teacher   Teacher @relation(fields: [teacherId], references: [id], onDelete: Cascade)
  createdAt String  @map("created_at")
  expiresAt String  @map("expires_at")
  @@index([teacherId], map: "sessions_teacher")
  @@map("sessions")
}

model Homework {
  id               Int               @id @default(autoincrement())
  teacherId        Int               @map("teacher_id")
  teacher          Teacher           @relation(fields: [teacherId], references: [id], onDelete: Cascade)
  title            String                                   // CHECK (trim(title) <> '')
  shareCode        String            @unique @map("share_code")
  revealMode       String            @default("after_submit") @map("reveal_mode") // CHECK IN (...)
  deadline         String?
  shuffleQuestions Boolean           @default(false) @map("shuffle_questions")
  createdAt        String            @map("created_at")
  updatedAt        String            @map("updated_at")
  versions         HomeworkVersion[]
  submissions      Submission[]
  // CHECK (reveal_mode <> 'after_deadline' OR deadline IS NOT NULL)
  @@index([teacherId], map: "homeworks_teacher")
  @@map("homeworks")
}

model HomeworkVersion {
  id          Int          @id @default(autoincrement())
  homeworkId  Int          @map("homework_id")
  homework    Homework     @relation(fields: [homeworkId], references: [id], onDelete: Cascade)
  number      Int                                         // CHECK (number >= 1)
  createdAt   String       @map("created_at")
  questions   Question[]
  submissions Submission[]
  @@unique([homeworkId, number])
  @@map("homework_versions")
}

model Question {
  id                Int                @id @default(autoincrement())
  versionId         Int                @map("version_id")
  version           HomeworkVersion    @relation(fields: [versionId], references: [id], onDelete: Cascade)
  position          Int
  text              String             @default("")
  shuffleAnswers    Boolean            @default(false) @map("shuffle_answers")
  answers           Answer[]
  submissionAnswers SubmissionAnswer[]
  @@unique([versionId, position])
  @@map("questions")
}

model Answer {
  id         Int                @id @default(autoincrement())
  questionId Int                @map("question_id")
  question   Question           @relation(fields: [questionId], references: [id], onDelete: Cascade)
  position   Int                                           // 1 = A
  text       String                                        // CHECK (trim(text) <> '')
  isCorrect  Boolean            @default(false) @map("is_correct")
  chosenIn   SubmissionAnswer[]
  @@unique([questionId, position])
  @@unique([id, questionId])      // target of the two-column FK below
  // + CREATE UNIQUE INDEX answers_one_correct ON answers(question_id) WHERE is_correct = 1  (hand-written)
  @@map("answers")
}

model Submission {
  id           Int                @id @default(autoincrement())
  homeworkId   Int                @map("homework_id")
  homework     Homework           @relation(fields: [homeworkId], references: [id], onDelete: Cascade)
  versionId    Int                @map("version_id")
  version      HomeworkVersion    @relation(fields: [versionId], references: [id], onDelete: Cascade)
  studentName  String             @map("student_name")    // CHECK (trim(student_name) <> '')
  studentKey   String             @map("student_key")
  startedAt    String?            @map("started_at")
  submittedAt  String             @map("submitted_at")
  correctCount Int                @map("correct_count")   // CHECK (correct_count >= 0)
  totalCount   Int                @map("total_count")     // CHECK (total_count >= correct_count)
  score        Float                                      // CHECK (score BETWEEN 0 AND 10)
  answers      SubmissionAnswer[]
  @@unique([homeworkId, studentKey])
  @@map("submissions")
}

model SubmissionAnswer {
  submissionId Int        @map("submission_id")
  submission   Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  questionId   Int        @map("question_id")
  question     Question   @relation(fields: [questionId], references: [id], onDelete: Cascade)
  answerId     Int?       @map("answer_id")                // NULL = left blank
  // NoAction, not Prisma's default Restrict: Restrict would block deleting a homework that has
  // submissions, because the cascade removes answers before their submission_answers rows.
  answer       Answer?    @relation(fields: [answerId, questionId], references: [id, questionId], onDelete: NoAction, onUpdate: NoAction)
  @@id([submissionId, questionId])
  @@map("submission_answers")
}
```

Hand-added to `20261025000000_init/migration.sql` (Prisma ignores them, tested): every `CHECK` listed in the
comments, plus the `IN (0, 1)` checks on the three booleans, `COLLATE NOCASE` on `teachers.email`, and the
partial index `answers_one_correct`. Table and column names stay the same as today.

Two schema changes that don't alter behaviour:
- Prisma writes `INTEGER PRIMARY KEY AUTOINCREMENT`, so ids of deleted rows are never reused (today they can be).
- Booleans are declared `BOOLEAN`, which SQLite stores as 0/1 as before; Prisma returns JS booleans.

### How migrations are applied (local, tests, Turso)

- **One applier for all three:** `applyMigrations()` in `src/config/migrate.js` runs every
  `prisma/migrations/*/migration.sql` that is not yet recorded in a table `_migrations(name, checksum, applied_at)`.
  It runs in name order, one migration per transaction, using `@libsql/client` (the same client the adapter uses,
  so `file:` and `libsql://` behave the same).
  - It fails if an already-applied file was edited (checksum mismatch).
  - It is called by `src/server.js` on startup (as `initSchema` is today), by `npm run db:init`, and by
    `test/helpers.js`. A Render deploy therefore migrates Turso without the Turso CLI.
- **Creating a migration:** edit `schema.prisma`, then `npm run db:migration -- <name>`. That runs
  `prisma migrate diff --from-migrations … --to-schema … --script` into a new timestamped folder, which is then
  **reviewed by hand** (see the RedefineTables risk).
- `prisma migrate dev` / `prisma migrate deploy` are **not used**: deploy cannot reach Turso, and dev keeps its
  own history table, which would conflict with `_migrations`.
- Alternative, if you prefer: write Prisma-compatible rows into `_prisma_migrations` so `prisma migrate status`
  works locally. More code, same result.

### Files that change

| Action | Files |
|---|---|
| new | `prisma/schema.prisma`, `prisma/migrations/20261025000000_init/migration.sql`, `prisma/migrations/migration_lock.toml`, `prisma.config.js` |
| new | `src/config/client.js`, `src/config/migrate.js`, `src/routes/web.js`, `src/routes/status.js` |
| new | `src/controllers/{home,auth,homework,share}.controller.js` |
| new | `src/services/{password,teacher,session,homework,share-code}.service.js` |
| new | `src/validation/{auth,homework,share}.schema.js`, `src/middleware/{auth,same-origin}.js` |
| new | `scripts/db-migrate.js`, `scripts/db-reset.js`, `scripts/db-new-migration.js` |
| rewritten | `src/app.js`, `src/server.js`, `scripts/db-seed.js`, `test/helpers.js` |
| removed | `src/db/` (client, schema.sql, homeworks, teachers, sessions), `src/auth/`, `src/routes/{auth,teacher,student}.js`, `scripts/db-init.js` |
| tests: setup/imports/direct SQL only | `test/db.test.js`, `test/auth.test.js`, `test/editor.test.js`, `test/share.test.js` |
| config | `package.json` (deps + scripts), `package-lock.json`, `.gitignore` (`src/generated/`) |
| docs | `README.md` (commands, folder tree), `CLAUDE.md`, `.claude/docs/{architecture,database,auth,testing}.md` |
| **unchanged** | `src/shared/parser.js`, `test/parser.test.js`, `src/views/**`, `src/public/**`, `src/vietnam-time.js`, `src/load-env.js`, `.env.example` |

New dependencies, all pinned exact: `prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-libsql@7.10.1`, `zod@4.6.7`.
`@libsql/client` goes from 0.18.0 to 0.17.4. `prisma` is a normal dependency, not a dev one, so Render can run
`prisma generate` while building. Scripts: `"postinstall": "prisma generate"`, `"db:generate"`, `"db:migration"`;
`db:init` / `db:reset` / `db:seed` keep their names.

### Risks

1. **Tests are 114, not 94.** Step 5 added 20 tests and is not committed yet. The bar becomes "all 114 still
   pass", so Step 5 should be committed (after review) before the refactor starts.
2. **Tests do change beyond direct SQL.** Their imports point at `src/db/*.js` and `src/auth/password.js`, which
   move. The HTTP assertions do not change. Direct SQL (`db.execute(...)`) keeps working through a raw libSQL
   client that `startApp()` exposes next to `prisma`.
3. **Transaction behaviour.** Today `db.transaction('write')` takes the write lock immediately (`BEGIN IMMEDIATE`).
   Prisma's libSQL adapter serializes transactions inside one process with a mutex. Two things stay protected
   either way: the share code (by the UNIQUE constraint; on P2002 we retry) and the "submissions exist → new
   version" check (safe while every write to submissions also runs in a transaction). It would not hold with
   several server instances. Render runs one, but this is to be verified with a test in the refactor.
4. **Transaction timeout.** Prisma's interactive transactions time out after 5 s by default. A 200-question save
   is about 400 statements; over Turso's network round trips that can exceed 5 s. So: one nested create per
   question, `timeout: 30_000`, and a test that saves 200 questions.
5. **RedefineTables.** When a future change needs SQLite to rebuild a table, Prisma drops and recreates it from
   `schema.prisma`, **silently losing** the hand-written CHECK / COLLATE / partial index on that table. Every
   generated migration must be reviewed, with the lost constraints re-added. This rule goes into `database.md`
   and `CLAUDE.md`.
6. **RESTRICT trap.** If the two-column FK is left at Prisma's default, deleting a homework that has submissions
   fails. The schema above sets NoAction; a new test deletes a homework with submissions.
7. **Generated TypeScript.** It relies on Node ≥ 24 type stripping (`.nvmrc` is 24) and on `prisma generate`
   having run (`postinstall`). Forgetting to regenerate after a schema change gives confusing errors.
   `npm test` runs `prisma generate` first.
8. **Existing local data.** `data/local.db` was built from `schema.sql` and has no `_migrations` table. Run
   `npm run db:reset && npm run db:seed` once (only sample data is lost). Turso has no data yet (Step 8).
9. **Zod messages must match exactly.** Registration shows one Vietnamese message per field, in today's
   priority order, and the tests check the texts. The schemas need custom messages and "first issue per field"
   mapping; any wording drift fails tests (good: it is caught).
10. **Turso itself is not tested before Step 8.** Everything above was tested with `file:` URLs. Optionally,
    `turso dev` (a local libSQL server over HTTP) would test the network path without an account, but it needs
    the Turso CLI installed. Ask before installing.
11. **Cost.** Four dependencies, a generate step and generated code, for no behaviour change. The benefit is the
    same structure as LaptopShop.

### Refactor plan (each step ends with `npm test` green; one commit per step after review)

Decisions (2026-10-25): own `_migrations` table; deps approved and pinned; `turso dev` skipped, Turso is tested in
Step 8. Baseline: 114 tests (Step 5 committed as 2258768).

- [x] 1. **Prisma in parallel, unused.** Install the pinned deps, add `prisma.config.js` and `schema.prisma`, generate
   `20261025000000_init` with `migrate diff --from-empty`, hand-add the constraints, add `src/config/migrate.js`
   and `.gitignore`. Check, once: a DB built from the migration has the same tables, columns, indexes and CHECKs
   as one built from `schema.sql` (compare `sqlite_master`), and `migrate diff --from-migrations` reports
   "empty migration".
   Done: parity check showed only the expected differences (PK `NOT NULL`, `BOOLEAN` instead of `INTEGER`,
   timestamp defaults removed); `migrate diff` reports an empty migration; `test/migrate.test.js` adds 9 tests
   (123 total, all passing).
- [x] 2. **Migrations replace `schema.sql`.** `server.js`, `db:init`, `db:reset` and `test/helpers.js` use
   `applyMigrations()`. The raw-SQL code sets `created_at`/`updated_at`/`submitted_at` explicitly. Delete
   `schema.sql` and `initSchema`. Tests prove the new schema is equivalent.
   Done: also `db:seed` and `test/db.test.js`; `dropSchema()` drops `_migrations`; teachers, sessions,
   homeworks and versions get their timestamps from `new Date().toISOString()`; test inserts into
   `submissions`/`homeworks` set them. The whole suite (126) runs on the migrated schema. Local DB was
   reset and re-seeded; a second `db:init` applies nothing; `npm start` serves `/` (200).
- [x] 3. **Services on Prisma.** `src/config/client.js`, then `password`, `teacher`, `session`, `share-code` and
   `homework` services, each a port of today's function with the same inputs and outputs.
   - `createApp({ prisma })`; tests switch imports.
   - New tests: delete a homework that has submissions; save 200 questions; applying migrations twice changes
     nothing.
   Done: services take the PrismaClient (or `tx`) first; writes use `$transaction(fn, { timeout: 30_000 })`.
   Share-code check stays inside the transaction (adapter runs them one at a time; UNIQUE backs it up) rather
   than retry-on-P2002. The registration race now checks Prisma's `P2002` code. The old modules are deleted
   now rather than in part 4, since nothing used them; `src/db/client.js` (`openDb`, for migrations and
   SQL in tests) and `src/auth/middleware.js` stay until parts 4–5. Tests: 200 questions × 6 answers at max
   length (~0.35 s locally); 10 parallel creates + 2 parallel edits (risk 3); deleting a homework with
   submissions through Prisma (risk 6). "Migrations twice" was already covered (`migrate.test.js`, `db.test.js`).
   Manual check with the seeded DB: login, dashboard, share page, editor, save, logout all work.
- [x] 4. **Validation + controllers + routes.** Zod schemas replace `readEditorForm` / `validateRegistration` and the
   ad-hoc code parsing. Controllers move out of today's route files; `routes/web.js` and `routes/status.js`;
   `middleware/`. Delete `src/db/`, `src/auth/`, the old route files.
   Done: `validation/{form,auth,homework,share}.schema.js` (`formText` turns any field into a string as before,
   `fieldErrors` keeps the first message per field); controllers `home`, `auth`, `homework`, `share`; one
   `routes/web.js`; `routes/status.js` (404/500); `middleware/{auth,same-origin}.js`. Controllers get the
   client from `req.prisma` (set in `app.js`), not a global. `openDb`/`isLocal`/`DEFAULT_URL` moved to
   `config/client.js`, `dropSchema` to `config/migrate.js`. One intended change: a homework id in the address
   must be written plainly (`01`, `1e2` → 404 instead of opening homework 1 / 100). New
   `test/validation.test.js` (11 tests: missing fields, arrays, odd JSON, id, share code). Manual check:
   every route via the running app (register errors, create, edit, other teacher 404, join, share, 403, logout).
- [x] 5. **Scripts, docs, cleanup.** `db:seed`, `db:migration`, README (Vietnamese), CLAUDE.md, `.claude/docs/*`;
   tick this step. Manual check: `npm run db:reset && npm run db:seed && npm run dev`, click through the
   dashboard, editor and share pages.
   Done: `scripts/db-init.js` split into `db-migrate.js` (`db:init`) and `db-reset.js` (`db:reset`); new
   `db-new-migration.js` (`db:migration -- <name>`: `prisma migrate diff --exit-code`, writes
   `<UTC timestamp>_<name>/migration.sql`, says "no change" when there is none, warns on `RedefineTables`);
   `pretest: prisma generate` (risk 7). The RedefineTables rule is in `database.md`, `CLAUDE.md` and the
   README (risk 5). `db:migration` was checked by hand: no change, a bad name, an added column (plain
   `ALTER TABLE`), and a `NOT NULL` change (RedefineTables, warning printed, CHECKs missing in the output as
   expected); the test migrations were deleted afterwards. Manual check: `db:reset`, `db:seed`, `npm run dev`;
   login, dashboard, editor, share page and the browser scripts load (HTTP; the editor's in-browser behaviour
   is unchanged code and still needs a click-through in a real browser).
   Kept as is: `applyMigrations(db)` takes a libSQL client rather than `{ url, authToken }` as first planned,
   because tests pass their own client.

---

## Step 4.6 — Convert to TypeScript

Starts only after Step 4.5 is approved. Incremental: each part ends with `npm test` green and a commit after
review. Order: database layer and services first, then controllers/routes, the browser-shared parser last.

### What LaptopShop does, and what fits here

LaptopShop's `tsconfig.json` uses `module: commonjs`, `target: es6`, `outDir: dist`, `rootDir: src`, and path
aliases (`config/*`, `services/*`, …). It runs with **ts-node + nodemon** in dev (not `tsx`) and builds with
`tsc` + `tsc-alias`, copying the views into `dist/`. Homework is ES modules on Node 24, so copying that exactly
would mean switching to CommonJS and adding four tools.

Decided 2026-10-25: built-in type stripping (the `tsx` option below is not used).
- **Run:** use Node 24's built-in type stripping to run `.ts` files: `node src/server.ts`, `node --watch`,
  `node --test`. The generated Prisma client already runs this way.
- **Type checking:** `tsc --noEmit` (`npm run typecheck`) does the checking.
- **Dependencies:** only `typescript`, `@types/node` and `@types/express`, as dev dependencies, pinned.
- **Kept from LaptopShop:** the `tsconfig.json` shape (strict, `rootDir`, `include`/`exclude`).
- **Not copied:** CommonJS, path aliases and `tsc-alias`; relative imports stay.
- **If you prefer `tsx`:** use it for `dev` and `test` instead of plain `node`. That adds one dependency and
  lifts the type-stripping limits listed below. Your choice.

Planned `tsconfig.json` settings:
- Modules: `module`/`moduleResolution: "nodenext"`, `target: "es2024"`.
- Strictness: `strict: true`, `noEmit: true`, `skipLibCheck: true`.
- Mixed JS/TS during the conversion: `allowJs: true`, `checkJs: false`.
- What Node's type stripping requires: `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`,
  `allowImportingTsExtensions: true`.
- Files: `include: ["src", "test", "scripts"]`, `exclude: ["src/generated"]`.

### Parts

- [x] 1. **Tooling, no code converted.**
  - Add `typescript`, `@types/node`, `@types/express`, `tsconfig.json` and `npm run typecheck`.
  - `npm test` runs `typecheck` first.
  - `src/types/express.d.ts` declares `req.teacher` / `req.sessionToken`.
  - All files are still `.js`; tests pass.
  - Done: `typescript@7.0.2` (the current stable, the Go rewrite; out since 2026-07-08, every planned option
    checked in a throwaway project), `@types/node@24.19.2` (newest 24.x, matching Node 24),
    `@types/express@5.0.6`, all exact dev dependencies. `pretest` = `prisma generate && npm run typecheck`.
    `express.d.ts` also types `req.prisma` (added in Step 4.5 part 4). Checked with a temporary `.ts` file that
    the checker reports a nullable `req.teacher` and a missing `await`; typecheck takes about 0.2 s.
- [x] 2. **Database layer and services.**
  - `src/config/*.ts`, `src/services/*.ts`, `src/validation/*.ts`, typed with the generated Prisma types and
    `z.infer`.
  - The import paths of the moved files change to `.ts`.
  - Done: `src/config/{client,migrate}.ts`, `src/services/*.service.ts`, `src/validation/*.ts`, and
    `src/grading.ts` (not listed in any part; it belongs with the services). Services take `PrismaClient`
    (transactions `Prisma.TransactionClient`); new exported types `QuestionInput`, `SavedQuestion`,
    `HomeworkError`, `HomeworkInput`, `NewTeacher`, `DatabaseOptions`, `Migration`; schemas export
    `RegisterForm`, `LoginForm`, `EditorForm` (`z.infer`). Checked with a temporary file that the inferred
    form types fit the service inputs (needed in part 3). `password.service.ts` wraps `scrypt` in a typed
    promise because `util.promisify(scrypt)` loses the options overload; same behaviour.
  - Found: three `./form.js` imports inside `src/validation/` passed `tsc` (it maps `.js` to `.ts`) but
    failed in Node. Fixed, and `test/imports.test.js` now checks every relative import names a real file.
- [ ] 3. **Middleware, controllers, routes, app, server.** `src/middleware`, `src/controllers`, `src/routes`,
  `src/app.ts`, `src/server.ts`, `src/vietnam-time.ts`, `src/load-env.ts`. The `dev`/`start` scripts point at
  `src/server.ts`.
- [ ] 4. **Scripts and tests.**
  - `scripts/*.ts` and `test/*.test.ts`; the glob becomes `test/**/*.test.ts`.
  - Only the file types change; no assertion changes.
- [ ] 5. **Parser and browser code (needs a build step).**
  - `src/shared/parser.ts`. Browsers cannot run TypeScript, so `npm run build:browser` (`tsc -p
    tsconfig.browser.json`) compiles `parser.ts` and `src/public/js/*.ts` to JavaScript in a `dist/public`
    folder.
  - Express serves that folder at `/shared/parser.js` and `/js/*.js`, at the same URLs as today.
  - The build runs in `predev`, `pretest` and on Render. A test checks that the served `/shared/parser.js`
    is the compiled output of the current `parser.ts`, so the preview can never run a stale parser.
  - The parser's behaviour does not change: `test/parser.test.js` passes unchanged except for its file type.
- [ ] 6. **Docs.** README, CLAUDE.md (stack, commands), `.claude/docs/*`; tick this step.

### Risks

- **Type stripping only removes types.** No `enum`, `namespace` or constructor parameter properties
  (`erasableSyntaxOnly` reports them), and imports must use the `.ts` extension. `tsx` would avoid both.
- **EJS templates stay untyped.** Typing stops at `res.render(…)`, so a wrong variable name in a view is still
  only caught by the tests.
- **A stale browser build** would run an old parser in the editor preview; the test in part 5 guards this.
- **`tsc` accepts `./x.js` when only `x.ts` exists** (nodenext maps the extension); Node does not.
  `test/imports.test.js` catches it (found in part 2).
- **Strict mode will flag** some `null` handling in today's code, for example `req.teacher`. Fixes must keep
  the same behaviour, and the tests decide.
