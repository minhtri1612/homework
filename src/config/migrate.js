// Applies the SQL files in prisma/migrations/ to a database: the local file,
// a test database or Turso. Prisma generates these files (npm run db:migration)
// but cannot apply them to Turso, so this does it for every database alike.
// Applied migrations are recorded in the table _migrations.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../prisma/migrations', import.meta.url));

/** The migrations in a folder, oldest first: [{ name, sql, checksum }]. */
export function readMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'migration.sql')))
    .map((entry) => {
      const sql = readFileSync(join(dir, entry.name, 'migration.sql'), 'utf8');
      return { name: entry.name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Runs every migration not applied yet, each in its own write transaction
 * together with its _migrations row, so a failed migration leaves nothing
 * behind. db is a @libsql/client client. Returns the names it applied.
 */
export async function applyMigrations(db, { dir = MIGRATIONS_DIR } = {}) {
  await db.execute(`CREATE TABLE IF NOT EXISTS _migrations (
    name       TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const applied = [];
  for (const migration of readMigrations(dir)) {
    const tx = await db.transaction('write');
    try {
      // Checked inside the write transaction: two servers starting at once
      // cannot both apply the same migration.
      const done = await tx.execute({ sql: 'SELECT checksum FROM _migrations WHERE name = ?', args: [migration.name] });
      if (done.rows.length) {
        if (done.rows[0].checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} đã chạy trên cơ sở dữ liệu này nhưng file migration.sql đã bị sửa sau đó. ` +
              'Không sửa migration đã chạy; hãy tạo migration mới (npm run db:migration -- <tên>).',
          );
        }
        continue;
      }
      await tx.executeMultiple(migration.sql);
      await tx.execute({
        sql: 'INSERT INTO _migrations (name, checksum, applied_at) VALUES (?, ?, ?)',
        args: [migration.name, migration.checksum, new Date().toISOString()],
      });
      await tx.commit();
      applied.push(migration.name);
    } finally {
      tx.close();
    }
  }
  return applied;
}
