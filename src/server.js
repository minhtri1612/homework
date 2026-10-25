// Starts the website: npm run dev (restarts when files change) or npm start.
import './load-env.js';
import { applyMigrations } from './config/migrate.ts';
import { createPrisma, openDb } from './config/client.ts';
import { createApp } from './app.js';

// Migrations run on a plain libSQL connection; the app itself uses Prisma.
const db = openDb();
await applyMigrations(db);
db.close();

const port = Number(process.env.PORT) || 3000;
createApp({ prisma: createPrisma() }).listen(port, () => {
  console.log(`Website đang chạy ở http://localhost:${port}`);
});
