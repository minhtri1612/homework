import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sessionCookie, type TestApp } from './helpers.ts';
import { createTeacher } from '../src/services/teacher.service.ts';
import { createHomework, getHomework, updateHomework, type QuestionInput } from '../src/services/homework.service.ts';
import { recordAway, startAttempt, submitAnswers } from '../src/services/submission.service.ts';
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
    const row = { id: 1, score: 7.25, correctCount: 1, totalCount: 2, versionNumber: 1, submittedAt: '2026-11-01T10:00:00.000Z', away: null };
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

describe('one submission in detail', () => {
  async function submissionIds(homeworkId: number): Promise<number[]> {
    const { rows } = await app.db.execute({ sql: 'SELECT id FROM submissions WHERE homework_id = ? ORDER BY submitted_at, id', args: [homeworkId] });
    return rows.map((row) => Number(row.id));
  }

  test('linked from the results; every question with the chosen and the correct answer; previous and next', async () => {
    const { id, shareCode } = await newHomework();
    await submit(id, shareCode, 'Lê Văn An', [0, 1, 0]);
    await submit(id, shareCode, 'Trần Bình', [1, null, 0]); // wrong, blank, right → 1/3
    await submit(id, shareCode, 'Cường', [0, 0, 1]);
    const [first, second, third] = await submissionIds(id);
    const url = `/teacher/homeworks/${id}/submissions/${second}`;

    const results = await (await app.get(`/teacher/homeworks/${id}/results`, cookie)).text();
    assert.ok(results.includes(`href="${url}"`));

    const page = await app.get(url, cookie);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<h1>Trần Bình<\/h1>/);
    assert.match(html, /<strong>3,25<\/strong> \/ 10 điểm · đúng 1\/3 câu/);
    assert.match(html, /Sai \(1\): <a href="#cau-1">câu 1<\/a>/);
    assert.match(html, /Bỏ trống \(1\): <a href="#cau-2">câu 2<\/a>/);
    assert.deepEqual([...html.matchAll(/✔ Đúng|✖ Bỏ trống|✖ Sai/g)].map((m) => m[0]), ['✖ Sai', '✖ Bỏ trống', '✔ Đúng']);
    assert.match(html, /<li class=" is-chosen">\s*B\. Huế\s*<span class="tag">học sinh chọn<\/span>/);
    assert.match(html, /<li class="is-correct ">\s*A\. Hà Nội\s*<span class="tag">đáp án đúng<\/span>/);
    assert.match(html, /<li class="is-correct is-chosen">\s*A\. Xanh\s*<span class="tag">học sinh chọn<\/span>\s*<span class="tag">đáp án đúng<\/span>/);
    assert.ok(html.includes(`href="/teacher/homeworks/${id}/submissions/${first}">← Học sinh trước`));
    assert.ok(html.includes(`href="/teacher/homeworks/${id}/submissions/${third}">Học sinh sau →`));

    const last = await (await app.get(`/teacher/homeworks/${id}/submissions/${third}`, cookie)).text();
    assert.ok(!last.includes('Học sinh sau'));
    const all = await (await app.get(`/teacher/homeworks/${id}/submissions/${first}`, cookie)).text();
    assert.match(all, /Đúng tất cả các câu/);
    assert.ok(!all.includes('Học sinh trước'));
  });

  test('the teacher sees the answers whatever the reveal mode; an older version shows its own questions', async () => {
    const { id, shareCode } = await createHomework(app.prisma, { teacherId, title: 'Không cho xem', questions: QUESTIONS, revealMode: 'never' });
    await submit(id, shareCode, 'Cũ', [1, 1, 0]);
    await updateHomework(app.prisma, { id, teacherId, title: 'Không cho xem', revealMode: 'never', questions: QUESTIONS.slice(1) });
    const [old] = await submissionIds(id);
    const html = await (await app.get(`/teacher/homeworks/${id}/submissions/${old}`, cookie)).text();
    assert.ok(html.includes('Thủ đô của Việt Nam?'), 'question 1 of version 1 is still shown');
    assert.match(html, /phiên bản 1/);
    assert.match(html, /đáp án đúng/);
  });

  test('with a time limit: time taken and leaving the page', async () => {
    const { id, shareCode } = await createHomework(app.prisma, { teacherId, title: 'Có giờ', questions: QUESTIONS, timeLimitMinutes: 40 });
    await startAttempt(app.prisma, id, 'Dũng');
    await app.post(`/h/${shareCode}/away`, { name: 'Dũng', event: 'leave' });
    await app.post(`/h/${shareCode}/away`, { name: 'Dũng', event: 'back', seconds: '30' });
    await submit(id, shareCode, 'Dũng', [0, 1, 0]);
    const [submissionId] = await submissionIds(id);
    const html = await (await app.get(`/teacher/homeworks/${id}/submissions/${submissionId}`, cookie)).text();
    assert.match(html, /làm trong \d+ giây/);
    assert.match(html, /⚠ Rời trang 1 lần, tổng 30 giây/);
  });

  test("another teacher, another homework's submission, a bad id, no login: never shown", async () => {
    const a = await newHomework();
    const b = await newHomework();
    await submit(a.id, a.shareCode, '<b>Quân</b>', [0, 1, 0]);
    const [submissionId] = await submissionIds(a.id);
    const url = `/teacher/homeworks/${a.id}/submissions/${submissionId}`;
    assert.equal((await app.get(url)).headers.get('location'), '/login');
    assert.equal((await app.get(url, otherCookie)).status, 404);
    assert.equal((await app.get(`/teacher/homeworks/${b.id}/submissions/${submissionId}`, cookie)).status, 404);
    for (const bad of ['abc', '0', '01', '999999']) {
      assert.equal((await app.get(`/teacher/homeworks/${a.id}/submissions/${bad}`, cookie)).status, 404, bad);
    }
    const html = await (await app.get(url, cookie)).text();
    assert.ok(html.includes('&lt;b&gt;Quân&lt;/b&gt;') && !html.includes('<b>Quân'));
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

describe('leaving the page (time limit)', () => {
  async function timedHomework() {
    const { id, shareCode } = await createHomework(app.prisma, { teacherId, title: 'Có giờ', questions: QUESTIONS, timeLimitMinutes: 40 });
    return { id, shareCode };
  }

  test('the answer page reports leaving and coming back; the teacher sees it per submission and in the CSV', async () => {
    const { id, shareCode } = await timedHomework();
    await startAttempt(app.prisma, id, 'Trần Bình');
    for (const seconds of [5, 15]) {
      assert.equal((await app.post(`/h/${shareCode}/away`, { name: 'trần  bình', event: 'leave' })).status, 204);
      assert.equal((await app.post(`/h/${shareCode}/away`, { name: 'Trần Bình', event: 'back', seconds: String(seconds) })).status, 204);
    }
    await startAttempt(app.prisma, id, 'An');
    await submit(id, shareCode, 'Trần Bình', [0, 1, 0]);
    await submit(id, shareCode, 'An', [0, 1, 0]);

    const html = await (await app.get(`/teacher/homeworks/${id}/results`, cookie)).text();
    assert.match(html, /<th>Rời trang<\/th>/);
    assert.match(html, /⚠ Rời trang 2 lần, tổng 20 giây/);
    assert.equal(html.match(/⚠ Rời trang/g)!.length, 1, 'nothing for An, who never left');

    const csv = await (await app.get(`/teacher/homeworks/${id}/results.csv`, cookie)).text();
    const lines = csv.slice(1).split('\r\n');
    assert.match(lines[0]!, /,Rời trang \(lần\),Thời gian rời trang \(giây\)$/);
    assert.match(lines[1]!, /^1,Trần Bình,.*,2,20$/);
    assert.match(lines[2]!, /^2,An,.*,0,0$/);
  });

  test('the answer page starts with the count so far, and the share page warns before starting', async () => {
    const { id, shareCode } = await timedHomework();
    assert.match(await (await app.get(`/h/${shareCode}`)).text(), /thầy cô sẽ thấy số lần và thời gian em rời trang/);
    await startAttempt(app.prisma, id, 'Cường');
    await recordAway(app.prisma, { shareCode, name: 'Cường', event: 'leave', seconds: 0 });
    const html = await (await app.get(`/h/${shareCode}/answer?name=C%C6%B0%E1%BB%9Dng`)).text();
    assert.match(html, /data-leave-count="1"/);
    assert.match(html, new RegExp(`data-away-url="/h/${shareCode}/away"`));
  });

  test('ignored without a time limit or before starting; bad reports are 400; time away is capped', async () => {
    const plain = await newHomework();
    assert.equal((await app.post(`/h/${plain.shareCode}/away`, { name: 'Dũng', event: 'leave' })).status, 204);
    assert.equal(await count('SELECT count(*) AS n FROM attempts WHERE homework_id = ?', [plain.id]), 0);
    assert.doesNotMatch(await (await app.get(`/teacher/homeworks/${plain.id}/results`, cookie)).text(), /Rời trang/);

    const { id, shareCode } = await timedHomework();
    assert.equal((await app.post(`/h/${shareCode}/away`, { name: 'Dũng', event: 'leave' })).status, 204);
    assert.equal(await count('SELECT count(*) AS n FROM attempts WHERE homework_id = ?', [id]), 0, 'not started: nothing created');
    const bad: Record<string, string>[] = [{ name: 'Dũng', event: 'other' }, { name: '', event: 'leave' }, { name: 'Dũng', event: 'back', seconds: '-3' }];
    for (const fields of bad) {
      assert.equal((await app.post(`/h/${shareCode}/away`, fields)).status, 400, JSON.stringify(fields));
    }
    await startAttempt(app.prisma, id, 'Dũng');
    await recordAway(app.prisma, { shareCode, name: 'Dũng', event: 'back', seconds: 9_999_999 });
    assert.equal(await count('SELECT away_seconds AS n FROM attempts WHERE homework_id = ?', [id]), 600 * 60);
  });

  test('started but not submitted: listed with status and warnings; "Cho làm lại" asks first, then resets', async () => {
    const { id, shareCode } = await timedHomework();
    await startAttempt(app.prisma, id, 'Em Đang Làm');
    await startAttempt(app.prisma, id, 'Em Hết Giờ', new Date(Date.now() - 50 * 60_000));
    await recordAway(app.prisma, { shareCode, name: 'Em Hết Giờ', event: 'leave', seconds: 0 });
    await startAttempt(app.prisma, id, 'Em Đã Nộp');
    await submit(id, shareCode, 'Em Đã Nộp', [0, 1, 0]);

    const html = await (await app.get(`/teacher/homeworks/${id}/results`, cookie)).text();
    assert.match(html, /Đã bắt đầu nhưng chưa nộp \(2\)/);
    assert.match(html, /Em Hết Giờ<\/td>[\s\S]*?Hết giờ, chưa nộp[\s\S]*?⚠ Rời trang 1 lần, tổng 0 giây/);
    assert.match(html, /Em Đang Làm<\/td>[\s\S]*?Đang làm, còn (39|40) phút/);

    const url = `/teacher/homeworks/${id}/attempts/${encodeURIComponent('em hết giờ')}/reset`;
    assert.ok(html.includes(`href="${url}"`));
    assert.equal((await app.get(url, otherCookie)).status, 404, "another teacher's homework");
    assert.equal((await app.post(url, {}, { cookie: otherCookie })).status, 404);
    const submittedUrl = `/teacher/homeworks/${id}/attempts/${encodeURIComponent('em đã nộp')}/reset`;
    assert.equal((await app.get(submittedUrl, cookie)).status, 404, 'a submitted student is reset by deleting the submission');

    assert.match(await (await app.get(url, cookie)).text(), /Cho học sinh làm lại\?[\s\S]*Em Hết Giờ/);
    assert.equal(await count('SELECT count(*) AS n FROM attempts WHERE homework_id = ?', [id]), 3, 'nothing changes on GET');
    const response = await app.post(url, {}, { cookie });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/teacher/homeworks/${id}/results?notice=attempt-reset`);
    assert.equal(await count("SELECT count(*) AS n FROM attempts WHERE homework_id = ? AND student_key = 'em hết giờ'", [id]), 0);
    assert.match(await (await app.get(response.headers.get('location')!, cookie)).text(), /Đã cho làm lại/);
  });
});
