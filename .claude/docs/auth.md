# Teacher auth and security rules

Files: `src/controllers/auth.controller.ts`, `src/validation/auth.schema.ts`, `src/middleware/auth.ts`,
`src/middleware/same-origin.ts`, `src/services/password.service.ts`,
`src/services/session.service.ts`, `src/services/teacher.service.ts`. Tests: `test/auth.test.ts`. Students have no accounts (planned; see `PLAN.md`).

## Registration (`POST /register`)

- Name: NFC, whitespace collapsed, trimmed, required, ≤ 100 chars.
- Email: trimmed, lower-cased, simple regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`, ≤ 254 chars; unique in any
  case (code lower-cases, column is `COLLATE NOCASE`). A race on the UNIQUE constraint (Prisma error
  `P2002`, `isUniqueViolation()` in `src/config/client.ts`) is caught and shown as "already registered".
- Password: 8–200 chars, must equal `confirm` (checked only when the password itself is valid).
  Rules live in `registerSchema`; `fieldErrors()` keeps the first message per field. All field errors are shown at once; typed values are
  kept except passwords.
- Success logs the teacher in and redirects to `/teacher`.

## Passwords (`src/services/password.service.ts`)

scrypt from `node:crypto`, N=16384, r=8, p=1, 64-byte key, 16-byte random salt. Stored as
`scrypt$N$r$p$salt$hash` (base64). Input is NFC-normalised before hashing, so NFC/NFD Vietnamese passwords
match. Comparison uses `timingSafeEqual`.

## Login (`POST /login`)

- Unknown email still runs `verifyPassword` against a lazily created dummy hash, so response time
  does not reveal which emails exist. Wrong email and wrong password give the same message.
- Every login creates a fresh session and deletes the previous one from the request cookie.

## Sessions and cookie

- Token: `randomBytes(32)` base64url, sent to the browser in cookie `sid`. The DB stores only the
  SHA-256 hex of it (`sessions.id`), so a leaked database cannot be used to log in.
- Lifetime 30 days (`SESSION_DAYS`). Expired rows are deleted whenever a new session is created.
- Cookie options (`sessionCookieOptions()`): `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 30
  days, `Secure` only when `NODE_ENV === 'production'`.
- `loadTeacher` middleware (uses `req.prisma`): reads `sid` (own parser, no cookie-parser dependency), looks up the
  teacher via `findSessionTeacher` (also checks `expires_at`), sets `req.teacher` /
  `res.locals.teacher` = `{ id, email, name }` or null, and clears a cookie that no longer matches a
  session. `req.sessionToken` holds the raw token.
- `POST /logout` deletes the session row, then clears the cookie. Old copies of the cookie stop working.

## Students

Students have no account. What protects their data:
- The answer page never contains which answer is correct (`getQuestionsForStudent()` drops it; tested).
- The private result link carries 24 random bytes; the database stores only its SHA-256, like session
  tokens. The link is checked against the homework in the URL (another code → 404). Result pages have
  no external links, so the code does not leak through `Referer`.
- Cookie `result_<CODE>`: HttpOnly, SameSite=Lax, `Path=/h/<CODE>`, Secure in production.
- Knowing a classmate's name only tells you that they submitted (needed for "one attempt per name"),
  not their result.
- `POST /h/:code/submit` goes through `sameOriginPosts` like every POST.

## Rules for new routes

- **Teacher pages**: mount under `/teacher` so `requireTeacher` applies (302 to `/login`).
- **Ownership**: any route taking a homework id must check `homework.teacherId === req.teacher.id` and
  answer 404 otherwise (see `ownHomework()` in `controllers/homework.controller.ts`). Data functions that write
  (`updateHomework`) also filter by `teacher_id`.
- **CSRF**: `sameOriginPosts` rejects a POST whose `Origin` host differs from the `Host` header (403).
  A POST **without** an `Origin` header is allowed (non-browser clients); together with
  `SameSite=Lax` this is the whole CSRF defence. There are no CSRF tokens. Keep state-changing actions
  on POST, never GET.
- **Output escaping**: EJS `<%= %>` for all user data. JSON inside `<script>` must go through
  `scriptJson()` (`controllers/homework.controller.ts`), which escapes `<`, U+2028, U+2029. Tests check both
  (`test/auth.test.ts` XSS name, `test/editor.test.ts` `</script>` in question text).
- **Untrusted text in exports**: anything a student typed that goes into a CSV passes `csvCell()`
  (formula prefix + quoting). Do not build CSV by joining strings elsewhere.
- **Destructive actions**: GET shows a confirmation page, only POST deletes (behind `sameOriginPosts` and
  the ownership check). Deleting a homework with submissions needs the ticked box, checked inside the
  delete transaction.
- **Correct answers**: never render `answers[].correct` into a student page before the reveal rules
  allow it (see `grading.md`).
- `x-powered-by` is disabled; `trust proxy` is 1 (Render).

Not present: rate limiting on login/register, password reset, email verification, account deletion.
Do not assume they exist.
