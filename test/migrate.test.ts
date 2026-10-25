import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, readMigrations, MIGRATIONS_DIR } from '../src/config/migrate.ts';
import { openDb } from '../src/config/client.ts';
import type { Client } from '@libsql/client';

// Each run uses fresh database files in a temporary folder, never data/local.db.
let dir: string;
let count = 0;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'homework-test-'));
});

after(() => rmSync(dir, { recursive: true, force: true }));

function freshDb() {
  return openDb({ url: `file:${join(dir, `migrate-${++count}.db`)}` });
}

/** A copy of prisma/migrations that a test may change. */
function copyMigrations() {
  const copy = join(dir, `migrations-${++count}`);
  cpSync(MIGRATIONS_DIR, copy, { recursive: true });
  return copy;
}

async function tables(db: Client) {
  const result = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return result.rows.map((row) => row.name);
}

describe('applyMigrations', () => {
  test('creates every table and records the migration', async () => {
    const db = freshDb();
    const applied = await applyMigrations(db);
    assert.deepEqual(applied, readMigrations().map((m) => m.name));
    assert.deepEqual(await tables(db), [
      '_migrations',
      'answers',
      'attempts',
      'homework_versions',
      'homeworks',
      'questions',
      'sessions',
      'submission_answers',
      'submissions',
      'teachers',
    ]);
    db.close();
  });

  test('running it again changes nothing', async () => {
    const db = freshDb();
    await applyMigrations(db);
    await db.execute("INSERT INTO teachers (email, name, password_hash, created_at) VALUES ('a@b.vn', 'A', 'x', 'now')");
    assert.deepEqual(await applyMigrations(db), []);
    assert.equal((await db.execute('SELECT count(*) AS n FROM teachers')).rows[0].n, 1);
    db.close();
  });

  test('only new migrations run, in name order', async () => {
    const migrations = copyMigrations();
    const db = freshDb();
    await applyMigrations(db, { dir: migrations });
    for (const [name, sql] of [
      ['20990102000000_second', 'ALTER TABLE teachers ADD COLUMN b TEXT;'],
      ['20990101000000_first', 'ALTER TABLE teachers ADD COLUMN a TEXT;'],
    ]) {
      mkdirSync(join(migrations, name));
      writeFileSync(join(migrations, name, 'migration.sql'), sql);
    }
    assert.deepEqual(await applyMigrations(db, { dir: migrations }), ['20990101000000_first', '20990102000000_second']);
    db.close();
  });

  test('a failing migration is rolled back completely and not recorded', async () => {
    const migrations = copyMigrations();
    const db = freshDb();
    await applyMigrations(db, { dir: migrations });
    mkdirSync(join(migrations, '20990101000000_broken'));
    writeFileSync(join(migrations, '20990101000000_broken', 'migration.sql'), 'CREATE TABLE half_done (x INTEGER);\nNOT VALID SQL;');
    await assert.rejects(applyMigrations(db, { dir: migrations }));
    assert.equal((await tables(db)).includes('half_done'), false);
    const recorded = await db.execute("SELECT count(*) AS n FROM _migrations WHERE name = '20990101000000_broken'");
    assert.equal(recorded.rows[0].n, 0);
    db.close();
  });

  test('editing a migration that already ran is refused', async () => {
    const migrations = copyMigrations();
    const db = freshDb();
    await applyMigrations(db, { dir: migrations });
    const [first] = readMigrations(migrations);
    writeFileSync(join(migrations, first.name, 'migration.sql'), `${first.sql}\n-- edited`);
    await assert.rejects(applyMigrations(db, { dir: migrations }), /đã bị sửa/);
    db.close();
  });
});

describe('rules written by hand in the init migration', () => {
  let db: Client;
  before(async () => {
    db = freshDb();
    await applyMigrations(db);
    await db.executeMultiple(`
      INSERT INTO teachers (id, email, name, password_hash, created_at) VALUES (1, 'Lan@Example.com', 'Lan', 'x', 't');
      INSERT INTO homeworks (id, teacher_id, title, share_code, created_at, updated_at) VALUES (1, 1, 'Bài', 'ABCDEF', 't', 't');
      INSERT INTO homework_versions (id, homework_id, number, created_at) VALUES (1, 1, 1, 't');
      INSERT INTO questions (id, version_id, position, text) VALUES (1, 1, 1, 'Q?'), (2, 1, 2, 'Q2?');
      INSERT INTO answers (id, question_id, position, text, is_correct) VALUES (1, 1, 1, 'a', 1), (2, 1, 2, 'b', 0), (3, 2, 1, 'c', 1);
    `);
  });
  after(() => db.close());

  test('email is unique in any letter case (COLLATE NOCASE)', async () => {
    await assert.rejects(
      db.execute("INSERT INTO teachers (email, name, password_hash, created_at) VALUES ('LAN@example.COM', 'X', 'x', 't')"),
      /UNIQUE/,
    );
  });

  test('CHECK constraints', async () => {
    for (const sql of [
      "INSERT INTO homeworks (teacher_id, title, share_code, created_at, updated_at) VALUES (1, '  ', 'BBBBBB', 't', 't')",
      "INSERT INTO homeworks (teacher_id, title, share_code, reveal_mode, created_at, updated_at) VALUES (1, 'x', 'CCCCCC', 'sometimes', 't', 't')",
      "INSERT INTO homeworks (teacher_id, title, share_code, reveal_mode, created_at, updated_at) VALUES (1, 'x', 'DDDDDD', 'after_deadline', 't', 't')",
      "INSERT INTO homeworks (teacher_id, title, share_code, shuffle_questions, created_at, updated_at) VALUES (1, 'x', 'EEEEEE', 2, 't', 't')",
      "INSERT INTO homework_versions (homework_id, number, created_at) VALUES (1, 0, 't')",
      "INSERT INTO answers (question_id, position, text) VALUES (2, 2, ' ')",
      `INSERT INTO submissions (homework_id, version_id, student_name, student_key, submitted_at, correct_count, total_count, score)
       VALUES (1, 1, 'An', 'an', 't', 3, 2, 5)`,
      `INSERT INTO submissions (homework_id, version_id, student_name, student_key, submitted_at, correct_count, total_count, score)
       VALUES (1, 1, 'An', 'an', 't', 1, 2, 11)`,
      `INSERT INTO submissions (homework_id, version_id, student_name, student_key, submitted_at, correct_count, total_count, score)
       VALUES (1, 1, ' ', 'x', 't', 1, 2, 5)`,
    ]) {
      await assert.rejects(db.execute(sql), /CHECK/, sql);
    }
  });

  test('at most one correct answer per question (partial unique index)', async () => {
    await assert.rejects(db.execute("INSERT INTO answers (question_id, position, text, is_correct) VALUES (1, 3, 'd', 1)"), /UNIQUE/);
    await db.execute("INSERT INTO answers (question_id, position, text, is_correct) VALUES (1, 3, 'd', 0)");
  });

  test('a chosen answer must belong to its question; deleting a homework with submissions works', async () => {
    await db.execute(`INSERT INTO submissions (id, homework_id, version_id, student_name, student_key, submitted_at, correct_count, total_count, score)
                      VALUES (1, 1, 1, 'An', 'an', 't', 1, 2, 5)`);
    await db.execute('INSERT INTO submission_answers VALUES (1, 1, 1), (1, 2, NULL)');
    await db.execute(`INSERT INTO submissions (id, homework_id, version_id, student_name, student_key, submitted_at, correct_count, total_count, score)
                      VALUES (2, 1, 1, 'Bình', 'bình', 't', 0, 2, 0)`);
    // Answer 1 exists but belongs to question 1, not question 2.
    await assert.rejects(db.execute('INSERT INTO submission_answers VALUES (2, 2, 1)'), /FOREIGN KEY/);

    await db.execute('DELETE FROM homeworks WHERE id = 1');
    for (const table of ['homework_versions', 'questions', 'answers', 'submissions', 'submission_answers']) {
      assert.equal((await db.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0].n, 0, table);
    }
  });
});
