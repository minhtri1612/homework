# Database

Schema: `prisma/schema.prisma` + `prisma/migrations/*/migration.sql` (the SQL files are what runs; the
init migration has hand-written CHECKs, `COLLATE NOCASE` and the partial index). Applier:
`src/config/migrate.js`. Connection: `src/db/client.js`.
Data access: `src/db/teachers.js`, `src/db/sessions.js`, `src/db/homeworks.js`. Tests: `test/db.test.js`.

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
- `dropSchema(db)` drops tables children-first, then `_migrations` (`TABLES` list in `client.js`), so
  `db:reset` re-applies every migration. If you add a table, add it to that list in the right order.
- **No timestamp defaults in the database.** `created_at`, `updated_at` and `submitted_at` have no
  `DEFAULT`; the data-access code sets them (`new Date().toISOString()`). Raw-SQL inserts in tests must
  set them too, or the insert fails with `NOT NULL`.
- Step 4.5 parts 3–5 (Prisma Client services, Zod, controllers) are not done yet: the app still queries
  with raw SQL through `@libsql/client`.
- Foreign keys are enforced, including inside transactions (tested in `test/db.test.js`).
- Multi-statement writes use `const tx = await db.transaction('write')` … `await tx.commit()` in
  `try`, `tx.close()` in `finally`. Without commit, close rolls back.

## Conventions

- Times: UTC ISO 8601 text (`2026-10-24T16:45:00.000Z`), set in code with `new Date().toISOString()`. Convert Vietnam time with `src/vietnam-time.js`.
- Booleans: `BOOLEAN` columns stored as 0/1 with `CHECK (x IN (0, 1))`; data-access functions return JS booleans.
- Rows are mapped to camelCase objects in the data-access modules; routes never see raw rows.
- Text is NFC-normalised and trimmed before insert (`clean()` in `homeworks.js`).

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

## Homework functions (`src/db/homeworks.js`)

- `validateHomework({ title, questions, revealMode, deadline })` returns a list of `{ code, message, question? }`
  (Vietnamese). Checks: title present and ≤ 200 chars; 1–200 questions; each question via
  `validateQuestion`; question text ≤ 2000 and answer text ≤ 500 chars (`LIMITS`); valid reveal mode;
  valid deadline; `after_deadline` needs a deadline. Errors are thrown as `HomeworkValidationError`
  (`.errors`); routes catch only that class.
- `createHomework(db, {...})`: validates, then in one write transaction inserts the homework,
  version 1, its questions and answers. Returns `{ id, shareCode, versionId }`.
- `updateHomework(db, { id, teacherId, ... })`: returns `null` if the homework is not this teacher's.
  See versioning below. Returns `{ version, newVersion }`.
- `getHomework(db, id)`: homework + **latest** version (`{ id, number, submissionCount }`) + its
  questions **including `correct`** and ids. Teacher/grading use only; never send to students as-is.
  Does not check ownership; callers do.
- `findSharedHomework(db, shareCode)`: `{ id, title, shareCode, deadline, teacherName, questionCount }`
  (latest version) or null. **The only homework function safe for student pages**; it reads no
  questions or answers.
- `listHomeworks(db, teacherId)`: newest first, `questionCount` of the latest version,
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

- `scripts/db-init.js`: `npm run db:init` / `npm run db:reset` (`--reset` refuses non-`file:` URLs).
- `scripts/db-seed.js`: `npm run db:seed`; exits early if `giaovien@example.com` exists. Seeds
  through `parse()` + `createHomework()` with `shuffleAnswers: true`.
