// Starts the website: npm run dev (restarts when files change) or npm start.
import './load-env.ts';
import { applyMigrations } from './config/migrate.ts';
import { createPrisma, openDb } from './config/client.ts';
import { existsSync } from 'node:fs';
import { BROWSER_BUILD, createApp } from './app.ts';

// Migrations run on a plain libSQL connection; the app itself uses Prisma.
const db = openDb();
await applyMigrations(db);
db.close();

if (!existsSync(BROWSER_BUILD.shared)) {
  console.warn('⚠ Chưa có JavaScript cho trình duyệt (thư mục dist/browser): trang soạn bài sẽ không chạy. Hãy chạy npm run build:browser.');
}

const port = Number(process.env.PORT) || 3000;
createApp({ prisma: createPrisma() }).listen(port, () => {
  console.log(`Website đang chạy ở http://localhost:${port}`);
});
