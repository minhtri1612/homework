import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTeacher } from '../src/services/teacher.service.ts';
import { createHomework, getHomework } from '../src/services/homework.service.ts';
import { startApp, sessionCookie } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let app: TestApp;
let db: TestApp['db'];
let prisma: TestApp['prisma'];
let get: TestApp['get'];
let post: TestApp['post'];
let lan: number;
let cookie: string | null;
let other: string | null;

const QUESTIONS = [{ text: 'Câu hỏi?', answers: [{ text: 'Đúng', correct: true }, { text: 'Sai', correct: false }] }];

async function homework(teacherId: number, title: string, grade: number | null = null): Promise<number> {
  return (await createHomework(prisma, { teacherId, title, questions: QUESTIONS, grade })).id;
}

/** The part of the dashboard for one grade (<details id="lop-N">) or for "Chưa xếp lớp". */
function part(html: string, id: string): string {
  const match = html.match(new RegExp(`<(details|section) id="${id}"[^>]*>[\\s\\S]*?</\\1>`));
  return match ? match[0] : '';
}

before(async () => {
  app = await startApp();
  ({ db, prisma, get, post } = app);
  lan = await createTeacher(prisma, { email: 'lan@example.com', name: 'Cô Lan', password: 'matkhau123' });
  await createTeacher(prisma, { email: 'minh@example.com', name: 'Thầy Minh', password: 'matkhau123' });
  cookie = sessionCookie(await post('/login', { email: 'lan@example.com', password: 'matkhau123' }));
  other = sessionCookie(await post('/login', { email: 'minh@example.com', password: 'matkhau123' }));
});

after(() => app.close());

describe('dashboard structure', () => {
  test('a teacher without homeworks sees every grade, closed, and no "Chưa xếp lớp" box', async () => {
    const html = await (await get('/teacher', other)).text();
    assert.match(html, /Chưa có bài tập nào/);
    assert.equal(part(html, 'chua-xep-lop'), '');
    assert.deepEqual([...html.matchAll(/<details id="lop-(\d+)"/g)].map((m) => m[1]), ['6', '7', '8', '9', '10', '11', '12']);
    assert.doesNotMatch(html, /<details[^>]*\bopen/);
  });

  test('each grade has Từ vựng, Ngữ pháp, Bài tập, a create link with the grade and the student page', async () => {
    const grade8 = part(await (await get('/teacher', other)).text(), 'lop-8');
    assert.match(grade8, /<h3>Từ vựng<\/h3>[\s\S]*<h3>Ngữ pháp<\/h3>[\s\S]*<h3>Bài tập<\/h3>/);
    assert.match(grade8, /href="\/teacher\/homeworks\/new\?grade=8"/);
    assert.match(grade8, /href="\/lop\/8\/bai-tap"/);
  });

  test('homeworks sit under their grade or in "Chưa xếp lớp"; other teachers\' are not shown', async () => {
    const placed = await homework(lan, 'Bài lớp 12 của cô Lan', 12);
    const unplaced = await homework(lan, 'Bài chưa xếp lớp của cô Lan');
    const minhId = (await db.execute("SELECT id FROM teachers WHERE email = 'minh@example.com'")).rows[0].id as number;
    await homework(minhId, 'Bài của thầy Minh', 12);

    const html = await (await get('/teacher', cookie)).text();
    const grade12 = part(html, 'lop-12');
    assert.match(grade12, /^<details id="lop-12" class="card grade-group" open>/);
    assert.match(grade12, new RegExp(`href="/teacher/homeworks/${placed}/edit">Bài lớp 12 của cô Lan<`));
    assert.doesNotMatch(grade12, /chưa xếp lớp của cô Lan/);
    const box = part(html, 'chua-xep-lop');
    assert.match(box, new RegExp(`href="/teacher/homeworks/${unplaced}/edit">Bài chưa xếp lớp của cô Lan<`));
    assert.doesNotMatch(box, /Bài lớp 12/);
    assert.doesNotMatch(html, /thầy Minh/);
    assert.doesNotMatch(part(html, 'lop-11'), /\bopen\b/);
  });

  test('each card has a move form with its current grade selected', async () => {
    const id = await homework(lan, 'Bài lớp 9', 9);
    const grade9 = part(await (await get('/teacher', cookie)).text(), 'lop-9');
    const form = grade9.match(new RegExp(`<form method="post" action="/teacher/homeworks/${id}/grade"[\\s\\S]*?</form>`))?.[0] ?? '';
    assert.match(form, /<option value="9" selected>Lớp 9<\/option>/);
    assert.equal([...form.matchAll(/ selected>/g)].length, 1);
  });
});

describe('moving a homework', () => {
  test('to a grade and back to "Chưa xếp lớp"', async () => {
    const id = await homework(lan, 'Bài sẽ chuyển');
    let response = await post(`/teacher/homeworks/${id}/grade`, { grade: '12' }, { cookie });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/teacher?notice=homework-moved#lop-12');
    assert.equal((await getHomework(prisma, id))!.grade, 12);
    assert.match(await (await get('/teacher?notice=homework-moved', cookie)).text(), /Đã chuyển bài tập\./);

    response = await post(`/teacher/homeworks/${id}/grade`, { grade: '' }, { cookie });
    assert.equal(response.headers.get('location'), '/teacher?notice=homework-moved#chua-xep-lop');
    assert.equal((await getHomework(prisma, id))!.grade, null);
  });

  test('keeps the version and the submissions', async () => {
    const id = await homework(lan, 'Bài đã có người nộp');
    const before = (await getHomework(prisma, id))!;
    await db.execute({
      sql: `INSERT INTO submissions (homework_id, version_id, student_name, student_key, submitted_at, correct_count, total_count, score)
            VALUES (?, ?, 'An', 'an', ?, 1, 1, 10)`,
      args: [id, before.version.id, new Date().toISOString()],
    });
    assert.equal((await post(`/teacher/homeworks/${id}/grade`, { grade: '7' }, { cookie })).status, 303);
    const after = (await getHomework(prisma, id))!;
    assert.equal(after.grade, 7);
    assert.equal(after.version.id, before.version.id);
    assert.equal(after.version.submissionCount, 1);
  });

  test('a grade outside 6–12: 400, nothing changes', async () => {
    const id = await homework(lan, 'Bài lớp 10', 10);
    for (const grade of ['5', '13', 'abc']) {
      const response = await post(`/teacher/homeworks/${id}/grade`, { grade }, { cookie });
      assert.equal(response.status, 400, grade);
      assert.match(await response.text(), /Hãy chọn lớp từ 6 đến 12/);
    }
    assert.equal((await getHomework(prisma, id))!.grade, 10);
  });

  test("another teacher's homework, an unknown id, no login, another site: refused, nothing changes", async () => {
    const id = await homework(lan, 'Bài của cô Lan', 6);
    assert.equal((await post(`/teacher/homeworks/${id}/grade`, { grade: '12' }, { cookie: other })).status, 404);
    assert.equal((await post('/teacher/homeworks/999999/grade', { grade: '12' }, { cookie })).status, 404);
    assert.equal((await post('/teacher/homeworks/abc/grade', { grade: '12' }, { cookie })).status, 404);
    const anonymous = await post(`/teacher/homeworks/${id}/grade`, { grade: '12' });
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), '/login');
    assert.equal((await post(`/teacher/homeworks/${id}/grade`, { grade: '12' }, { cookie, origin: 'https://evil.example' })).status, 403);
    assert.equal((await getHomework(prisma, id))!.grade, 6);
  });
});
