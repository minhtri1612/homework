import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sessionCookie, type TestApp } from './helpers.ts';
import { createTeacher } from '../src/services/teacher.service.ts';
import { productionProblems, MIN_INVITE_CODE } from '../src/config/production.ts';

const INVITE = 'moi-giao-vien-2026';
const TEACHER = { name: 'Cô Mai', email: 'mai@example.com', password: 'matkhau123', confirm: 'matkhau123' };

describe('registration with an invite code (INVITE_CODE)', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp({ inviteCode: INVITE });
    await createTeacher(app.prisma, { email: 'da-co@example.com', name: 'Đã có', password: 'matkhau123' });
  });
  after(() => app.close());

  test('the form asks for the code', async () => {
    const html = await (await app.get('/register')).text();
    assert.match(html, /name="invite"/);
    assert.match(html, /Mã mời/);
  });

  test('missing or wrong code: Vietnamese message, nothing created, the code is not echoed back', async () => {
    let response = await app.post('/register', TEACHER);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Hãy nhập mã mời/);

    response = await app.post('/register', { ...TEACHER, invite: 'doan-mo-ma-sai' });
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /Mã mời không đúng/);
    assert.doesNotMatch(html, /doan-mo-ma-sai/);
    assert.doesNotMatch(html, new RegExp(INVITE));
    assert.equal(Number((await app.db.execute({ sql: 'SELECT count(*) AS n FROM teachers WHERE email = ?', args: [TEACHER.email] })).rows[0]!.n), 0);
  });

  test('without the right code the form does not reveal whether an email is registered', async () => {
    const html = await (await app.post('/register', { ...TEACHER, email: 'da-co@example.com', invite: 'sai' })).text();
    assert.match(html, /Mã mời không đúng/);
    assert.doesNotMatch(html, /đã được đăng ký/);
  });

  test('the right code (spaces around it are ignored) registers and logs in', async () => {
    const response = await app.post('/register', { ...TEACHER, invite: `  ${INVITE} ` });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/teacher');
    assert.ok(sessionCookie(response));
  });

  test('without INVITE_CODE (local use) the field is not shown', async () => {
    const open = await startApp();
    try {
      assert.doesNotMatch(await (await open.get('/register')).text(), /name="invite"/);
    } finally {
      await open.close();
    }
  });
});

describe('production settings', () => {
  const good = {
    NODE_ENV: 'production',
    DATABASE_URL: 'libsql://example-db-example-org.turso.io',
    DATABASE_AUTH_TOKEN: 'token',
    INVITE_CODE: 'x'.repeat(MIN_INVITE_CODE),
  };

  test('complete settings pass; outside production nothing is required', () => {
    assert.deepEqual(productionProblems(good), []);
    assert.deepEqual(productionProblems({}), []);
  });

  test('a local database, a missing token or a short invite code stop the start', () => {
    assert.match(productionProblems({ ...good, DATABASE_URL: '' }).join(), /DATABASE_URL/);
    assert.match(productionProblems({ ...good, DATABASE_URL: 'file:data/local.db' }).join(), /DATABASE_URL/);
    assert.match(productionProblems({ ...good, DATABASE_AUTH_TOKEN: '' }).join(), /DATABASE_AUTH_TOKEN/);
    assert.match(productionProblems({ ...good, INVITE_CODE: 'ngan' }).join(), /INVITE_CODE/);
    assert.match(productionProblems({ ...good, INVITE_CODE: undefined }).join(), /INVITE_CODE/);
  });
});

describe('health check', () => {
  test('GET /healthz answers ok when the database answers', async () => {
    const app = await startApp();
    try {
      const response = await app.get('/healthz');
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'ok');
    } finally {
      await app.close();
    }
  });
});
