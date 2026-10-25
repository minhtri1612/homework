import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTeacher } from '../src/services/teacher.service.ts';
import { createHomework, getHomework, updateHomework } from '../src/services/homework.service.ts';
import { normalizeShareCode } from '../src/services/share-code.service.ts';
import { parse } from '../src/shared/parser.js';
import { startApp, sessionCookie } from './helpers.ts';
import type { TestApp } from './helpers.ts';
/** What getHomework() returns for a homework that exists. */
type Homework = NonNullable<Awaited<ReturnType<typeof getHomework>>>;

let app: TestApp;
let db: TestApp['db'];
let prisma: TestApp['prisma'];
let get: TestApp['get'];
let base: string;
let teacherId: number;
let cookie: string | null;
let homework: Homework;

// Answer texts that must never appear on the student's page.
const TEXT = `Con cua có mấy càng?
==hai-càng-đúng
ba-càng-sai

Thủ đô của Việt Nam là: A. Huế-sai  ==B. Hà-Nội-đúng  C. Đà-Nẵng-sai`;

before(async () => {
  app = await startApp();
  ({ db, prisma, get, base } = app);
  teacherId = await createTeacher(prisma, { email: 'lan@example.com', name: 'Cô Lan', password: 'matkhau123' });
  cookie = sessionCookie(await app.post('/login', { email: 'lan@example.com', password: 'matkhau123' }));
  const { id } = await createHomework(prisma, {
    teacherId,
    title: 'Ôn tập tuần 8',
    questions: parse(TEXT).questions,
    deadline: '2099-11-01T17:00:00+07:00',
  });
  homework = (await getHomework(prisma, id))!;
});

after(() => app.close());

describe('normalizeShareCode', () => {
  test('any letter case, spaces, dashes and whole links are accepted', () => {
    for (const input of ['abc234', ' ABC234 ', 'abc 234', 'ABC-234', 'https://ví-dụ.vn/h/abc234', '/h/ABC234?x=1']) {
      assert.equal(normalizeShareCode(input), 'ABC234', input);
    }
  });

  test('anything that cannot be a code gives null', () => {
    // Too short / too long, and 0, O, 1, I, L, which codes never contain.
    for (const input of ['', '   ', 'ABC23', 'ABC2345', 'ABC230', 'ABCO23', 'ABC1IL', 'ẠBC234', null, undefined]) {
      assert.equal(normalizeShareCode(input), null, String(input));
    }
  });
});

describe('student page /h/CODE', () => {
  test('shows title, teacher, question count and deadline in Vietnam time, without logging in', async () => {
    const response = await get(`/h/${homework.shareCode}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<h1>Ôn tập tuần 8<\/h1>/);
    assert.match(html, /Cô Lan/);
    assert.match(html, /2 câu hỏi/);
    assert.match(html, /17:00 01\/11\/2099/);
    assert.doesNotMatch(html, /hết hạn/);
  });

  test('never contains questions or answers', async () => {
    const html = await (await get(`/h/${homework.shareCode}`)).text();
    for (const text of ['Con cua', 'càng', 'Huế', 'Hà-Nội', 'Đà-Nẵng', 'correct']) {
      assert.doesNotMatch(html, new RegExp(text), text);
    }
  });

  test('a code in lower case redirects to the upper-case address', async () => {
    const response = await get(`/h/${homework.shareCode.toLowerCase()}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/h/${homework.shareCode}`);
  });

  test('unknown or malformed code: 404 in Vietnamese', async () => {
    const unused = homework.shareCode === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';
    for (const path of [`/h/${unused}`, '/h/abc', '/h/%3Cscript%3E']) {
      const response = await get(path);
      assert.equal(response.status, 404, path);
      assert.match(await response.text(), /Không có bài tập nào với mã này/);
    }
  });

  test('past deadline: says the homework is closed', async () => {
    const { shareCode } = await createHomework(prisma, {
      teacherId,
      title: 'Bài cũ',
      questions: parse(TEXT).questions,
      deadline: '2020-01-01T00:00:00.000Z',
    });
    assert.match(await (await get(`/h/${shareCode}`)).text(), /Đã hết hạn nộp bài/);
  });

  test('no deadline', async () => {
    const { shareCode } = await createHomework(prisma, { teacherId, title: 'Không hạn', questions: parse(TEXT).questions });
    assert.match(await (await get(`/h/${shareCode}`)).text(), /Không có hạn nộp/);
  });

  test('question count follows the latest version', async () => {
    const { id, shareCode } = await createHomework(prisma, { teacherId, title: 'Có phiên bản', questions: parse(TEXT).questions });
    await db.execute({
      sql: `INSERT INTO submissions (homework_id, version_id, student_name, student_key, submitted_at, correct_count, total_count, score)
            VALUES (?, (SELECT id FROM homework_versions WHERE homework_id = ?), 'An', 'an', ?, 0, 2, 0)`,
      args: [id, id, new Date().toISOString()],
    });
    const questions = [...parse(TEXT).questions, ...parse('Câu mới?\n==x\ny').questions];
    assert.deepEqual(await updateHomework(prisma, { id, teacherId, title: 'Có phiên bản', questions }), { version: 2, newVersion: true });
    assert.match(await (await get(`/h/${shareCode}`)).text(), /3 câu hỏi/);
  });

  test('HTML in the title is shown as text', async () => {
    const { shareCode } = await createHomework(prisma, { teacherId, title: '<b>đậm</b>', questions: parse(TEXT).questions });
    const html = await (await get(`/h/${shareCode}`)).text();
    assert.doesNotMatch(html, /<b>đậm/);
    assert.match(html, /&lt;b&gt;đậm/);
  });
});

describe('code box on the home page', () => {
  test('the home page has the code form', async () => {
    const html = await (await get('/')).text();
    assert.match(html, /<form method="get" action="\/join"/);
    assert.match(html, /name="code"/);
  });

  test('a valid code (any form) opens the homework', async () => {
    const typed = ` ${homework.shareCode.slice(0, 3).toLowerCase()} ${homework.shareCode.slice(3)} `;
    const response = await get(`/join?code=${encodeURIComponent(typed)}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/h/${homework.shareCode}`);
  });

  test('a pasted link works too', async () => {
    const response = await get(`/join?code=${encodeURIComponent(`${base}/h/${homework.shareCode}`)}`);
    assert.equal(response.headers.get('location'), `/h/${homework.shareCode}`);
  });

  test('a wrong-looking code: 400, message, typed text kept (escaped)', async () => {
    const response = await get(`/join?code=${encodeURIComponent('ab"<x>')}`);
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /Mã bài tập gồm 6 chữ cái và chữ số/);
    assert.match(html, /value="ab&#34;&lt;x&gt;"/);
  });

  test('an empty code asks for one', async () => {
    for (const path of ['/join', '/join?code=', '/join?code=%20']) {
      const response = await get(path);
      assert.equal(response.status, 400, path);
      assert.match(await response.text(), /Hãy nhập mã bài tập/);
    }
  });

  test('a well-formed code that does not exist ends on the 404 page', async () => {
    const unused = homework.shareCode === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';
    const response = await get(`/join?code=${unused}`);
    assert.equal(response.headers.get('location'), `/h/${unused}`);
    assert.equal((await get(`/h/${unused}`)).status, 404);
  });
});

describe('teacher sees the full link', () => {
  test('on the dashboard, with a copy button', async () => {
    const html = await (await get('/teacher', cookie)).text();
    assert.match(html, new RegExp(`value="${base}/h/${homework.shareCode}" readonly`));
    assert.match(html, /data-copy/);
    assert.match(html, /<script type="module" src="\/js\/copy.js">/);
  });

  test('in the editor', async () => {
    const html = await (await get(`/teacher/homeworks/${homework.id}/edit`, cookie)).text();
    assert.match(html, new RegExp(`value="${base}/h/${homework.shareCode}" readonly`));
    assert.match(html, new RegExp(`href="${base}/h/${homework.shareCode}"`));
  });

  test('uses https behind a proxy that says so (Render)', async () => {
    const response = await fetch(`${base}/teacher`, { headers: { cookie: cookie!, 'x-forwarded-proto': 'https' } });
    assert.match(await response.text(), new RegExp(`value="https://${new URL(base).host}/h/${homework.shareCode}"`));
  });

  test('the copy script is served', async () => {
    const response = await get('/js/copy.js');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /javascript/);
  });
});
