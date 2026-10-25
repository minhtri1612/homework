# Parser (`src/shared/parser.ts`)

Dependency-free TypeScript module used by the browser editor (compiled to `/shared/parser.js` by
`npm run build:browser`; live preview, tab switching) and the server (imported as `.ts`)
(`validateQuestion` inside `validateHomework`, plus `scripts/db-seed.ts` and `scripts/parse.ts`).
User-facing explanation of the syntax, in Vietnamese: `README.md` "Cú pháp nhập câu hỏi".
Types: `ParseResult`, `ParsedQuestion`, `ParsedAnswer`, `Problem`, `QuestionToCheck` (exported).
Tests: `test/parser.test.ts`. Try it: `npm run parse -- examples/mau.txt`.

## Exports

| Export | Purpose |
|---|---|
| `MIN_ANSWERS` = 2, `MAX_ANSWERS` = 6 | answer count limits (the editor also uses `MAX_ANSWERS`) |
| `normalizeText(input)` | normalisation, keeps the line count |
| `parse(input)` | text → `{ title, questions, errors, warnings }` |
| `validateQuestion(q)` | checks one `{ text, answers: [{ text, correct }], line? }` → `{ errors, warnings }` |
| `serialize(questions, title = '')` | questions → syntax text |

`parse()` question shape: `{ text, answers: [{ text, correct, line }], line, errors, warnings }`.
Question `text` may contain `\n` (multi-line questions). Answer letters are stripped; order is kept.
Top-level `errors`/`warnings` repeat each question's items with `question` (1-based) added.

## Normalisation (`normalizeText`)

NFC; `\r\n`, `\r`, U+2028/2029 → `\n`; BOM and zero-width characters removed; tab, NBSP and other
Unicode spaces → space; full-width `＝` → `=`. The line count never changes, so error line numbers
match the teacher's text. Inside lines, whitespace is collapsed to single spaces.

## Answer lines

- Correct mark: `==` (optionally followed by spaces) at the start, or right after the letter: `==B. x`
  and `B. ==x` are both correct.
- Letter prefixes: `A.` `a)` `(A)` `A:` (letters A–H, any case). G and H are recognised only so
  that a 7th/8th answer reports `TOO_MANY_ANSWERS` instead of being misread as question text.
- Inline (several answers on one line, `findInlineAnswers`): markers must form a consecutive run
  of letters starting at `A`, or at any letter if it is at the start of the line (continuation lines
  like `C. x   D. y`). Needs ≥ 2 answers. Longest run wins, ties go to the later run (so "vitamin A."
  inside question text is not taken as an answer). Text before the run is question text.

## Splitting into questions

A new question starts on:
1. a blank line;
2. numbering: `1.` / `1)` (1–3 digits, followed by space or end of line), or `Câu`/`Cau`/`Bài`/`Bai`
   + number with an optional `.` `:` `)` `-` `–` (case-insensitive). `Câu 1:` alone on a line is
   allowed, with the text on the next line;
3. lettered mode: a line without a letter after the answers, or a second `A.`;
4. plain mode: a non-answer line ending in `?` or `:` once the block has ≥ 2 answers;
5. inline answers when the current block already has answers and the line has a question prefix or
   starts at `A`.

Modes per block: `lettered` (answers have letters, so question text can span several lines),
`plain` (answers without letters, so only the **first** line is question text and every following line
is an answer, the correct one marked `==`). In plain mode, lines between the question and the first
`==` line become answers retroactively. A block with no `==` and no letters: first line is the
question, the rest are answers (then `NO_CORRECT`).

## Title

`findTitle`: the first non-empty line is the title when the next line is blank **and** it is not an
answer line (no letter prefix, no `==`, no inline answers). Numbered lines like `Bài 1: Ôn tập` can be
titles. A single-line input has no title. Only a title and nothing else gives `EMPTY_INPUT`.

## Errors and warnings

Nothing is dropped silently: every non-empty line ends up in some question.

| Code | Kind | When |
|---|---|---|
| `NO_ANSWERS` | error | question with no answers |
| `TOO_FEW_ANSWERS` | error | 1 answer |
| `TOO_MANY_ANSWERS` | error | more than 6 |
| `NO_CORRECT` | error | answers but none marked |
| `MULTIPLE_CORRECT` | error | more than one marked (message lists the letters) |
| `EMPTY_ANSWER` | error | answer text empty, e.g. `==B.`; points at the answer's own line |
| `DUPLICATE_ANSWER` | error | same text ignoring case (`vi` locale), spacing and Unicode form |
| `EMPTY_INPUT` | error (top level only) | no questions at all |
| `EMPTY_QUESTION` | **warning** | answers but no question text (compact `1. A. cat B. dog`); can be saved |

Messages are Vietnamese. `parse()` appends syntax hints (`SYNTAX_HINTS`) to `NO_CORRECT` and
`MULTIPLE_CORRECT`; `validateQuestion()` on its own (form cards) gives no hints and no line numbers
unless the question has `line`.

## Serialize round-trip

`serialize()` writes `N. <first line>`, the remaining question lines, then `==A. text` / `B. text`,
with a blank line between questions and an optional `title` + blank line first. Guarantees tested in
`test/parser.test.ts`: `parse(serialize(x))` returns the same questions, and `serialize(parse(x))` is
stable for messy input. If you change either function, keep both properties and their tests.

Note: the editor calls `serialize(cards)` without the title, so the syntax tab never shows the title
line. The title lives in its own input field.
