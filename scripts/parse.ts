// Try the parser from the terminal:
//   npm run parse -- examples/mau.txt
//   npm run parse            (then paste text, finish with Ctrl+D)
import { readFileSync } from 'node:fs';
import { parse } from '../src/shared/parser.ts';

const file = process.argv[2];
const input = readFileSync(file ?? 0, 'utf8');
const { title, questions, errors, warnings } = parse(input);
const LETTERS = 'ABCDEFGH';

if (title) console.log(`Tiêu đề: ${title}`);

questions.forEach((q, i) => {
  const status = q.errors.length ? '✖' : q.warnings.length ? '!' : '✔';
  console.log(`\n${status} Câu ${i + 1} (dòng ${q.line}): ${q.text.replaceAll('\n', '\n    ') || '(không có nội dung)'}`);
  q.answers.forEach((a, j) => console.log(`    ${a.correct ? '==' : '  '}${LETTERS[j] ?? j + 1}. ${a.text}`));
  for (const e of q.errors) console.log(`    ✖ Lỗi (dòng ${e.line}): ${e.message}`);
  for (const w of q.warnings) console.log(`    ! Lưu ý: ${w.message}`);
});

console.log(`\n${questions.length} câu hỏi · ${errors.length} lỗi · ${warnings.length} lưu ý`);
if (errors.some((e) => e.code === 'EMPTY_INPUT')) console.log('✖ Chưa có câu hỏi nào.');
process.exitCode = errors.length ? 1 : 0;
