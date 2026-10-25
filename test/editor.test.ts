import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTeacher } from '../src/services/teacher.service.ts';
import { getHomework, updateHomework } from '../src/services/homework.service.ts';
import { fromVietnamInput, toVietnamInput, INVALID_TIME } from '../src/vietnam-time.ts';
import { parse } from '../src/shared/parser.ts';
import { startApp, sessionCookie } from './helpers.ts';
import type { TestApp } from './helpers.ts';
import type { QuestionInput } from '../src/services/homework.service.ts';

let app: TestApp;
let db: TestApp['db'];
let prisma: TestApp['prisma'];
let get: TestApp['get'];
let post: TestApp['post'];
let cookie: string | null;
let teacherId: number;

before(async () => {
  app = await startApp();
  ({ db, prisma, get, post } = app);
  teacherId = await createTeacher(prisma, { email: 'lan@example.com', name: 'Cô Lan', password: 'matkhau123' });
  cookie = sessionCookie(await post('/login', { email: 'lan@example.com', password: 'matkhau123' }));
});

after(() => app.close());

const QUESTIONS = [
  { text: 'Con cua có mấy càng?', shuffleAnswers: true, answers: [{ text: '2', correct: true }, { text: '3', correct: false }] },
  { text: 'Thủ đô của Việt Nam?', shuffleAnswers: false, answers: [{ text: 'Huế', correct: false }, { text: 'Hà Nội', correct: true }] },
];

function editorFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    title: 'Ôn tập tuần 8',
    revealMode: 'after_submit',
    deadline: '',
    questions: JSON.stringify(QUESTIONS),
    ...overrides,
  };
}

/** Creates a homework through the form and returns its id. */
async function createViaForm(overrides?: Record<string, string>): Promise<number> {
  const response = await post('/teacher/homeworks', editorFields(overrides), { cookie });
  assert.equal(response.status, 302, await response.text());
  const match = response.headers.get('location')?.match(/^\/teacher\/homeworks\/(\d+)\/edit\?saved=new$/);
  assert.ok(match, response.headers.get('location') ?? undefined);
  return Number(match[1]);
}

/** Text + answers, "==" marking the correct one. */
function simple(questions: QuestionInput[]) {
  return questions.map((q) => [q.text, ...q.answers.map((a) => (a.correct ? `==${a.text}` : a.text))]);
}

async function addSubmission(homeworkId: number): Promise<number> {
  const homework = (await getHomework(prisma, homeworkId))!;
  const name = `Học sinh ${Math.random()}`;
  await db.execute({
    sql: `INSERT INTO submissions (homework_id, version_id, student_name, student_key, submitted_at, correct_count, total_count, score)
          VALUES (?, ?, ?, ?, ?, 0, ?, 0)`,
    args: [homeworkId, homework.version.id, name, name.toLowerCase(), new Date().toISOString(), homework.questions.length],
  });
  return homework.version.id;
}

describe('editor pages', () => {
  test('need a login', async () => {
    assert.equal((await get('/teacher/homeworks/new')).headers.get('location'), '/login');
    assert.equal((await post('/teacher/homeworks', editorFields())).headers.get('location'), '/login');
  });

  test('new homework page opens on the syntax tab and loads the editor script', async () => {
    const html = await (await get('/teacher/homeworks/new', cookie)).text();
    assert.match(html, /data-start-tab="syntax"/);
    assert.match(html, /<script type="module" src="\/js\/editor.js">/);
    assert.match(html, /Chuyển sang dạng thẻ/);
  });

  test('the browser gets the editor script and the shared parser', async () => {
    for (const path of ['/js/editor.js', '/shared/parser.js']) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type') ?? '', /javascript/);
    }
  });
});

describe('create', () => {
  test('saves title, settings and questions; edit page shows them', async () => {
    const id = await createViaForm({ shuffleQuestions: '1', revealMode: 'never', deadline: '2026-11-01T17:00' });
    const homework = (await getHomework(prisma, id))!;
    assert.equal(homework.title, 'Ôn tập tuần 8');
    assert.equal(homework.revealMode, 'never');
    assert.equal(homework.shuffleQuestions, true);
    assert.equal(homework.deadline, '2026-11-01T10:00:00.000Z');
    assert.deepEqual(simple(homework.questions), [
      ['Con cua có mấy càng?', '==2', '3'],
      ['Thủ đô của Việt Nam?', 'Huế', '==Hà Nội'],
    ]);
    assert.deepEqual(homework.questions.map((q) => q.shuffleAnswers), [true, false]);

    const html = await (await get(`/teacher/homeworks/${id}/edit?saved=new`, cookie)).text();
    assert.match(html, /Đã tạo bài tập/);
    assert.match(html, /value="2026-11-01T17:00"/);
    assert.match(html, /data-start-tab="form"/);
    assert.match(html, new RegExp(`<code>${homework.shareCode}</code>`));
  });

  test('appears on the dashboard with a link to edit it', async () => {
    const id = await createViaForm({ title: 'Bài trên trang chính' });
    const html = await (await get('/teacher', cookie)).text();
    assert.match(html, new RegExp(`href="/teacher/homeworks/${id}/edit">Bài trên trang chính<`));
  });

  test('invalid homework: 400, Vietnamese reasons, nothing saved, input kept', async () => {
    const before = (await db.execute('SELECT count(*) AS n FROM homeworks')).rows[0].n;
    const bad = [{ text: 'Câu hỏi?', answers: [{ text: 'a', correct: true }, { text: 'b', correct: true }] }];
    const response = await post(
      '/teacher/homeworks',
      editorFields({ title: 'Giữ lại tiêu đề', questions: JSON.stringify(bad), revealMode: 'after_deadline' }),
      { cookie },
    );
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /Chưa lưu được/);
    assert.match(html, /Câu 1: Có 2 đáp án được đánh dấu đúng/);
    assert.match(html, /cần đặt hạn nộp/);
    assert.match(html, /value="Giữ lại tiêu đề"/);
    assert.match(html, /"text":"Câu hỏi\?"/);
    assert.equal((await db.execute('SELECT count(*) AS n FROM homeworks')).rows[0].n, before);
  });

  test('no questions, no title, bad deadline', async () => {
    const html = await (
      await post('/teacher/homeworks', editorFields({ title: ' ', questions: '[]', deadline: '2026-02-30T10:00' }), { cookie })
    ).text();
    assert.match(html, /chưa có tiêu đề/);
    assert.match(html, /chưa có câu hỏi nào/);
    assert.match(html, /Hạn nộp không hợp lệ/);
  });

  test('broken questions data is reported, not a crash', async () => {
    for (const questions of ['{không phải json', '"chuỗi"', '[{"answers": "x"}, null]']) {
      const response = await post('/teacher/homeworks', editorFields({ questions }), { cookie });
      assert.equal(response.status, 400, questions);
    }
  });

  test('question text cannot close the page script (no HTML injection)', async () => {
    const evil = [{ text: '</script><script>alert(1)</script>', answers: [{ text: 'a', correct: true }] }];
    const html = await (await post('/teacher/homeworks', editorFields({ questions: JSON.stringify(evil) }), { cookie })).text();
    assert.doesNotMatch(html, /<\/script><script>alert/);
    assert.match(html, /\\u003c\/script>/);
  });
});

describe('edit', () => {
  test('without submissions: questions are replaced in the same version', async () => {
    const id = await createViaForm();
    const changed = [QUESTIONS[0], { ...QUESTIONS[1], text: 'Thủ đô của nước ta?' }];
    const response = await post(`/teacher/homeworks/${id}`, editorFields({ questions: JSON.stringify(changed) }), { cookie });
    assert.equal(response.headers.get('location'), `/teacher/homeworks/${id}/edit?saved=1`);

    const homework = (await getHomework(prisma, id))!;
    assert.equal(homework.version.number, 1);
    assert.equal(homework.questions[1].text, 'Thủ đô của nước ta?');
    assert.equal((await db.execute('SELECT count(*) AS n FROM questions q JOIN homework_versions v ON v.id = q.version_id WHERE v.homework_id = ?', [id])).rows[0].n, 2);
  });

  test('with submissions: changed questions become version 2, the old submission keeps version 1', async () => {
    const id = await createViaForm();
    const oldVersionId = await addSubmission(id);

    const page = await (await get(`/teacher/homeworks/${id}/edit`, cookie)).text();
    assert.match(page, /Đã có 1 bài nộp/);

    const changed = [...QUESTIONS, { text: 'Câu mới?', answers: [{ text: 'x', correct: false }, { text: 'y', correct: true }] }];
    const response = await post(`/teacher/homeworks/${id}`, editorFields({ questions: JSON.stringify(changed) }), { cookie });
    assert.equal(response.headers.get('location'), `/teacher/homeworks/${id}/edit?saved=v2`);
    assert.match(await (await get(response.headers.get('location')!, cookie)).text(), /phiên bản 2/);

    const homework = (await getHomework(prisma, id))!;
    assert.equal(homework.version.number, 2);
    assert.equal(homework.questions.length, 3);
    const old = await db.execute('SELECT count(*) AS n FROM questions WHERE version_id = ?', [oldVersionId]);
    assert.equal(old.rows[0].n, 2);
    const submission = await db.execute('SELECT version_id FROM submissions WHERE homework_id = ?', [id]);
    assert.equal(submission.rows[0].version_id, oldVersionId);
  });

  test('with submissions: changing only settings does not create a version', async () => {
    const id = await createViaForm();
    await addSubmission(id);
    const response = await post(`/teacher/homeworks/${id}`, editorFields({ title: 'Đổi tên', deadline: '2026-12-01T07:30' }), { cookie });
    assert.equal(response.headers.get('location'), `/teacher/homeworks/${id}/edit?saved=1`);
    const homework = (await getHomework(prisma, id))!;
    assert.equal(homework.version.number, 1);
    assert.equal(homework.title, 'Đổi tên');
    assert.equal(homework.deadline, '2026-12-01T00:30:00.000Z');
  });

  test('invalid edit keeps the old saved version and shows the errors', async () => {
    const id = await createViaForm();
    const response = await post(`/teacher/homeworks/${id}`, editorFields({ questions: '[]' }), { cookie });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /chưa có câu hỏi nào/);
    assert.equal((await getHomework(prisma, id))!.questions.length, 2);
  });

  test("another teacher's homework: 404 for viewing and saving", async () => {
    const id = await createViaForm({ title: 'Của cô Lan' });
    await createTeacher(prisma, { email: 'minh@example.com', name: 'Thầy Minh', password: 'matkhau123' });
    const other = sessionCookie(await post('/login', { email: 'minh@example.com', password: 'matkhau123' }));

    assert.equal((await get(`/teacher/homeworks/${id}/edit`, other)).status, 404);
    assert.equal((await post(`/teacher/homeworks/${id}`, editorFields({ title: 'Bị sửa' }), { cookie: other })).status, 404);
    assert.equal((await getHomework(prisma, id))!.title, 'Của cô Lan');
    assert.equal((await get('/teacher/homeworks/abc/edit', cookie)).status, 404);
  });

  test('updateHomework refuses a teacher who does not own it', async () => {
    const id = await createViaForm();
    const result = await updateHomework(prisma, { id, teacherId: teacherId + 999, title: 'x', questions: QUESTIONS });
    assert.equal(result, null);
  });
});

describe('syntax text to saved homework', () => {
  test('what the parser produces can be saved as-is', async () => {
    const { title, questions } = parse('BÀI TẬP\n\n1. A. cat   B. dog   ==C. pencil\n\nCâu 2: Q?\n==x\ny');
    const id = await createViaForm({ title: title ?? '', questions: JSON.stringify(questions) });
    const homework = (await getHomework(prisma, id))!;
    assert.equal(homework.title, 'BÀI TẬP');
    assert.deepEqual(simple(homework.questions), [['', 'cat', 'dog', '==pencil'], ['Q?', '==x', 'y']]);
  });
});

describe('Vietnam time', () => {
  test('round trip between the form and UTC', () => {
    assert.equal(fromVietnamInput('2026-11-01T06:15'), '2026-10-31T23:15:00.000Z');
    assert.equal(toVietnamInput('2026-10-31T23:15:00.000Z'), '2026-11-01T06:15');
    assert.equal(fromVietnamInput(''), null);
    assert.equal(toVietnamInput(null), '');
  });

  test('impossible dates are not silently moved', () => {
    assert.equal(fromVietnamInput('2026-02-30T10:00'), INVALID_TIME);
    assert.equal(fromVietnamInput('hôm nay'), INVALID_TIME);
  });
});
