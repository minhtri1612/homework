# Kế hoạch xây dựng (8 bước)

> Rebuilt on 2026-10-25 from the git history, README and session notes: the
> original plan was only in a chat that was lost. Steps 0–4 match the commits;
> the details listed under steps 5–8 are what the schema and README already
> imply, not the original wording.

- [x] **Step 0 — Project setup**: Node 24, `.nvmrc`, `.editorconfig`, `.gitignore`, README (commit 63a380b)
- [x] **Step 1 — Parser**: `src/shared/parser.js` (3 syntax styles, title line, errors with line numbers,
      Unicode normalisation, `serialize`), `npm run parse`, `test/parser.test.js` (commits 63a380b, 19ee034)
- [x] **Step 2 — Database**: `src/db/schema.sql` (8 tables, versions), `createHomework` / `getHomework`
      with server-side validation, `db:init` / `db:seed` / `db:reset`, scrypt passwords, `test/db.test.js` (commit 27681cb)
- [x] **Step 3 — Teacher accounts**: register / login / logout, hashed session tokens, Origin check,
      dashboard, `test/auth.test.js` (commit 88873ad)
- [x] **Step 4 — Homework editor**: syntax tab + card tab, settings (reveal mode, Vietnam-time deadline,
      shuffle), new version when questions change after submissions, `test/editor.test.js` (commit 4622932)
- [ ] **Step 5 — Sharing**: link `/h/CODE` and a "nhập mã" box on the home page
  - [ ] `/h/CODE` finds the homework (code typed in any letter case), 404 in Vietnamese otherwise
  - [ ] code entry form on the home page
  - [ ] teacher sees and can copy the full link (dashboard + editor)
- [ ] **Step 6 — Student flow**: enter name, answer, submit, get the score
  - [ ] questions sent without the correct answers; question/answer shuffling
  - [ ] one attempt per name (`student_key`), deadline enforced
  - [ ] server-side grading on a 10-point scale (steps of 0.25), saved in `submissions` / `submission_answers`
  - [ ] result page following the reveal mode (after submit / after deadline / never)
- [ ] **Step 7 — Results for the teacher**: submissions list per homework, per-version view, CSV export
- [ ] **Step 8 — Deploy**: Render (web service) + Turso (database), production settings
