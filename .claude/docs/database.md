# Database

Schema: `prisma/schema.prisma` + `prisma/migrations/*/migration.sql` (the SQL files are what runs; the
init migration has hand-written CHECKs, `COLLATE NOCASE` and the partial index). Applier:
`src/config/migrate.ts`. Connections: `src/config/client.ts` (`createPrisma()`, used by the app and the
services) and `openDb()` in the same file (a plain libSQL client used only to apply migrations, by
`db:reset`, and by tests that check rows with SQL).
Data access: `src/services/teacher.service.ts`, `session.service.ts`, `homework.service.ts` (Prisma Client;
the first argument is the PrismaClient or a transaction `tx`). Tests: `test/db.test.js`.

## Changing the schema (migrations)

1. Edit `prisma/schema.prisma`.
2. `npm run db:migration -- <name>` (lower case, digits, `_`). It runs `prisma migrate diff
   --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` and writes
   `prisma/migrations/<UTC timestamp>_<name>/migration.sql`; "Không có thay đổi" when nothing differs.
   It needs no database. It does not apply anything.
3. **Review the SQL by hand** (rule below), then `npm run db:init` and `npm run db:generate`
   (`npm test` regenerates by itself through `pretest`).
4. Commit the new migration folder together with the `schema.prisma` change. The server applies it on
   its next start, also on Turso.

`prisma migrate dev` / `migrate deploy` are not used: `deploy` cannot reach Turso, and both keep their own
history table, which would conflict with `_migrations`.

**RedefineTables rule (not optional).** When SQLite cannot alter a table in place (for example making a
column `NOT NULL`, changing a type or a foreign key), Prisma writes `-- RedefineTables`: it creates
`new_<table>` from `schema.prisma`, copies the rows, drops the old table and renames. The new table
**silently loses** what `schema.prisma` cannot express: that table's `CHECK` constraints, `COLLATE NOCASE`
on `teachers.email`, and the partial index `answers_one_correct`. Copy them back from the init migration
(they are marked `hand-written`) into the new `CREATE TABLE` / after it, before applying.
`db:migration` prints a warning when the file contains `RedefineTables`. Never edit a migration that has
already been applied anywhere; `applyMigrations` refuses a changed checksum.

## libSQL: local file vs Turso

- `openDb({ url, authToken })` defaults to `process.env.DATABASE_URL || 'file:data/local.db'` and
  `DATABASE_AUTH_TOKEN`. For `file:` URLs it creates the folder first.
- Local: no setup, `data/local.db` (gitignored). Production (Step 8, not done): Turso URL + token in
  `.env` / environment. Application code does not branch on which one it is; only `isLocal(url)` is
  used, by `db:reset`.
- `applyMigrations(db)` runs every migration not yet recorded in `_migrations` (name, checksum,
  applied_at), each in its own write transaction. It fails if an applied `migration.sql` was edited
  afterwards. Called by `src/server.js` on startup, `npm run db:init`, `db:seed` and the tests
  (`test/helpers.js`, `test/db.test.js`). Never edit an applied migration; add a new one.
- `dropSchema(db)` drops tables children-first, then `_migrations` (`TABLES` list in `migrate.ts`), so
  `db:reset` re-applies every migration. If you add a table, add it to that list in the right order.
- **No timestamp defaults in the database.** `created_at`, `updated_at` and `submitted_at` have no
  `DEFAULT`; the data-access code sets them (`new Date().toISOString()`). Raw-SQL inserts in tests must
  set them too, or the insert fails with `NOT NULL`.
- `createPrisma({ url, authToken })` defaults to the same `DATABASE_URL` / `DATABASE_AUTH_TOKEN` and
  connects through `PrismaLibSql` (`@prisma/adapter-libsql`), for `file:` and Turso alike. The client is
  generated TypeScript in `src/generated/prisma/` (`npm run db:generate`, also run by `postinstall`;
  regenerate after every `schema.prisma` change). Node 24 imports it from JS by stripping the types.
- Foreign keys are enforced, including inside transactions (tested in `test/db.test.js`).
- Multi-statement writes use `prisma.$transaction(async (tx) => { … }, { timeout: 30_000 })`: a thrown
  error rolls everything back. The default 5 s timeout is too short for 200 questions over Turso.
  The adapter runs transactions of one process one at a time, which is what keeps the share-code check
  and the "submissions exist → new version" check correct (tested: "saves at the same moment do not
  clash"). That would not hold with several server processes; Render runs one.
- **Single-process assumption (revisit before running more than one instance).** `createHomework` checks
  that a new share code is unused inside its transaction and then inserts it. That check, like the
  versioning check in `updateHomework`, assumes one server process. With several instances, two could
  pick the same code at once: the UNIQUE constraint on `share_code` would then fail the save with P2002
  instead of retrying. Before scaling out, add a retry on P2002 (and recheck the versioning race).
- Independent writes that must succeed together without reads in between use the array form
  `prisma.$transaction([...])` (`createSession`).

## Conventions

- Times: UTC ISO 8601 text (`2026-10-24T16:45:00.000Z`), set in code with `new Date().toISOString()`. Convert Vietnam time with `src/vietnam-time.js`.
- Booleans: `BOOLEAN` columns stored as 0/1 with `CHECK (x IN (0, 1))`; data-access functions return JS booleans.
- Rows are mapped to camelCase objects in the data-access modules; routes never see raw rows.
- Text is NFC-normalised and trimmed before insert (`clean()` in `homework.service.ts`).

## Tables

| Table | Key columns / rules |
|---|---|
| `teachers` | `email` UNIQUE `COLLATE NOCASE` (also lower-cased in code), `name`, `password_hash` (scrypt string) |
| `sessions` | `id` = SHA-256 hex of the cookie token, `teacher_id` (cascade), `expires_at` |
| `homeworks` | `teacher_id`, `title` (non-blank), `share_code` UNIQUE, `reveal_mode` ∈ `never`/`after_submit`/`after_deadline` (default `after_submit`), `deadline` (NULL = none), `shuffle_questions`, `created_at`, `updated_at`; CHECK: `after_deadline` requires a deadline |
| `homework_versions` | `homework_id`, `number` ≥ 1, UNIQUE (`homework_id`, `number`); highest number = current |
| `questions` | `version_id`, `position` (1-based, UNIQUE per version), `text` (may be `''`), `shuffle_answers` |
| `answers` | `question_id`, `position` (1 = A), `text` (non-blank), `is_correct`; partial UNIQUE index `answers_one_correct` = at most one correct per question; UNIQUE (`id`, `question_id`) as an FK target |
| `submissions` | `homework_id`, `version_id`, `student_name`, `student_key`, `started_at` (nullable), `submitted_at`, `correct_count`, `total_count` ≥ `correct_count`, `score` REAL 0–10; UNIQUE (`homework_id`, `student_key`) |
| `submission_answers` | PK (`submission_id`, `question_id`), `answer_id` NULL = left blank; composite FK (`answer_id`, `question_id`) → `answers(id, question_id)` so the chosen answer must belong to that question |

All child FKs use `ON DELETE CASCADE`: deleting a homework removes its versions, questions, answers and
submissions. The database enforces "at most one correct answer"; "exactly one" and "2–6 answers"
are enforced by `validateQuestion()` before saving.

`submissions` and `submission_answers` are only written by tests so far (raw SQL). Student
submission code is Step 6. `student_key` is documented in the schema as "name lower-cased with spaces
collapsed: one attempt per name"; no code computes it yet.

## Share codes

`generateShareCode()`: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L) using
`crypto.randomInt`. `createHomework` retries inside the write transaction until unused. Codes never
change, also not when a new version is created.

`normalizeShareCode(input)` turns what a student typed or pasted into a code or `null`: NFC, takes the
part after `/h/` if it is a link, removes spaces and dashes, upper-cases, then must match the alphabet
and length exactly (`0`, `O`, `1`, `I`, `L` → `null`).

## Homework functions (`src/services/homework.service.ts`)

- `validateHomework({ title, questions, revealMode, deadline })` returns a list of `{ code, message, question? }`
  (Vietnamese). Checks: title present and ≤ 200 chars; 1–200 questions; each question via
  `validateQuestion`; question text ≤ 2000 and answer text ≤ 500 chars (`LIMITS`); valid reveal mode;
  valid deadline; `after_deadline` needs a deadline. Errors are thrown as `HomeworkValidationError`
  (`.errors`); routes catch only that class.
- `createHomework(prisma, {...})`: validates, then in one write transaction inserts the homework,
  version 1, its questions and answers. Returns `{ id, shareCode, versionId }`.
- `updateHomework(prisma, { id, teacherId, ... })`: returns `null` if the homework is not this teacher's.
  See versioning below. Returns `{ version, newVersion }`.
- `getHomework(prisma, id)`: homework + **latest** version (`{ id, number, submissionCount }`) + its
  questions **including `correct`** and ids. Teacher/grading use only; never send to students as-is.
  Does not check ownership; callers do.
- `findSharedHomework(prisma, shareCode)`: `{ id, title, shareCode, deadline, teacherName, questionCount }`
  (latest version) or null. **The only homework function safe for student pages**; it reads no
  questions or answers.
- `listHomeworks(prisma, teacherId)`: newest first, `questionCount` of the latest version,
  `submissionCount` across **all** versions (the editor's notice counts the current version only).

## Homework versioning

Goal: a submission always points at the exact questions the student saw.

`updateHomework` in one write transaction:
1. Loads the latest version and its submission count (joined with `teacher_id`, which is also the ownership check).
2. Always updates settings in place: title, reveal mode, deadline, shuffle questions, `updated_at`.
3. Compares the saved questions with the new ones (`sameQuestions`: NFC-trimmed question text,
   `shuffleAnswers`, answer texts and correct flags, in order; ids ignored).
4. If they differ:
   - the latest version has submissions: insert version `number + 1` with the new questions; old rows untouched;
   - no submissions: delete the version's questions (answers cascade) and re-insert. Ids change,
     which is fine because nothing references them.

The route redirects with `?saved=v<N>` when a new version was created. Rules for new code: never
modify or delete questions/answers of a version that has submissions; student pages and grading must
use the version a submission belongs to, and new attempts use the latest version.

## Scripts

- `scripts/db-migrate.js`: `npm run db:init`, applies pending migrations.
- `scripts/db-reset.js`: `npm run db:reset`, drops every table and `_migrations`, then applies all
  migrations; refuses non-`file:` URLs.
- `scripts/db-new-migration.js`: `npm run db:migration -- <name>` (see "Changing the schema").
- `npm run db:generate`: `prisma generate` (also `postinstall` and `pretest`). `prisma.config.js` points
  the Prisma CLI at the schema, the migrations folder and `DATABASE_URL`; the app does not read it.
- `scripts/db-seed.js`: `npm run db:seed`; exits early if `giaovien@example.com` exists. Seeds
  through `parse()` + `createHomework()` with `shuffleAnswers: true`.
