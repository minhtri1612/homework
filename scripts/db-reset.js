// npm run db:reset: DELETES every table and its data, then applies all
// migrations again, leaving empty tables. Local file databases only.
import '../src/load-env.js';
import { applyMigrations, dropSchema } from '../src/config/migrate.ts';
import { openDb, isLocal, DEFAULT_URL } from '../src/config/client.ts';

const url = process.env.DATABASE_URL || DEFAULT_URL;
if (!isLocal(url)) {
  console.error('✖ Chỉ được xoá cơ sở dữ liệu trên máy cá nhân (file:...), không xoá cơ sở dữ liệu thật.');
  process.exit(1);
}
const db = openDb({ url });
await dropSchema(db);
console.log('Đã xoá toàn bộ dữ liệu.');
const applied = await applyMigrations(db);
for (const name of applied) console.log(`  đã chạy migration ${name}`);
console.log(`✔ Cơ sở dữ liệu sẵn sàng: ${url}`);
db.close();
