import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTeacher } from '../src/services/teacher.service.ts';
import { createHomework } from '../src/services/homework.service.ts';
import { parse } from '../src/shared/parser.ts';
import { startApp, sessionCookie } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let app: TestApp;
let db: TestApp['db'];
let prisma: TestApp['prisma'];
let get: TestApp['get'];
let post: TestApp['post'];

before(async () => {
  app = await startApp();
  ({ db, prisma, get, post } = app);
});

after(() => app.close());

const NEW_TEACHER = { name: '  Nguyễn   Thị Hoa ', email: 'Hoa@Example.com', password: 'mật khẩu 123', confirm: 'mật khẩu 123' };

describe('pages', () => {
  test('home page is in Vietnamese and UTF-8', async () => {
    const response = await get('/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /charset=utf-8/i);
    assert.match(await response.text(), /Đăng ký tài khoản giáo viên/);
  });

  test('unknown page: 404 in Vietnamese', async () => {
    const response = await get('/khong-co');
    assert.equal(response.status, 404);
    assert.match(await response.text(), /Trang này không tồn tại/);
  });

  test('dashboard needs a login', async () => {
    const response = await get('/teacher');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  });

  test('the stylesheet is served', async () => {
    assert.equal((await get('/style.css')).status, 200);
  });
});

describe('register', () => {
  test('creates the account, logs in and opens the dashboard', async () => {
    const response = await post('/register', NEW_TEACHER);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/teacher');

    const setCookie = response.headers.getSetCookie().join('\n');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);

    const dashboard = await get('/teacher', sessionCookie(response));
    assert.equal(dashboard.status, 200);
    const html = await dashboard.text();
    assert.match(html, /Nguyễn Thị Hoa/);
    assert.match(html, /Chưa có bài tập nào/);
  });

  test('the same email in another letter case is refused', async () => {
    const response = await post('/register', { ...NEW_TEACHER, email: 'HOA@example.COM' });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Email này đã được đăng ký/);
  });

  test('shows every problem at once and keeps what was typed (but not the password)', async () => {
    const response = await post('/register', { name: '', email: 'khong-phai-email', password: 'ngan', confirm: '' });
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /Hãy nhập họ tên/);
    assert.match(html, /Email không hợp lệ/);
    assert.match(html, /ít nhất 8 ký tự/);
    assert.match(html, /value="khong-phai-email"/);
    assert.doesNotMatch(html, /value="ngan"/);
  });

  test('passwords must match', async () => {
    const response = await post('/register', { ...NEW_TEACHER, email: 'khac@example.com', confirm: 'khác' });
    assert.match(await response.text(), /Hai mật khẩu không giống nhau/);
  });

  test('a name with HTML is shown as text, not run', async () => {
    const response = await post('/register', {
      ...NEW_TEACHER,
      name: '<script>alert(1)</script>',
      email: 'xss@example.com',
    });
    const html = await (await get('/teacher', sessionCookie(response))).text();
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });
});

describe('login and logout', () => {
  let teacherId: number;
  before(async () => {
    teacherId = await createTeacher(prisma, { email: 'lan@example.com', name: 'Cô Lan', password: 'matkhau123' });
    await createHomework(prisma, { teacherId, title: 'Ôn tập', questions: parse('Q?\n==a\nb').questions });
  });

  test('right password: logged in, sees own homework', async () => {
    const response = await post('/login', { email: ' LAN@example.com ', password: 'matkhau123' });
    assert.equal(response.status, 302);
    const html = await (await get('/teacher', sessionCookie(response))).text();
    assert.match(html, /Ôn tập/);
    assert.match(html, /1 câu · 0 bài nộp/);
  });

  test('wrong password and unknown email get the same message', async () => {
    for (const fields of [
      { email: 'lan@example.com', password: 'sai mat khau' },
      { email: 'ai@example.com', password: 'matkhau123' },
    ]) {
      const response = await post('/login', fields);
      assert.equal(response.status, 400);
      assert.equal(sessionCookie(response), null);
      assert.match(await response.text(), /Email hoặc mật khẩu không đúng/);
    }
  });

  test('another teacher does not see this homework', async () => {
    const response = await post('/register', { ...NEW_TEACHER, email: 'khac2@example.com' });
    const html = await (await get('/teacher', sessionCookie(response))).text();
    assert.doesNotMatch(html, /Ôn tập/);
  });

  test('logout ends the session on the server too', async () => {
    const cookie = sessionCookie(await post('/login', { email: 'lan@example.com', password: 'matkhau123' }));
    const response = await post('/logout', {}, { cookie });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/');
    // Even if someone kept a copy of the old cookie, it no longer works.
    assert.equal((await get('/teacher', cookie)).status, 302);
  });

  test('a made-up or expired cookie does not log anyone in', async () => {
    assert.equal((await get('/teacher', 'sid=gia-mao')).status, 302);

    const cookie = sessionCookie(await post('/login', { email: 'lan@example.com', password: 'matkhau123' }));
    await db.execute('UPDATE sessions SET expires_at = ?', ['2000-01-01T00:00:00.000Z']);
    assert.equal((await get('/teacher', cookie)).status, 302);
  });

  test('forms posted from another website are blocked', async () => {
    const response = await post('/login', { email: 'lan@example.com', password: 'matkhau123' }, { origin: 'https://evil.example' });
    assert.equal(response.status, 403);
    assert.equal(sessionCookie(response), null);
  });

  test('logged-in teachers are sent from /login to the dashboard', async () => {
    const cookie = sessionCookie(await post('/login', { email: 'lan@example.com', password: 'matkhau123' }));
    const response = await get('/login', cookie);
    assert.equal(response.headers.get('location'), '/teacher');
  });
});
