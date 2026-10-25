// Creates the database tables:
//   npm run db:init     apply migrations not applied yet (safe to run any time)
//   npm run db:reset    DELETE everything and start empty (local file only)
import '../src/load-env.js';
import { openDb, dropSchema, isLocal, DEFAULT_URL } from '../src/db/client.js';
import { applyMigrations } from '../src/config/migrate.js';

const url = process.env.DATABASE_URL || DEFAULT_URL;
const reset = process.argv.includes('--reset');
const db = openDb({ url });

if (reset) {
  if (!isLocal(url)) {
    console.error('✖ Chỉ được xoá cơ sở dữ liệu trên máy cá nhân (file:...), không xoá cơ sở dữ liệu thật.');
    process.exit(1);
  }
  await dropSchema(db);
  console.log('Đã xoá toàn bộ dữ liệu.');
}
const applied = await applyMigrations(db);
for (const name of applied) console.log(`  đã chạy migration ${name}`);
console.log(`✔ Cơ sở dữ liệu sẵn sàng: ${url}`);
db.close();
