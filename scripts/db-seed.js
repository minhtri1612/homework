// Fills the database with a sample teacher and two homework sets:
//   npm run db:seed
// The questions go through the same parser teachers will use.
import '../src/load-env.js';
import { openDb, initSchema, DEFAULT_URL } from '../src/db/client.js';
import { createTeacher } from '../src/db/teachers.js';
import { createHomework } from '../src/db/homeworks.js';
import { parse } from '../src/shared/parser.js';

const TEACHER = { email: 'giaovien@example.com', name: 'Cô Lan', password: 'matkhau123' };

const HOMEWORKS = [
  `BÀI TẬP TIẾNG VIỆT – LỚP 3

Câu 1: Con cua có mấy càng?
==2
3
4
5

Câu 2. Từ nào viết đúng chính tả?
A. sáng xủa
==B. sáng sủa
C. xáng sủa
D. xáng xủa

3. Đọc câu thơ sau:
"Trăm năm trong cõi người ta"
Câu thơ trên của ai?
A. Hồ Xuân Hương      ==B. Nguyễn Du
C. Nguyễn Trãi        D. Tố Hữu

4. Từ nào là từ chỉ hoạt động?
==A. chạy
B. đẹp
C. cao`,

  `ÔN TẬP TOÁN – LỚP 3

1. 7 × 8 = ?   A. 54   ==B. 56   C. 64   D. 48
2. Số liền sau của 999 là: A. 998  ==B. 1000  C. 1001
3. Một hình vuông có cạnh 5 cm. Chu vi hình vuông là:
A. 10 cm
==B. 20 cm
C. 25 cm`,
];

const db = openDb();
await initSchema(db);

const existing = await db.execute({ sql: 'SELECT 1 FROM teachers WHERE email = ?', args: [TEACHER.email] });
if (existing.rows.length) {
  console.log(`Đã có dữ liệu mẫu (${TEACHER.email}). Muốn làm lại từ đầu: npm run db:reset rồi npm run db:seed`);
  process.exit(0);
}

const teacherId = await createTeacher(db, TEACHER);
console.log(`✔ Giáo viên: ${TEACHER.email} / mật khẩu: ${TEACHER.password}`);

for (const text of HOMEWORKS) {
  const { title, questions } = parse(text);
  const { shareCode } = await createHomework(db, {
    teacherId,
    title,
    questions: questions.map((q) => ({ ...q, shuffleAnswers: true })),
  });
  console.log(`✔ ${title}: ${questions.length} câu, mã ${shareCode}`);
}

console.log(`Xong: ${process.env.DATABASE_URL || DEFAULT_URL}`);
db.close();
