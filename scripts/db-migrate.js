// npm run db:init: applies the migrations in prisma/migrations/ that have not
// run on this database yet (safe to run any time; the server does it on start).
import '../src/load-env.js';
import { applyMigrations } from '../src/config/migrate.js';
import { openDb, DEFAULT_URL } from '../src/config/client.js';

const url = process.env.DATABASE_URL || DEFAULT_URL;
const db = openDb({ url });
const applied = await applyMigrations(db);
for (const name of applied) console.log(`  đã chạy migration ${name}`);
console.log(`✔ Cơ sở dữ liệu sẵn sàng: ${url}`);
db.close();
