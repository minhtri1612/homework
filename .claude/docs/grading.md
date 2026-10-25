# Grading, answer reveal and shuffling

**Status: not implemented.** The student flow and grading are Step 6 of `PLAN.md`. This file lists
what the user, the schema, the code and the README already decide, and the open decisions. Do not treat
the open decisions as settled; ask the user or record the decision here during Step 6.

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
- Implemented as `computeScore(correct, total)` in `src/grading.ts`, tested in `test/grading.test.js`.
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

## Open decisions for Step 6 (nothing in the repo settles these)

- Whether a fully blank submission is allowed.
- How shuffle order is generated and kept stable (per student? stored? `started_at` exists but
  nothing writes it).
- Whether submitting after the deadline is refused or only marked late.
- What the student sees per question for each reveal mode (own answer, correct answer, score only).
- How the name is normalised beyond the `student_key` comment (NFC? Vietnamese diacritics kept?).
