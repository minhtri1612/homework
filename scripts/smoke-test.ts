// npm run smoke: checks the database in .env (Turso) before deploying. All
// automated tests use local files; this runs one real cycle over the network,
// through the same services the website uses, and then removes what it made:
//   migrations → teacher + login session → homework (+ edit, + 200 questions)
//   → student answers and result → teacher results and CSV → deletes.
// The auth token is never printed.
import '../src/load-env.ts';
import { performance } from 'node:perf_hooks';
import { applyMigrations } from '../src/config/migrate.ts';
import { createPrisma, isLocal, openDb, DEFAULT_URL } from '../src/config/client.ts';
import { createTeacher } from '../src/services/teacher.service.ts';
import { createSession, deleteSession, findSessionTeacher } from '../src/services/session.service.ts';
import { createHomework, getHomework, updateHomework, type QuestionInput } from '../src/services/homework.service.ts';
import { getQuestionsForStudent, getResult, submitAnswers } from '../src/services/submission.service.ts';
import { deleteHomework, deleteSubmission, listSubmissions, questionStats, submissionsCsv } from '../src/services/results.service.ts';

const url = process.env.DATABASE_URL || DEFAULT_URL;
if (isLocal(url)) {
  console.error('✖ DATABASE_URL trong .env đang trống hoặc là file trên máy. Hãy điền địa chỉ libsql://… của Turso.');
  process.exit(1);
}
if (!process.env.DATABASE_AUTH_TOKEN) {
  console.error('✖ Thiếu DATABASE_AUTH_TOKEN trong .env.');
  process.exit(1);
}
console.log(`Cơ sở dữ liệu: ${new URL(url).host}`);

/** Runs one step, prints how long it took, and fails loudly if check() is false. */
async function step<T>(name: string, run: () => Promise<T>, check: (value: T) => boolean = () => true): Promise<T> {
  const start = performance.now();
  const value = await run();
  const ms = Math.round(performance.now() - start);
  if (!check(value)) throw new Error(`Bước "${name}" trả về kết quả sai: ${JSON.stringify(value)}`);
  console.log(`✔ ${name} (${ms} ms)`);
  return value;
}

function questions(n: number, length = 40): QuestionInput[] {
  return Array.from({ length: n }, (_, i) => ({
    text: `Câu kiểm tra ${i + 1} `.padEnd(length, 'x'),
    answers: [0, 1, 2, 3].map((j) => ({ text: `Đáp án ${j + 1} của câu ${i + 1}`, correct: j === 0 })),
  }));
}

const db = openDb({ url });
const prisma = createPrisma({ url });
const email = `smoke-${Date.now()}@example.invalid`;
let teacherId: number | null = null;

try {
  const applied = await step('Chạy migration', () => applyMigrations(db));
  console.log(`  migration mới chạy: ${applied.length ? applied.join(', ') : 'không có (đã chạy từ trước)'}`);
  await step('Chạy migration lần hai không đổi gì', () => applyMigrations(db), (names) => names.length === 0);

  teacherId = await step('Tạo giáo viên', () => createTeacher(prisma, { email, name: 'Kiểm tra Smoke', password: 'matkhau-smoke' }));
  const id = teacherId;
  const session = await step('Tạo phiên đăng nhập', () => createSession(prisma, id));
  await step('Đọc phiên đăng nhập', () => findSessionTeacher(prisma, session.token), (t) => t?.id === id);
  await step('Đăng xuất', () => deleteSession(prisma, session.token));

  const homework = await step('Tạo bài tập (3 câu, một giao dịch)', () =>
    createHomework(prisma, { teacherId: id, title: 'Bài kiểm tra smoke', questions: questions(3), shuffleQuestions: true }),
  );
  await step('Sửa câu hỏi khi chưa có bài nộp', () =>
    updateHomework(prisma, { id: homework.id, teacherId: id, title: 'Bài kiểm tra smoke', questions: questions(3).reverse(), shuffleQuestions: true }),
  );

  const page = await step('Trang làm bài của học sinh', () => getQuestionsForStudent(prisma, homework.shareCode, 'Học sinh Smoke'), (p) =>
    p !== null && p.questions.length === 3 && p.questions.every((q) => !('correct' in q.answers[0]!)),
  );
  const saved = (await getHomework(prisma, homework.id))!;
  const correct = new Map(saved.questions.map((q) => [q.id, q.answers.find((a) => a.correct)!.id]));
  const [first, second] = page!.questions;
  const choices = new Map<number, number | null>([
    [first!.id, correct.get(first!.id)!],
    [second!.id, correct.get(second!.id)!],
  ]); // the third is left blank
  const submitted = await step(
    'Nộp bài và chấm điểm (một giao dịch)',
    () =>
      submitAnswers(prisma, {
        shareCode: homework.shareCode,
        name: 'Học sinh Smoke',
        versionId: page!.versionId,
        questionIds: page!.questions.map((q) => q.id),
        choices,
      }),
    (r) => r.score === 6.75,
  );
  await step('Trang kết quả', () => getResult(prisma, homework.shareCode, submitted.token), (r) => r?.correctCount === 2 && r.questions?.length === 3);

  await step('Sửa câu hỏi khi đã có bài nộp → phiên bản 2', () =>
    updateHomework(prisma, { id: homework.id, teacherId: id, title: 'Bài kiểm tra smoke', questions: questions(2), shuffleQuestions: true }),
    (r) => r?.version === 2 && r.newVersion,
  );
  const rows = await step('Danh sách bài nộp cho giáo viên', () => listSubmissions(prisma, homework.id), (r) => r.length === 1);
  await step('Thống kê từng câu', () => questionStats(prisma, page!.versionId), (s) => s.length === 3 && s[0]!.correctCount + s[0]!.blankCount <= 1);
  await step('Tạo file CSV', async () => submissionsCsv(rows), (csv) => csv.includes('Học sinh Smoke,6.75,2,3,1,'));
  await step('Xoá bài nộp', () => deleteSubmission(prisma, { homeworkId: homework.id, teacherId: id, submissionId: rows[0]!.id }), (ok) => ok);

  // The case behind the 30 s transaction timeout: about 1000 rows in one save.
  const big = await step('Lưu bài 200 câu × 4 đáp án (một giao dịch)', () =>
    createHomework(prisma, { teacherId: id, title: 'Bài kiểm tra smoke 200 câu', questions: questions(200, 400) }),
  );
  await step('Đọc lại bài 200 câu', () => getHomework(prisma, big.id), (h) => h?.questions.length === 200);

  for (const h of [homework, big]) {
    await step(`Xoá bài tập ${h.shareCode}`, () => deleteHomework(prisma, { id: h.id, teacherId: id, submissionsConfirmed: true }), (r) => r === 'deleted');
  }
  console.log('\n✔ Kiểm tra xong: cơ sở dữ liệu Turso hoạt động với website.');
} catch (error) {
  console.error('\n✖ Kiểm tra thất bại:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // Removes the teacher and, by cascade, anything left behind by a failed step.
  if (teacherId !== null) {
    await prisma.teacher.delete({ where: { id: teacherId } }).catch((error: unknown) => {
      console.error('✖ Không xoá được giáo viên kiểm tra:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
    const left = await db.execute({ sql: 'SELECT count(*) AS n FROM teachers WHERE email = ?', args: [email] });
    console.log(Number(left.rows[0]!.n) === 0 ? '✔ Đã dọn dữ liệu kiểm tra' : '✖ Còn sót dữ liệu kiểm tra');
  }
  await prisma.$disconnect();
  db.close();
}
