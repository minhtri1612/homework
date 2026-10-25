# Testing

Runner: built-in `node:test` with `node:assert/strict`. No test dependencies, no browser tests.
`npm test` runs `node --test "test/**/*.test.ts"`. Only `*.test.ts` files are tests; `test/helpers.ts`
is imported, not run.

Run a single file: `node --test test/parser.test.ts`.

Avoid `--test-name-pattern` on the HTTP test files: when it filters out every test of a file, the
process hung (observed 2026-10-25, likely because the server opened in `before()` is never closed).
Run the whole file instead.

## Layout

| File | Covers | How |
|---|---|---|
| `test/browser-build.test.ts` | served `/shared/parser.js`, `/js/editor.js`, `/js/copy.js` equal a fresh `tsc` build of their `.ts` sources; `.ts` sources are not served | compiles into a temp folder + real HTTP |
| `test/imports.test.ts` | every relative import in `src`, `scripts`, `test` names a file that exists (the type checker accepts `./x.js` for `x.ts`; Node does not) | reads the files |
| `test/validation.test.ts` | Zod schemas: register messages and cleaning, editor form coercion, homework id, share code | pure functions |
| `test/grading.test.ts` | `computeScore`: nearest 0.25, ties up, 0 and 10 | pure function |
| `test/parser.test.ts` | all syntax styles, splitting, title, errors, normalisation, `validateQuestion`, `serialize` round-trip | pure functions |
| `test/db.test.ts` | schema idempotence, FKs, teachers, passwords, `createHomework`/`getHomework`, share codes, cascades, DB constraints | own temp DB file, calls the services (Prisma) and raw SQL; also 200-question save, concurrent saves, deleting a homework with submissions |
| `test/auth.test.ts` | pages, register, login/logout, sessions, Origin check, XSS escaping | real HTTP via `startApp()` |
| `test/share.test.ts` | `normalizeShareCode`, `/h/CODE` (no answers in HTML, redirects, 404, deadline, versions), `/join`, teacher share links, https behind proxy | real HTTP via `startApp()` |
| `test/editor.test.ts` | editor pages, create/edit, validation errors, versioning, ownership 404, `</script>` escaping, Vietnam time | real HTTP via `startApp()` |

## Test database

Tests never use `data/local.db`. `startApp()` in `test/helpers.ts`:
- creates a temp folder (`mkdtempSync(tmpdir()/homework-test-*)`), opens `file:<dir>/test.db`, runs `applyMigrations`;
- creates a Prisma client on the same file and starts `createApp({ prisma })` on port 0 (random);
  returns `{ db, prisma, base, get, post, close }`. Pass `prisma` to services; `db` is a plain libSQL client
  for checking or inserting rows with SQL;
- `get(path, cookie?)` and `post(path, fields, { cookie, origin })` use `fetch` with `redirect: 'manual'`,
  so assert on `status` and `location` yourself. `post` sends form-encoded fields and sets `Origin` to the
  app's own URL by default; pass another `origin` to test the 403;
- `close()` stops the server, closes the DB and deletes the folder.

`sessionCookie(response)` extracts `sid=…` from `Set-Cookie` for use as the `cookie` argument.

`db.test.ts` sets up its own temp DB in `before`/`after` instead of using `startApp()`.

## Adding a test

```ts
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTeacher } from '../src/services/teacher.service.ts';
import { startApp, sessionCookie, type TestApp } from './helpers.ts';

let app: TestApp;
let cookie: string | null;
before(async () => {
  app = await startApp();
  await createTeacher(app.prisma, { email: 'lan@example.com', name: 'Cô Lan', password: 'matkhau123' });
  cookie = sessionCookie(await app.post('/login', { email: 'lan@example.com', password: 'matkhau123' }));
});
after(() => app.close());

describe('feature', () => {
  test('does the thing', async () => {
    const response = await app.get('/teacher', cookie);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Bài tập của tôi/);
  });
});
```

Conventions seen in the existing tests:
- Name the file `test/<area>.test.ts`; one `startApp()` per file, shared by its tests.
- Test names are English sentences describing behaviour; asserted page text is Vietnamese.
- Check user-visible behaviour (status, redirect `location`, Vietnamese text in HTML), then the DB
  state via services (`getHomework(prisma, id)`) or `db.execute`.
- For security-relevant features add a negative test (other teacher → 404, foreign Origin → 403,
  HTML in input is escaped, correct answers absent from student HTML).
- Submissions are inserted with raw SQL (`addSubmission` in `editor.test.ts`) until Step 6 adds real code.
  Raw inserts must set `submitted_at` / `created_at` / `updated_at` (no DB defaults).
- Prisma errors carry a `code` (`P2002` unique, `P2003` foreign key) instead of SQLite's message text:
  assert with `{ code: 'P2002' }`.
- Use unique emails/names per test, since tests in a file share one database.
- Tests are TypeScript, checked by `npm run typecheck` like the app. Type the shared `let` variables
  (`TestApp`, `TestApp['db']`, …). Where a test knows a value exists, `!` is fine
  (`(await getHomework(prisma, id))!`); a test that expects `null` asserts it instead.

## Known gaps

- `src/public/js/editor.js` (tabs, cards, submit blocking) has no automated tests; check it manually
  in a browser with `npm run dev`.
- No coverage tool configured.
- `npm test` runs `prisma generate`, `npm run typecheck` and `npm run build:browser` first (`pretest`); a type
  error stops the run. Running `node --test` directly skips it: after a
  `schema.prisma` change, run `npm run db:generate` or you get confusing errors from the old client.
- `scripts/db-new-migration.ts` has no automated test (it calls the Prisma CLI); it was checked by hand
  with an added column and with a change that rebuilds a table.
- Turso itself is untested until Step 8; every test uses a `file:` database.
