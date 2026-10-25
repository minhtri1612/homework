import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sessionCookie, type TestApp } from './helpers.ts';
import { createTeacher } from '../src/services/teacher.service.ts';
import { createHomework, getHomework, updateHomework, type QuestionInput } from '../src/services/homework.service.ts';
import { submitAnswers } from '../src/services/submission.service.ts';
import { submissionsCsv } from '../src/services/results.service.ts';

let app: TestApp;
let teacherId: number;
let cookie: string;
let otherCookie: string;

before(async () => {
  app = await startApp();
  teacherId = await createTeacher(app.prisma, { email: 'lan@example.com', name: 'Cô Lan', password: 'matkhau123' });
  await createTeacher(app.prisma, { email: 'minh@example.com', name: 'Thầy Minh', password: 'matkhau123' });
  cookie = sessionCookie(await app.post('/login', { email: 'lan@example.com', password: 'matkhau123' }))!;
  otherCookie = sessionCookie(await app.post('/login', { email: 'minh@example.com', password: 'matkhau123' }))!;
});
after(() => app.close());

const QUESTIONS: QuestionInput[] = [
  { text: 'Thủ đô của Việt Nam?', answers: [{ text: 'Hà Nội', correct: true }, { text: 'Huế', correct: false }, { text: 'Đà Nẵng', correct: false }] },
  { text: '2 + 2 = ?', answers: [{ text: '3', correct: false }, { text: '4', correct: true }] },
  { text: 'Màu của lá cây?', answers: [{ text: 'Xanh', correct: true }, { text: 'Đỏ', correct: false }] },
];

async function newHomework(questions = QUESTIONS) {
  const { id, shareCode } = await createHomework(app.prisma, { teacherId, title: 'Kiểm tra 15 phút', questions });
  return { id, shareCode };
}

/** Submits through the service; picks[i] is the answer index chosen for question i (null = blank). */
async function submit(homeworkId: number, shareCode: string, name: string, picks: (number | null)[]) {
  const homework = (await getHomework(app.prisma, homeworkId))!;
  const choices = new Map(homework.questions.map((q, i) => [q.id, picks[i] === null || picks[i] === undefined ? null : q.answers[picks[i]!]!.id]));
  return submitAnswers(app.prisma, {
    shareCode,
    name,
    versionId: homework.version.id,
    questionIds: homework.questions.map((q) => q.id),
    choices,
  });
}

async function count(sql: string, args: (string | number)[] = []): Promise<number> {
  return Number((await app.db.execute({ sql, args })).rows[0]!.n);
}

describe('results page', () => {
  test('needs a login, and is 404 for another teacher', async () => {
    const { id } = await newHomework();
    assert.equal((await app.get(`/teacher/homeworks/${id}/results`)).headers.get('location'), '/login');
    assert.equal((await app.get(`/teacher/homeworks/${id}/results`, otherCookie)).status, 404);
    assert.equal((await app.get(`/teacher/homeworks/${id}/results.csv`, otherCookie)).status, 404);
  });

  test('lists submissions oldest first with score, correct count and average', async () => {
    const { id, shareCode } = await newHomework();
    await submit(id, shareCode, 'Lê Văn An', [0, 1, 0]); // 3/3 → 10
    await submit(id, shareCode, 'Trần Bình', [0, null, 1]); // 1/3 → 3.25
    const html = await (await app.get(`/teacher/homeworks/${id}/results`, cookie)).text();
    assert.ok(html.indexOf('Lê Văn An') < html.indexOf('Trần Bình'));
    assert.match(html, /<strong>10<\/strong>/);
    assert.match(html, /<strong>3,25<\/strong>/);
    assert.match(html, /1\/3/);
    assert.match(html, /<strong>2<\/strong> bài nộp · điểm trung bình <strong>6,63<\/strong>/);
    assert.ok(html.includes(`href="/teacher/homeworks/${id}/results.csv"`));
  });

  test('one version: statistics per question are shown', async () => {
    const { id, shareCode } = await newHomework();
    await submit(id, shareCode, 'A', [0, 1, 0]);
    await submit(id, shareCode, 'B', [1, 1, null]);
    await submit(id, shareCode, 'C', [0, 0, 0]);
    const html = await (await app.get(`/teacher/homeworks/${id}/results`, cookie)).text();
    assert.match(html, /2\/3 học sinh làm đúng \(67%\)/); // question 1
    assert.match(html, /2\/3 học sinh làm đúng \(67%\) · 1 bỏ trống/); // question 3
    assert.match(html, /Hà Nội <span class="tag">2 chọn · đáp án đúng<\/span>/);
    assert.match(html, /Huế <span class="tag">1 chọn<\/span>/);
  });

  test('several versions: all by default, filter and statistics per version, unknown version 404', async () => {
    const { id, shareCode } = await newHomework();
    await submit(id, shareCode, 'Cũ', [0, 1, 0]);
    await updateHomework(app.prisma, { id, teacherId, title: 'Kiểm tra 15 phút', questions: QUESTIONS.slice(0, 2) });
    await submit(id, shareCode, 'Mới', [1, 1]);

    let html = await (await app.get(`/teacher/homeworks/${id}/results`, cookie)).text();
    assert.match(html, /Phiên bản 1 \(1\)/);
    assert.match(html, /Phiên bản 2 \(1\)/);
    assert.ok(html.includes('Cũ') && html.includes('Mới'));
    assert.doesNotMatch(html, /học sinh làm đúng/, 'no statistics across versions with different questions');

    html = await (await app.get(`/teacher/homeworks/${id}/results?version=2`, cookie)).text();
    assert.ok(html.includes('Mới') && !html.includes('>Cũ<'));
    assert.match(html, /Từng câu hỏi \(phiên bản 2\)/);
    assert.match(html, /0\/1 học sinh làm đúng \(0%\)/);
    assert.ok(html.includes(`results.csv?version=2`));

    for (const bad of ['9', 'abc', '0']) {
      assert.equal((await app.get(`/teacher/homeworks/${id}/results?version=${bad}`, cookie)).status, 404, bad);
    }
  });

  test('names are shown as text, not HTML', async () => {
    const { id, shareCode } = await newHomework();
    await submit(id, shareCode, '<img src=x onerror=alert(1)>', [0, 1, 0]);
    const html = await (await app.get(`/teacher/homeworks/${id}/results`, cookie)).text();
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!html.includes('<img src=x'));
  });
});

describe('CSV export', () => {
  test('download with Vietnamese header, BOM, CRLF, score with a dot, Vietnam time', async () => {
    const { id, shareCode } = await newHomework();
    await submit(id, shareCode, 'Nguyễn Thị Hoa', [0, null, 1]);
    const response = await app.get(`/teacher/homeworks/${id}/results.csv`, cookie);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/csv; charset=utf-8/);
    assert.equal(response.headers.get('content-disposition'), `attachment; filename=ket-qua-${shareCode}.csv`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 byte order mark');
    const lines = new TextDecoder().decode(bytes.slice(3)).split('\r\n');
    assert.equal(lines[0], 'STT,Họ tên,Điểm,Số câu đúng,Tổng số câu,Phiên bản,Nộp lúc (giờ Việt Nam)');
    assert.match(lines[1]!, /^1,Nguyễn Thị Hoa,3\.25,1,3,1,\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.equal(lines[2], '', 'ends with a line break');
  });

  test('a version filter is applied and named in the file', async () => {
    const { id, shareCode } = await newHomework();
    await submit(id, shareCode, 'Một', [0, 1, 0]);
    await updateHomework(app.prisma, { id, teacherId, title: 'Kiểm tra 15 phút', questions: QUESTIONS.slice(1) });
    await submit(id, shareCode, 'Hai', [1, 0]);
    const response = await app.get(`/teacher/homeworks/${id}/results.csv?version=2`, cookie);
    assert.equal(response.headers.get('content-disposition'), `attachment; filename=ket-qua-${shareCode}-v2.csv`);
    const text = await response.text();
    assert.ok(text.includes('Hai') && !text.includes('Một'));
  });

  test('cells are quoted when needed; formulas are neutralised', () => {
    const row = { id: 1, score: 7.25, correctCount: 1, totalCount: 2, versionNumber: 1, submittedAt: '2026-11-01T10:00:00.000Z' };
    const csv = submissionsCsv([
      { ...row, studentName: 'Lê, Văn "Tí"' },
      { ...row, studentName: '=HYPERLINK("http://x")' },
      { ...row, studentName: '+84 912' },
      { ...row, studentName: '-1' },
      { ...row, studentName: '@SUM(A1)' },
    ]);
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines[1], '1,"Lê, Văn ""Tí""",7.25,1,2,1,2026-11-01 17:00');
    assert.equal(lines[2], `2,"'=HYPERLINK(""http://x"")",7.25,1,2,1,2026-11-01 17:00`);
    assert.equal(lines[3]!.split(',')[1], "'+84 912");
    assert.equal(lines[4]!.split(',')[1], "'-1");
    assert.equal(lines[5]!.split(',')[1], "'@SUM(A1)");
  });
});

describe('deleting a submission', () => {
  test('confirmation page, then deleted; the name can submit again', async () => {
    const { id, shareCode } = await newHomework();
    await submit(id, shareCode, 'Phúc', [0, 0, 0]);
    const submissionId = Number((await app.db.execute({ sql: 'SELECT id FROM submissions WHERE homework_id = ?', args: [id] })).rows[0]!.id);
    const url = `/teacher/homeworks/${id}/submissions/${submissionId}/delete`;

    const page = await app.get(url, cookie);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Học sinh: Phúc, 6,75 điểm/);
    assert.ok(html.includes(`action="${url}"`));

    const response = await app.post(url, {}, { cookie });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/teacher/homeworks/${id}/results?notice=submission-deleted`);
    assert.equal(await count('SELECT count(*) AS n FROM submissions WHERE homework_id = ?', [id]), 0);
    assert.equal(await count('SELECT count(*) AS n FROM submission_answers WHERE submission_id = ?', [submissionId]), 0);
    assert.match(await (await app.get(response.headers.get('location')!, cookie)).text(), /Đã xoá bài nộp/);

    await submit(id, shareCode, 'phúc', [0, 1, 0]);
    assert.equal(await count('SELECT count(*) AS n FROM submissions WHERE homework_id = ?', [id]), 1);
  });

  test("another teacher, another homework's submission, or a bad id: 404 and nothing deleted", async () => {
    const a = await newHomework();
    const b = await newHomework();
    await submit(a.id, a.shareCode, 'Quân', [0, 1, 0]);
    const submissionId = Number((await app.db.execute({ sql: 'SELECT id FROM submissions WHERE homework_id = ?', args: [a.id] })).rows[0]!.id);

    assert.equal((await app.get(`/teacher/homeworks/${a.id}/submissions/${submissionId}/delete`, otherCookie)).status, 404);
    assert.equal((await app.post(`/teacher/homeworks/${a.id}/submissions/${submissionId}/delete`, {}, { cookie: otherCookie })).status, 404);
    assert.equal((await app.post(`/teacher/homeworks/${b.id}/submissions/${submissionId}/delete`, {}, { cookie })).status, 404);
    assert.equal((await app.get(`/teacher/homeworks/${a.id}/submissions/abc/delete`, cookie)).status, 404);
    assert.equal(await count('SELECT count(*) AS n FROM submissions WHERE id = ?', [submissionId]), 1);
  });
});

describe('deleting a homework', () => {
  test('without submissions: confirmation page, then deleted', async () => {
    const { id, shareCode } = await newHomework();
    const page = await (await app.get(`/teacher/homeworks/${id}/delete`, cookie)).text();
    assert.match(page, /Kiểm tra 15 phút/);
    assert.match(page, /0 bài nộp/);
    assert.doesNotMatch(page, /type="checkbox"/);

    const response = await app.post(`/teacher/homeworks/${id}/delete`, {}, { cookie });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/teacher?notice=homework-deleted');
    assert.match(await (await app.get('/teacher?notice=homework-deleted', cookie)).text(), /Đã xoá bài tập/);
    assert.equal(await count('SELECT count(*) AS n FROM homeworks WHERE id = ?', [id]), 0);
    assert.equal((await app.get(`/h/${shareCode}`)).status, 404, 'the student link stops working');
  });

  test('with submissions: the box must be ticked; then everything is deleted', async () => {
    const { id, shareCode } = await newHomework();
    await submit(id, shareCode, 'Sơn', [0, 1, 0]);
    await submit(id, shareCode, 'Tú', [1, 0, 1]);
    const page = await (await app.get(`/teacher/homeworks/${id}/delete`, cookie)).text();
    assert.match(page, /2 bài nộp/);
    assert.match(page, /Tôi hiểu rằng 2 bài nộp của học sinh cũng bị xoá/);

    const refused = await app.post(`/teacher/homeworks/${id}/delete`, {}, { cookie });
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /Hãy đánh dấu ô xác nhận/);
    assert.equal(await count('SELECT count(*) AS n FROM homeworks WHERE id = ?', [id]), 1);

    const response = await app.post(`/teacher/homeworks/${id}/delete`, { confirm: '1' }, { cookie });
    assert.equal(response.status, 303);
    for (const table of ['homeworks WHERE id', 'homework_versions WHERE homework_id', 'submissions WHERE homework_id']) {
      assert.equal(await count(`SELECT count(*) AS n FROM ${table} = ?`, [id]), 0, table);
    }
  });

  test('a submission arriving after the page was opened still needs the confirmation', async () => {
    const { id, shareCode } = await newHomework();
    const page = await (await app.get(`/teacher/homeworks/${id}/delete`, cookie)).text();
    assert.doesNotMatch(page, /type="checkbox"/);
    await submit(id, shareCode, 'Vân', [0, 1, 0]);
    const response = await app.post(`/teacher/homeworks/${id}/delete`, {}, { cookie });
    assert.equal(response.status, 400);
    assert.equal(await count('SELECT count(*) AS n FROM homeworks WHERE id = ?', [id]), 1);
  });

  test('another teacher: 404 and not deleted; a foreign website: 403', async () => {
    const { id } = await newHomework();
    assert.equal((await app.get(`/teacher/homeworks/${id}/delete`, otherCookie)).status, 404);
    assert.equal((await app.post(`/teacher/homeworks/${id}/delete`, { confirm: '1' }, { cookie: otherCookie })).status, 404);
    assert.equal((await app.post(`/teacher/homeworks/${id}/delete`, { confirm: '1' }, { cookie, origin: 'https://evil.example' })).status, 403);
    assert.equal(await count('SELECT count(*) AS n FROM homeworks WHERE id = ?', [id]), 1);
  });

  test('the editor and the dashboard link to results and delete', async () => {
    const { id } = await newHomework();
    const editor = await (await app.get(`/teacher/homeworks/${id}/edit`, cookie)).text();
    assert.ok(editor.includes(`href="/teacher/homeworks/${id}/results"`));
    assert.ok(editor.includes(`href="/teacher/homeworks/${id}/delete"`));
    const dashboard = await (await app.get('/teacher', cookie)).text();
    assert.ok(dashboard.includes(`href="/teacher/homeworks/${id}/results"`));
  });
});
