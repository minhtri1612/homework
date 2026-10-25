# Grading, answer reveal and shuffling

**Status: implemented in Step 6** (`src/services/submission.service.ts`, `src/services/shuffle.service.ts`,
`src/controllers/share.controller.ts`, tests in `test/student.test.ts`). The decisions below were made by the
user on 2026-10-25; change them only after asking.

## Score formula (decided by the user, 2026-10-25)

Round `correct / total × 10` to the **nearest** 0.25:

```js
const score = Math.round((correct * 40) / total) / 4;
```

- Examples: 7.1 → 7, 7.13 → 7.25, 10/10 → 10, 0/n → 0. 1 of 3 correct = 3.33… → 3.25; 2 of 3 = 6.66… → 6.75.
- `correct * 40` is an integer, so there is only one floating-point division; do not compute
  `correct / total * 10` first and round afterwards, because of float error near the halfway points.
- An exact tie (e.g. 7.125 = 57 of 80) goes **up** (`Math.round` behaviour); confirmed by the user
  2026-10-25.
- Implemented as `computeScore(correct, total)` in `src/grading.ts`, tested in `test/grading.test.ts`.
  Step 6 must use it rather than repeat the formula.
- Blank answers count as wrong: `total` = number of questions in the submission's version.

## Already decided (schema / README / code)

**Score columns** (`submissions` in `prisma/migrations/20261025000000_init/migration.sql`):
- `score` REAL, `CHECK (score BETWEEN 0 AND 10)`, schema comment "steps of 0.25".
- `correct_count` ≥ 0, `total_count` ≥ `correct_count`. `total_count` is the number of questions in
  the submission's version (the editor tests insert it that way).
- README: scored automatically on a 10-point scale ("chấm điểm tự động theo thang 10").
- Grading happens on the server. `getHomework()` includes `answers[].correct` and is documented as
  "for the teacher and for grading only".

**Answers stored** (`submission_answers`): one row per question of the version; `answer_id` NULL =
left blank. The composite FK forces the chosen answer to belong to that question. Since every
submission references concrete `answers.id` rows, grading and review work by **answer id**, never by
position or letter. That is what keeps shuffling safe: the letter a student saw is irrelevant.

**One attempt per name**: UNIQUE (`homework_id`, `student_key`); `student_key` = name lower-cased
with spaces collapsed (schema comment). Spans versions: a student cannot retake after a new version.

**Versions**: a submission stores `version_id`. Grade and display against that version's rows. See
`database.md` "Homework versioning".

**Reveal modes** (`homeworks.reveal_mode`, editor labels in `views/editor.ejs`):
| Value | Editor label | Meaning |
|---|---|---|
| `after_submit` (default) | Ngay sau khi nộp bài | correct answers shown right after submitting |
| `after_deadline` | Sau hạn nộp | shown only once `deadline` has passed; requires a deadline (app + schema CHECK) |
| `never` | Không cho xem (chỉ xem điểm) | never shown |
The score is always shown (schema comment on `reveal_mode`).

**Shuffling flags**: `homeworks.shuffle_questions` ("Xáo trộn thứ tự câu hỏi cho mỗi học sinh") and
`questions.shuffle_answers` per question. Stored positions (`questions.position`, `answers.position`)
are the teacher's order; shuffling is meant to be presentation only.

**Deadline**: `homeworks.deadline` UTC ISO or NULL (none). Teachers enter Vietnam time.

## Time limit (Step 9, decided by the user 2026-10-25)

`homeworks.time_limit_minutes` (NULL = none, CHECK 1–600; editor field "Thời gian làm bài", `minutes()` in
`homework.schema.ts` turns typed text into a number, NaN, or null; `validateHomework()` reports `BAD_TIME_LIMIT`).
- **Server records the start**: with a limit, the share page form is `POST /h/CODE/start` (`postStart`), which
  upserts `attempts(homework_id, student_key, started_at)` keeping the first time. Reload, another device or
  starting again continue the same clock. `GET /h/CODE/answer` without an attempt shows the start page (name
  filled in, no questions); with time up it is 403 "Đã hết giờ làm bài (N phút)…".
- **Time left** `secondsLeft()`: until `started_at + limit`, or the deadline if earlier. The page gets the
  seconds left (`data-seconds-left`), not an end time, so the device clock does not matter.
- **Auto-submit**: `answer.ts` counts down (red under 5 minutes, re-checks on `visibilitychange`) and calls
  `form.submit()` at 0, skipping the blank-question confirmation. Chosen answers are kept in `localStorage`
  (`answers:CODE:versionId:name`, try/catch) until submitted, so a reload does not lose them.
- **Late arrival**: `submitAnswers()` accepts up to `SUBMIT_GRACE_MS` (60 s) after time is up, else
  `TIME_UP` (403, not saved). The same minute now applies to the **deadline** for every homework (an
  auto-submit at the deadline would otherwise always be late), and `after_deadline` reveals the answers only
  after deadline + 60 s, so nobody reads them while a late submission is still accepted. Opening the answer
  page stays strict at the deadline.
- **No attempt but a limit** (the teacher added the limit while the student was answering): accepted.
- `submissions.started_at` is now filled from the attempt (NULL without a limit). Deleting a submission
  (`deleteSubmission`) also deletes the attempt, so the student can redo it with a fresh clock. A student
  who started but has no submission is reset with "Cho làm lại" (Step 10).

## Leaving the page (Step 10, asked for by the user 2026-10-25)

Only for homeworks with a time limit (Claude's recommendation; the user did not pick, a homework without
a limit is usually done at home where switching apps is normal). Nothing is recorded without an attempt.
- **Browser** (`answer.ts`): leaving = `visibilitychange` to hidden (other tab/app, home screen, screen off,
  reload, closing the tab) or window `blur` (another window on a computer); our own `confirm()` and the
  submit navigation are ignored. On leaving it sends `event=leave` at once with `navigator.sendBeacon`
  (fallback `fetch keepalive`) to `POST /h/CODE/away`, so it counts even if the student never comes back;
  on return (visible and focused) `event=back&seconds=N`, and shows "Em đã rời trang làm bài N lần…". An
  auto-submit while away reports the seconds first. `data-leave-count` starts the count from the server's.
- **Server** `recordAway()`: one `updateMany` on the attempt (`leave_count + 1`, or `away_seconds + N`
  capped at 600 min), matched by share code + `student_key` + a time limit; unknown/not started → nothing,
  still 204. `awaySchema`: name, `event` ∈ leave/back, seconds 0–9 999 999; else 400.
- **Not proof**: a second device, split screen or a student turning it off goes unseen; a phone call or
  screen lock counts. Anyone who knows a student's name and the code could send fake reports for them
  (only adds warnings; accepted risk, no per-attempt secret).
- **Teacher** (`results.ejs`): a "Rời trang" column when any submission has an attempt ("⚠ Rời trang 4 lần,
  tổng 3 phút 20 giây"; empty when 0), CSV columns `Rời trang (lần)` and `Thời gian rời trang (giây)` only
  then, an explanation paragraph, and "Đã bắt đầu nhưng chưa nộp (N)" (`listUnfinished`: attempts without a
  submission, with "Đang làm, còn N phút" / "Hết giờ, chưa nộp"). "Cho làm lại" →
  `/teacher/homeworks/:id/attempts/:studentKey/reset` (confirmation page, then `resetAttempt` deletes the
  attempt; a student who submitted is a 404 there: delete the submission instead).
- `attempts.student_name` (Step 10) is shown in that list; NULL for attempts from before, shown as the key.

## Step 6 decisions (2026-10-25)

- **Blank answers** are allowed, also a fully blank submission; each blank question counts as wrong and is
  stored as `answer_id NULL`. The answer page (`answer.ts`) asks for confirmation when questions are blank.
- **Name**: `formLine` (NFC, whitespace collapsed, trimmed), 1–100 chars, diacritics kept.
  `student_key` = `name.toLocaleLowerCase('vi')`: "Lê Văn An", " lê  văn an " are the same student.
- **Shuffle order** is derived, not stored: `seededShuffle()` (SHA-256 of the seed → mulberry32 →
  Fisher–Yates) with seed `homeworkId:versionId:studentKey` for the questions (when `shuffle_questions`)
  and `…:questionId` for each question's answers (when `shuffle_answers`). The same student sees the same
  order on reload, other students another one, and the result page repeats it. (`started_at`: see "Time limit".)
- **Deadline**: after it, `/h/CODE` shows no name form, `/h/CODE/answer` is 403, and a submission that
  arrives more than 60 s late is refused (403, "Đã hết hạn nộp bài, bài làm không được ghi nhận"; the 60 s
  were added with the time limit in Step 9). The check runs inside the save transaction.
- **Result page** (`/h/CODE/result/<code>`): score (Vietnamese decimal comma, "7,25 / 10 điểm"), correct
  count, time. When `canReveal()`: every question in the student's order with their choice ("em chọn"),
  the correct answer ("đáp án đúng") and ✔ Đúng / ✖ Sai / ✖ Bỏ trống. `never`: score only.
  `after_deadline` before the deadline: a notice with the deadline. `getResult()` does not even load the
  correct answers into its result unless they may be shown.
- **Private result link**: 24 random bytes (base64url) in the URL; only the SHA-256 hex is stored
  (`submissions.result_token_hash`, unique, nullable for rows tests insert directly). A cookie
  `result_<CODE>` (HttpOnly, SameSite=Lax, `Path=/h/<CODE>`, one year) keeps the last link of this
  browser, so `/h/CODE` offers "… đã nộp bài. Xem kết quả" while still letting the next student start
  (shared school computers).

## Submitting (`submitAnswers`)

One write transaction, so it cannot interleave with `updateHomework`:
1. Homework by share code, with this student's attempt; refuse if closed (deadline + 60 s) or the time
   limit ran out more than 60 s ago (`TIME_UP`).
2. The version the student saw (hidden `versionId`, must belong to the homework) and its questions.
   The hidden `questionIds` must equal that version's questions: if the teacher replaced the questions in
   place (possible while nobody had submitted), the ids differ and the student is asked to redo it (409).
   A page from an **older** version that still exists is accepted and graded on that version.
3. Each chosen answer must belong to its question (else 400; only hand-made requests do that).
4. `computeScore(correct, total)`; insert the submission with all `submission_answers` rows.
A second submission with the same `student_key` fails on the UNIQUE constraint (409, "đã nộp bài này rồi").

## Teacher results (Step 7, `results.service.ts`, decided 2026-10-25)

- **List**: oldest submission first; average = mean of the listed scores, rounded to 2 decimals, shown with
  a decimal comma.
- **Per question** (one version only; questions differ between versions): `correctCount` = submissions
  that chose the correct answer, `blankCount`, and `chosenCount` per answer. Letters are in the teacher's
  order; students may have seen another order when answers were shuffled (the page says so).
- **CSV**: one row per submission: `STT, Họ tên, Điểm, Số câu đúng, Tổng số câu, Phiên bản, Nộp lúc (giờ
  Việt Nam)`. Comma-separated, score with a dot (`7.25`), time `YYYY-MM-DD HH:MM` Vietnam time, UTF-8 with
  BOM, CRLF, RFC 4180 quoting. Text cells starting with `= + - @`, tab or CR get a leading `'` (CSV
  formula injection: student names are untrusted). Same version filter as the page.
- **Deleting a submission** frees the name (one attempt per name), so the student can submit again.

