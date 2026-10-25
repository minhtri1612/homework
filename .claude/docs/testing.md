# Testing

Runner: built-in `node:test` with `node:assert/strict`. No test dependencies, no browser tests.
`npm test` runs `node --test "test/**/*.test.js"`. Only `*.test.js` files are tests; `test/helpers.js`
is imported, not run.

Run a single file: `node --test test/parser.test.js`.

Avoid `--test-name-pattern` on the HTTP test files: when it filters out every test of a file, the
process hung (observed 2026-10-25, likely because the server opened in `before()` is never closed).
Run the whole file instead.

## Layout

| File | Covers | How |
|---|---|---|
| `test/grading.test.js` | `computeScore`: nearest 0.25, ties up, 0 and 10 | pure function |
| `test/parser.test.js` | all syntax styles, splitting, title, errors, normalisation, `validateQuestion`, `serialize` round-trip | pure functions |
| `test/db.test.js` | schema idempotence, FKs, teachers, passwords, `createHomework`/`getHomework`, share codes, cascades, DB constraints | own temp DB file, calls data functions and raw SQL |
| `test/auth.test.js` | pages, register, login/logout, sessions, Origin check, XSS escaping | real HTTP via `startApp()` |
| `test/share.test.js` | `normalizeShareCode`, `/h/CODE` (no answers in HTML, redirects, 404, deadline, versions), `/join`, teacher share links, https behind proxy | real HTTP via `startApp()` |
| `test/editor.test.js` | editor pages, create/edit, validation errors, versioning, ownership 404, `</script>` escaping, Vietnam time | real HTTP via `startApp()` |

## Test database

Tests never use `data/local.db`. `startApp()` in `test/helpers.js`:
- creates a temp folder (`mkdtempSync(tmpdir()/homework-test-*)`), opens `file:<dir>/test.db`, runs `applyMigrations`;
- starts `createApp({ db })` on port 0 (random) and returns `{ db, base, get, post, close }`;
- `get(path, cookie?)` and `post(path, fields, { cookie, origin })` use `fetch` with `redirect: 'manual'`,
  so assert on `status` and `location` yourself. `post` sends form-encoded fields and sets `Origin` to the
  app's own URL by default; pass another `origin` to test the 403;
- `close()` stops the server, closes the DB and deletes the folder.

`sessionCookie(response)` extracts `sid=…` from `Set-Cookie` for use as the `cookie` argument.

`db.test.js` sets up its own temp DB in `before`/`after` instead of using `startApp()`.

## Adding a test

```js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTeacher } from '../src/db/teachers.js';
import { startApp, sessionCookie } from './helpers.js';

let app;
let cookie;
before(async () => {
  app = await startApp();
  await createTeacher(app.db, { email: 'lan@example.com', name: 'Cô Lan', password: 'matkhau123' });
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
- Name the file `test/<area>.test.js`; one `startApp()` per file, shared by its tests.
- Test names are English sentences describing behaviour; asserted page text is Vietnamese.
- Check user-visible behaviour (status, redirect `location`, Vietnamese text in HTML), then the DB
  state via data functions (`getHomework`) or `db.execute`.
- For security-relevant features add a negative test (other teacher → 404, foreign Origin → 403,
  HTML in input is escaped, correct answers absent from student HTML).
- Submissions are inserted with raw SQL (`addSubmission` in `editor.test.js`) until Step 6 adds real code.
- Use unique emails/names per test, since tests in a file share one database.

## Known gaps

- `src/public/js/editor.js` (tabs, cards, submit blocking) has no automated tests; check it manually
  in a browser with `npm run dev`.
- No coverage tool configured.
