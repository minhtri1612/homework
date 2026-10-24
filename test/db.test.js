import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, initSchema } from '../src/db/client.js';
import { createTeacher } from '../src/db/teachers.js';
import { createHomework, getHomework, generateShareCode, HomeworkValidationError } from '../src/db/homeworks.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { parse } from '../src/shared/parser.js';

// Each run uses a fresh database file in a temporary folder, never data/local.db.
let dir;
let db;
let teacherId;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'homework-test-'));
  db = openDb({ url: `file:${join(dir, 'test.db')}` });
  await initSchema(db);
  teacherId = await createTeacher(db, { email: 'Co.Lan@Example.com ', name: 'Cô Lan', password: 'bí mật' });
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const TEXT = `Bài 1: Ôn tập

Con cua có mấy càng?
==2
3

Câu 2. Thủ đô của Việt Nam là: A. Huế  ==B. Hà Nội  C. Đà Nẵng`;

async function count(table) {
  return (await db.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0].n;
}

describe('schema', () => {
  test('running it again changes nothing', async () => {
    await initSchema(db);
    assert.equal(await count('teachers'), 1);
  });

  test('foreign keys are enforced, also inside transactions', async () => {
    await assert.rejects(db.execute('INSERT INTO homeworks (teacher_id, title, share_code) VALUES (999, ?, ?)', ['x', 'ZZZZZZ']), /FOREIGN KEY/);
    const tx = await db.transaction('write');
    try {
      await assert.rejects(tx.execute('INSERT INTO homeworks (teacher_id, title, share_code) VALUES (999, ?, ?)', ['x', 'ZZZZZZ']), /FOREIGN KEY/);
    } finally {
      tx.close();
    }
  });
});

describe('teachers', () => {
  test('email is stored lower-case and is unique in any letter case', async () => {
    const row = (await db.execute('SELECT email FROM teachers WHERE id = ?', [teacherId])).rows[0];
    assert.equal(row.email, 'co.lan@example.com');
    await assert.rejects(createTeacher(db, { email: 'CO.LAN@example.com', name: 'X', password: 'y' }), /UNIQUE/);
  });

  test('password is hashed and can be verified', async () => {
    const { password_hash: hash } = (await db.execute('SELECT password_hash FROM teachers WHERE id = ?', [teacherId])).rows[0];
    assert.match(hash, /^scrypt\$/);
    assert.equal(await verifyPassword('bí mật', hash), true);
    assert.equal(await verifyPassword('bi mat', hash), false);
  });

  test('Vietnamese passwords match whichever way they were typed (NFC/NFD)', async () => {
    const hash = await hashPassword('mật khẩu'.normalize('NFD'));
    assert.equal(await verifyPassword('mật khẩu'.normalize('NFC'), hash), true);
  });
});

describe('homeworks', () => {
  test('parsed text is saved and loaded back unchanged', async () => {
    const { title, questions } = parse(TEXT);
    const { id, shareCode } = await createHomework(db, { teacherId, title, questions });
    const homework = await getHomework(db, id);

    assert.equal(homework.title, 'Bài 1: Ôn tập');
    assert.equal(homework.shareCode, shareCode);
    assert.equal(homework.revealMode, 'after_submit');
    assert.equal(homework.deadline, null);
    assert.deepEqual(homework.version.number, 1);
    assert.deepEqual(
      homework.questions.map((q) => ({ text: q.text, answers: q.answers.map((a) => (a.correct ? `==${a.text}` : a.text)) })),
      [
        { text: 'Con cua có mấy càng?', answers: ['==2', '3'] },
        { text: 'Thủ đô của Việt Nam là:', answers: ['Huế', '==Hà Nội', 'Đà Nẵng'] },
      ],
    );
  });

  test('settings are stored; deadline in UTC', async () => {
    const { id } = await createHomework(db, {
      teacherId,
      title: 'Có hạn nộp',
      questions: parse(TEXT).questions.map((q) => ({ ...q, shuffleAnswers: true })),
      revealMode: 'after_deadline',
      deadline: '2026-11-01T17:00:00+07:00',
      shuffleQuestions: true,
    });
    const homework = await getHomework(db, id);
    assert.equal(homework.deadline, '2026-11-01T10:00:00.000Z');
    assert.equal(homework.revealMode, 'after_deadline');
    assert.equal(homework.shuffleQuestions, true);
    assert.equal(homework.questions.every((q) => q.shuffleAnswers), true);
  });

  test('invalid homework is rejected with Vietnamese messages and nothing is written', async () => {
    const before = await count('homeworks');
    const { questions } = parse('Q?\n2\n3');
    await assert.rejects(
      createHomework(db, { teacherId, title: '  ', questions, revealMode: 'after_deadline' }),
      (error) => {
        assert.ok(error instanceof HomeworkValidationError);
        assert.deepEqual(error.errors.map((e) => e.code), ['NO_TITLE', 'NO_CORRECT', 'NO_DEADLINE']);
        assert.equal(error.errors[1].question, 1);
        return true;
      },
    );
    await assert.rejects(createHomework(db, { teacherId, title: 'x', questions: [] }), /chưa có câu hỏi/);
    assert.equal(await count('homeworks'), before);
  });

  test('getHomework returns null for an unknown id', async () => {
    assert.equal(await getHomework(db, 999999), null);
  });

  test('share codes have 6 characters and no look-alikes', () => {
    for (let i = 0; i < 200; i++) assert.match(generateShareCode(), /^[A-HJKMNP-Z2-9]{6}$/);
  });

  test('deleting a homework deletes its versions, questions and answers', async () => {
    const { id } = await createHomework(db, { teacherId, title: 'Xoá', questions: parse(TEXT).questions });
    const answersBefore = await count('answers');
    await db.execute('DELETE FROM homeworks WHERE id = ?', [id]);
    assert.equal(await count('answers'), answersBefore - 5);
    assert.equal((await db.execute('SELECT count(*) AS n FROM homework_versions WHERE homework_id = ?', [id])).rows[0].n, 0);
  });
});

describe('database rules (a second line of defence behind the app)', () => {
  let homework;
  before(async () => {
    const { id } = await createHomework(db, { teacherId, title: 'Quy tắc', questions: parse(TEXT).questions });
    homework = await getHomework(db, id);
  });

  test('a question cannot get a second correct answer', async () => {
    const [question] = homework.questions;
    await assert.rejects(
      db.execute('INSERT INTO answers (question_id, position, text, is_correct) VALUES (?, 9, ?, 1)', [question.id, 'thêm']),
      /UNIQUE/,
    );
  });

  async function submit(name, choices) {
    const row = await db.execute({
      sql: `INSERT INTO submissions (homework_id, version_id, student_name, student_key, correct_count, total_count, score)
            VALUES (?, ?, ?, ?, 0, 2, 0) RETURNING id`,
      args: [homework.id, homework.version.id, name, name.toLowerCase()],
    });
    const submissionId = row.rows[0].id;
    for (const [questionId, answerId] of choices) {
      await db.execute('INSERT INTO submission_answers VALUES (?, ?, ?)', [submissionId, questionId, answerId]);
    }
    return submissionId;
  }

  test('a chosen answer must belong to its question; blank (NULL) is allowed', async () => {
    const [q1, q2] = homework.questions;
    await submit('An', [[q1.id, q1.answers[0].id], [q2.id, null]]);
    await assert.rejects(submit('Bình', [[q1.id, q2.answers[0].id]]), /FOREIGN KEY/);
  });

  test('one submission per student name per homework', async () => {
    await assert.rejects(submit('an', []), /UNIQUE/);
  });
});
