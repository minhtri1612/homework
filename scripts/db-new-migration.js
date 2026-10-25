// npm run db:migration -- <name>: after editing prisma/schema.prisma, writes
// the SQL that brings the existing migrations up to date with it into
// prisma/migrations/<UTC timestamp>_<name>/migration.sql. Nothing is applied:
// read the file first (see .claude/docs/database.md), then npm run db:init.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS_DIR } from '../src/config/migrate.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const name = process.argv[2] ?? '';
if (!/^[a-z0-9_]+$/.test(name)) {
  console.error('✖ Cần một tên ngắn gồm chữ thường, chữ số và dấu _, ví dụ: npm run db:migration -- add_student_email');
  process.exit(1);
}

const diff = spawnSync(
  join(ROOT, 'node_modules', '.bin', 'prisma'),
  ['migrate', 'diff', '--from-migrations', MIGRATIONS_DIR, '--to-schema', join(ROOT, 'prisma', 'schema.prisma'), '--script', '--exit-code'],
  { cwd: ROOT, encoding: 'utf8' },
);
// --exit-code: 0 = no difference, 2 = a migration is needed, anything else = error.
if (diff.status === 0) {
  console.log('Không có thay đổi: schema.prisma khớp với các migration hiện có.');
  process.exit(0);
}
if (diff.status !== 2) {
  process.stderr.write(diff.stderr);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const dir = join(MIGRATIONS_DIR, `${stamp}_${name}`);
mkdirSync(dir);
writeFileSync(join(dir, 'migration.sql'), diff.stdout);
console.log(`✔ Đã tạo ${join('prisma', 'migrations', `${stamp}_${name}`, 'migration.sql')}`);
if (diff.stdout.includes('RedefineTables')) {
  console.log(
    '⚠ Migration này tạo lại bảng (RedefineTables). Prisma bỏ mất các CHECK, COLLATE NOCASE và chỉ mục ' +
      'answers_one_correct viết tay của bảng đó: hãy thêm lại vào file trước khi chạy npm run db:init.',
  );
}
console.log('Đọc lại file, rồi chạy npm run db:init để áp dụng.');
