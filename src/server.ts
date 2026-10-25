// Starts the website: npm run dev (restarts when files change) or npm start.
import './load-env.ts';
import { applyMigrations } from './config/migrate.ts';
import { createPrisma, openDb } from './config/client.ts';
import { productionProblems } from './config/production.ts';
import { existsSync } from 'node:fs';
import { BROWSER_BUILD, createApp } from './app.ts';

const problems = productionProblems(process.env);
if (problems.length) {
  console.error(['✖ Thiếu cài đặt để chạy website (biến môi trường trên Render):', ...problems.map((p) => `  - ${p}`)].join('\n'));
  process.exit(1);
}

// Migrations run on a plain libSQL connection; the app itself uses Prisma.
const db = openDb();
await applyMigrations(db);
db.close();

if (!existsSync(BROWSER_BUILD.shared)) {
  console.warn('⚠ Chưa có JavaScript cho trình duyệt (thư mục dist/browser): trang soạn bài sẽ không chạy. Hãy chạy npm run build:browser.');
}

// Without INVITE_CODE (on your own computer) anyone can register as a teacher.
const inviteCode = process.env.INVITE_CODE?.trim() || null;
const port = Number(process.env.PORT) || 3000;
createApp({ prisma: createPrisma(), inviteCode }).listen(port, () => {
  console.log(`Website đang chạy ở http://localhost:${port}`);
});
