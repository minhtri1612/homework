import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTeacher } from '../src/services/teacher.service.ts';
import { createHomework } from '../src/services/homework.service.ts';
import { startApp } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let app: TestApp;
let prisma: TestApp['prisma'];
let get: TestApp['get'];
let lan: number;
let minh: number;

// Question and answer texts that must never appear on a browsing page.
const QUESTIONS = [
  { text: 'cau-hoi-bi-mat', answers: [{ text: 'dap-an-dung-bi-mat', correct: true }, { text: 'dap-an-sai-bi-mat', correct: false }] },
];

async function homework(teacherId: number, title: string, settings: { grade?: number | null; deadline?: string | null; timeLimitMinutes?: number | null } = {}) {
  return createHomework(prisma, { teacherId, title, questions: QUESTIONS, ...settings });
}

/** The /h/CODE links of a page, in order. */
function homeworkLinks(html: string): string[] {
  return [...html.matchAll(/href="\/h\/([A-Z0-9]+)"/g)].map((m) => m[1]);
}

before(async () => {
  app = await startApp();
  ({ prisma, get } = app);
  lan = await createTeacher(prisma, { email: 'lan@example.com', name: 'Cô Lan', password: 'matkhau123' });
  minh = await createTeacher(prisma, { email: 'minh@example.com', name: 'Thầy Minh', password: 'matkhau123' });
});

after(() => app.close());

describe('home and grade pages', () => {
  test('home links to Lớp 6 … Lớp 12, in order, and keeps the code box', async () => {
    const html = await (await get('/')).text();
    assert.deepEqual([...html.matchAll(/href="\/lop\/(\d+)"/g)].map((m) => m[1]), ['6', '7', '8', '9', '10', '11', '12']);
    assert.match(html, /action="\/join"/);
  });

  test('a wrong code on the home page still shows the grades', async () => {
    const response = await get('/join?code=x');
    assert.equal(response.status, 400);
    assert.match(await response.text(), /href="\/lop\/12"/);
  });

  test('a grade page links to its three sections, in order', async () => {
    const response = await get('/lop/9');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.deepEqual([...html.matchAll(/href="\/lop\/9\/([a-z-]+)"/g)].map((m) => m[1]), ['tu-vung', 'ngu-phap', 'bai-tap']);
    assert.match(html, /Từ vựng[\s\S]*Ngữ pháp[\s\S]*Bài tập/);
    assert.match(html, /<h1>Lớp 9<\/h1>/);
    assert.match(html, /href="\/">Trang chủ/);
  });

  test('unknown grades and sections: 404', async () => {
    for (const path of ['/lop/5', '/lop/13', '/lop/012', '/lop/abc', '/lop/6.0', '/lop/12/abc', '/lop/12/Bai-tap', '/lop/13/bai-tap', '/lop']) {
      const response = await get(path);
      assert.equal(response.status, 404, path);
      assert.match(await response.text(), /Không tìm thấy/, path);
    }
  });
});

describe('Từ vựng and Ngữ pháp', () => {
  test('every grade shows the "being written" notice', async () => {
    for (let grade = 6; grade <= 12; grade++) {
      for (const [slug, name] of [['tu-vung', 'Từ vựng'], ['ngu-phap', 'Ngữ pháp']]) {
        const response = await get(`/lop/${grade}/${slug}`);
        assert.equal(response.status, 200, `${grade} ${slug}`);
        const html = await response.text();
        assert.match(html, /Nội dung đang được soạn, quay lại sau nhé\./);
        assert.match(html, new RegExp(`<h1>${name} · Lớp ${grade}</h1>`));
        assert.match(html, new RegExp(`href="/lop/${grade}">Lớp ${grade}</a>`));
      }
    }
  });
});

describe('Bài tập', () => {
  let older: string;
  let newer: string;
  let other: string;
  let unplaced: string;
  let closed: string;

  before(async () => {
    older = (await homework(lan, 'Bài cũ của cô Lan', { grade: 11, timeLimitMinutes: 40 })).shareCode;
    other = (await homework(lan, 'Bài lớp 10', { grade: 10 })).shareCode;
    unplaced = (await homework(lan, 'Bài chưa xếp lớp')).shareCode;
    newer = (await homework(minh, 'Bài mới của thầy Minh', { grade: 11, deadline: '2099-11-01T10:00:00.000Z' })).shareCode;
    closed = (await homework(minh, 'Bài đã hết hạn', { grade: 8, deadline: '2020-01-01T00:00:00.000Z' })).shareCode;
  });

  test("lists only that grade's homeworks, from every teacher, newest first", async () => {
    const html = await (await get('/lop/11/bai-tap')).text();
    assert.deepEqual(homeworkLinks(html), [newer, older]);
    assert.match(html, /Cô Lan · 1 câu\s*· 40 phút/);
    assert.match(html, /Thầy Minh · 1 câu[\s\S]*hạn nộp 17:00 01\/11\/2099/);
    assert.deepEqual(homeworkLinks(await (await get('/lop/10/bai-tap')).text()), [other]);
  });

  test('"Chưa xếp lớp" homeworks are listed nowhere, but their link still works', async () => {
    for (let grade = 6; grade <= 12; grade++) {
      const html = await (await get(`/lop/${grade}/bai-tap`)).text();
      assert.equal(homeworkLinks(html).includes(unplaced), false, String(grade));
      assert.doesNotMatch(html, /Bài chưa xếp lớp/);
    }
    const response = await get(`/h/${unplaced}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Bài chưa xếp lớp/);
  });

  test('no question or answer text on the page', async () => {
    const html = await (await get('/lop/11/bai-tap')).text();
    assert.doesNotMatch(html, /bi-mat/);
    assert.doesNotMatch(html, /correct/);
  });

  test('a closed homework says so', async () => {
    const html = await (await get('/lop/8/bai-tap')).text();
    assert.deepEqual(homeworkLinks(html), [closed]);
    assert.match(html, /Đã hết hạn nộp bài/);
  });

  test('a grade without homeworks says so', async () => {
    assert.match(await (await get('/lop/6/bai-tap')).text(), /Chưa có bài tập nào cho lớp này\./);
  });

  test('titles and teacher names are escaped', async () => {
    const evil = await createTeacher(prisma, { email: 'x@example.com', name: '<b>Thầy X</b>', password: 'matkhau123' });
    await homework(evil, '<script>alert(1)</script>', { grade: 7 });
    const html = await (await get('/lop/7/bai-tap')).text();
    assert.doesNotMatch(html, /<script>alert|<b>Thầy X/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });
});
