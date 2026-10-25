import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, type TestApp } from './helpers.ts';
import { createTeacher } from '../src/services/teacher.service.ts';
import { createHomework, getHomework, updateHomework, type QuestionInput } from '../src/services/homework.service.ts';
import { seededShuffle } from '../src/services/shuffle.service.ts';

let app: TestApp;
let teacherId: number;

before(async () => {
  app = await startApp();
  teacherId = await createTeacher(app.prisma, { email: 'lan@example.com', name: 'Cô Lan', password: 'matkhau123' });
});
after(() => app.close());

/** Questions "Câu 1" … "Câu n", answers "a1" … "a4"; the correct one is the first. */
function questions(n: number, { shuffleAnswers = false } = {}): QuestionInput[] {
  return Array.from({ length: n }, (_, i) => ({
    text: `Câu hỏi số ${i + 1}?`,
    shuffleAnswers,
    answers: ['đúng', 'sai một', 'sai hai', 'sai ba'].map((text, j) => ({ text: `${text} (${i + 1})`, correct: j === 0 })),
  }));
}

async function newHomework(options: Partial<Parameters<typeof createHomework>[1]> = {}) {
  const { id, shareCode } = await createHomework(app.prisma, { teacherId, title: 'Ôn tập', questions: questions(3), ...options });
  return { id, shareCode, homework: (await getHomework(app.prisma, id))! };
}

/** Undoes EJS's escaping of an attribute value, as the browser does. */
function decodeHtml(text: string): string {
  const entities: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };
  return text.replace(/&(?:lt|gt|quot|#39|amp);/g, (entity) => entities[entity]!);
}

/** What the answer page offers: hidden fields, and per question its radio values in page order. */
function readAnswerPage(html: string) {
  const hidden = (name: string) => decodeHtml(html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1] ?? '');
  const radios = [...html.matchAll(/name="q(\d+)" value="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const order: number[] = [];
  const answers = new Map<number, number[]>();
  for (const [q, a] of radios) {
    if (!answers.has(q)) order.push(q);
    answers.set(q, [...(answers.get(q) ?? []), a]);
  }
  return { name: hidden('name'), versionId: hidden('versionId'), questionIds: hidden('questionIds'), order, answers };
}

async function openAnswerPage(code: string, name: string) {
  const response = await app.get(`/h/${code}/answer?name=${encodeURIComponent(name)}`);
  return { response, html: await response.text() };
}

/** Opens the answer page as `name` and submits; pick chooses an answer id per question (null = blank). */
async function answerAndSubmit(code: string, name: string, pick: (questionId: number, answerIds: number[]) => number | null) {
  const { html } = await openAnswerPage(code, name);
  const page = readAnswerPage(html);
  const fields: Record<string, string> = { name: page.name, versionId: page.versionId, questionIds: page.questionIds };
  for (const [q, ids] of page.answers) {
    const choice = pick(q, ids);
    if (choice !== null) fields[`q${q}`] = String(choice);
  }
  return app.post(`/h/${code}/submit`, fields);
}

async function count(sql: string, args: (string | number)[] = []): Promise<number> {
  return Number((await app.db.execute({ sql, args })).rows[0]!.n);
}

/** The correct answer id of each question, from the teacher's view. */
function correctOf(homework: NonNullable<Awaited<ReturnType<typeof getHomework>>>) {
  return new Map(homework.questions.map((q) => [q.id, q.answers.find((a) => a.correct)!.id]));
}

describe('seededShuffle', () => {
  test('same seed, same order; always a permutation', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    assert.deepEqual(seededShuffle(items, 'a'), seededShuffle(items, 'a'));
    assert.deepEqual([...seededShuffle(items, 'b')].sort((x, y) => x - y), items);
    assert.notDeepEqual(seededShuffle(items, 'a'), seededShuffle(items, 'b'));
    assert.deepEqual(items, Array.from({ length: 20 }, (_, i) => i), 'the input is not changed');
  });
});

describe('start page and name', () => {
  test('the share page asks for the name', async () => {
    const { shareCode } = await newHomework();
    const html = await (await app.get(`/h/${shareCode}`)).text();
    assert.match(html, new RegExp(`action="/h/${shareCode}/answer"`));
    assert.match(html, /Bắt đầu làm bài/);
  });

  test('a name is required', async () => {
    const { shareCode } = await newHomework();
    const { response, html } = await openAnswerPage(shareCode, '   ');
    assert.equal(response.status, 400);
    assert.match(html, /Hãy nhập họ tên/);
  });

  test('a lower-case code redirects and keeps the name', async () => {
    const { shareCode } = await newHomework();
    const response = await app.get(`/h/${shareCode.toLowerCase()}/answer?name=An`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/h/${shareCode}/answer?name=An`);
  });

  test('past the deadline there is no form and no answer page', async () => {
    const { id, shareCode } = await newHomework();
    await app.db.execute({ sql: 'UPDATE homeworks SET deadline = ? WHERE id = ?', args: ['2000-01-01T00:00:00.000Z', id] });
    const html = await (await app.get(`/h/${shareCode}`)).text();
    assert.match(html, /Đã hết hạn nộp bài/);
    assert.doesNotMatch(html, /Bắt đầu làm bài/);
    assert.equal((await openAnswerPage(shareCode, 'An')).response.status, 403);
  });
});

describe('answer page', () => {
  test('shows every question and answer, in the teacher order, without the correct answers', async () => {
    const { shareCode, homework } = await newHomework();
    const { response, html } = await openAnswerPage(shareCode, 'Lê Văn An');
    assert.equal(response.status, 200);
    const page = readAnswerPage(html);
    assert.deepEqual(page.order, homework.questions.map((q) => q.id));
    for (const q of homework.questions) assert.deepEqual(page.answers.get(q.id), q.answers.map((a) => a.id));
    assert.equal(page.name, 'Lê Văn An');
    assert.equal(page.versionId, String(homework.version.id));
    // Nothing in the page tells the correct answer apart from the others.
    assert.doesNotMatch(html, /correct|đáp án đúng|is-correct|==/i);
  });

  test('shuffled per student: stable on reload, different between students', async () => {
    const { shareCode, homework } = await newHomework({ questions: questions(8, { shuffleAnswers: true }), shuffleQuestions: true });
    const first = readAnswerPage((await openAnswerPage(shareCode, 'An')).html);
    const again = readAnswerPage((await openAnswerPage(shareCode, '  an ')).html);
    assert.deepEqual(again.order, first.order, 'same name (any case/spacing) → same question order');
    assert.deepEqual([...again.answers], [...first.answers], 'and same answer order');
    assert.deepEqual([...first.order].sort(), homework.questions.map((q) => q.id).sort());

    const others = await Promise.all(['Bình', 'Chi', 'Dũng', 'Hoa'].map(async (n) => readAnswerPage((await openAnswerPage(shareCode, n)).html).order));
    assert.ok(others.some((order) => order.join() !== first.order.join()), 'other students get other orders');
  });
});

describe('submitting and grading', () => {
  test('all correct: 10 points, saved with every answer, private result link', async () => {
    const { shareCode, homework } = await newHomework();
    const correct = correctOf(homework);
    const response = await answerAndSubmit(shareCode, 'Trần Thị Bình', (q) => correct.get(q)!);
    assert.equal(response.status, 303);
    const location = response.headers.get('location')!;
    assert.match(location, new RegExp(`^/h/${shareCode}/result/[A-Za-z0-9_-]{32}$`));
    assert.match(response.headers.getSetCookie().join(), new RegExp(`result_${shareCode}=.*Path=/h/${shareCode}.*HttpOnly`, 'i'));

    const row = (await app.db.execute({ sql: 'SELECT * FROM submissions WHERE homework_id = ?', args: [homework.id] })).rows[0]!;
    assert.deepEqual([row.student_name, row.student_key, row.correct_count, row.total_count, row.score], ['Trần Thị Bình', 'trần thị bình', 3, 3, 10]);
    assert.notEqual(row.result_token_hash, location.split('/').at(-1), 'only a hash of the link code is stored');
    assert.equal(await count('SELECT count(*) AS n FROM submission_answers WHERE submission_id = ?', [Number(row.id)]), 3);

    const html = await (await app.get(location)).text();
    assert.match(html, /<strong>10<\/strong> \/ 10 điểm/);
    assert.match(html, /Đúng 3 \/ 3 câu/);
  });

  test('1 of 3 correct, the rest wrong or blank: 3,25 points; blank is stored as NULL', async () => {
    const { shareCode, homework } = await newHomework();
    const correct = correctOf(homework);
    const [q1, q2] = homework.questions;
    const response = await answerAndSubmit(shareCode, 'Chi', (q, ids) =>
      q === q1!.id ? correct.get(q)! : q === q2!.id ? ids.find((a) => a !== correct.get(q))! : null,
    );
    const html = await (await app.get(response.headers.get('location')!)).text();
    assert.match(html, /<strong>3,25<\/strong> \/ 10 điểm/);
    assert.match(html, /✖ Sai/);
    assert.match(html, /✖ Bỏ trống/);
    assert.equal(await count('SELECT count(*) AS n FROM submission_answers sa JOIN submissions s ON s.id = sa.submission_id WHERE s.homework_id = ? AND sa.answer_id IS NULL', [homework.id]), 1);
  });

  test('one attempt per name (any letter case or spacing)', async () => {
    const { shareCode, homework } = await newHomework();
    await answerAndSubmit(shareCode, 'Dũng', () => null);
    const { response, html } = await openAnswerPage(shareCode, '  DŨNG ');
    assert.equal(response.status, 409);
    assert.match(html, /đã nộp bài này rồi/);

    // A form opened before the first submission still cannot submit twice.
    const fields = { name: 'dũng', versionId: String(homework.version.id), questionIds: homework.questions.map((q) => q.id).join(',') };
    const again = await app.post(`/h/${shareCode}/submit`, fields);
    assert.equal(again.status, 409);
    assert.equal(await count('SELECT count(*) AS n FROM submissions WHERE homework_id = ?', [homework.id]), 1);
  });

  test('a submission after the deadline is refused and not saved', async () => {
    const { id, shareCode, homework } = await newHomework();
    const page = readAnswerPage((await openAnswerPage(shareCode, 'Hoa')).html);
    await app.db.execute({ sql: 'UPDATE homeworks SET deadline = ? WHERE id = ?', args: ['2000-01-01T00:00:00.000Z', id] });
    const response = await app.post(`/h/${shareCode}/submit`, { name: page.name, versionId: page.versionId, questionIds: page.questionIds });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /Đã hết hạn nộp bài, bài làm không được ghi nhận/);
    assert.equal(await count('SELECT count(*) AS n FROM submissions WHERE homework_id = ?', [homework.id]), 0);
  });

  test('questions replaced by the teacher while answering: refused, asked to redo', async () => {
    const { id, shareCode } = await newHomework();
    const page = readAnswerPage((await openAnswerPage(shareCode, 'Khoa')).html);
    // No submissions yet, so this edit replaces the questions (new ids).
    await updateHomework(app.prisma, { id, teacherId, title: 'Ôn tập', questions: questions(2) });
    const response = await app.post(`/h/${shareCode}/submit`, { name: page.name, versionId: page.versionId, questionIds: page.questionIds });
    assert.equal(response.status, 409);
    assert.match(await response.text(), /Giáo viên vừa sửa bài tập/);
    assert.equal(await count('SELECT count(*) AS n FROM submissions WHERE homework_id = ?', [id]), 0);
  });

  test('a page from an older version is graded on that version', async () => {
    const { id, shareCode, homework } = await newHomework();
    const correct = correctOf(homework);
    await answerAndSubmit(shareCode, 'Lan Anh', () => null);
    const page = readAnswerPage((await openAnswerPage(shareCode, 'Minh')).html);
    // With a submission on version 1, the edit becomes version 2.
    assert.deepEqual(await updateHomework(app.prisma, { id, teacherId, title: 'Ôn tập', questions: questions(5) }), { version: 2, newVersion: true });

    const fields: Record<string, string> = { name: page.name, versionId: page.versionId, questionIds: page.questionIds };
    for (const q of page.order) fields[`q${q}`] = String(correct.get(q));
    const response = await app.post(`/h/${shareCode}/submit`, fields);
    assert.equal(response.status, 303);
    const html = await (await app.get(response.headers.get('location')!)).text();
    assert.match(html, /Đúng 3 \/ 3 câu/);
  });

  test("an answer from another question is refused", async () => {
    const { shareCode, homework } = await newHomework();
    const [q1, q2] = homework.questions;
    const response = await answerAndSubmit(shareCode, 'Nam', (q) => (q === q1!.id ? q2!.answers[0]!.id : null));
    assert.equal(response.status, 400);
    assert.equal(await count('SELECT count(*) AS n FROM submissions WHERE homework_id = ?', [homework.id]), 0);
  });

  test('a form posted from another website is blocked', async () => {
    const { shareCode } = await newHomework();
    const response = await app.post(`/h/${shareCode}/submit`, { name: 'X' }, { origin: 'https://evil.example' });
    assert.equal(response.status, 403);
  });
});

describe('result page', () => {
  async function submitted(options: Partial<Parameters<typeof createHomework>[1]> = {}, name = 'Phương') {
    const { id, shareCode, homework } = await newHomework(options);
    const correct = correctOf(homework);
    const response = await answerAndSubmit(shareCode, name, (q) => correct.get(q)!);
    return { id, shareCode, location: response.headers.get('location')!, cookie: response.headers.getSetCookie()[0]!.split(';')[0]! };
  }

  test('after_submit: each question with the chosen and the correct answer', async () => {
    const { location } = await submitted();
    const html = await (await app.get(location)).text();
    assert.match(html, /Câu hỏi số 1\?/);
    assert.match(html, /em chọn/);
    assert.match(html, /đáp án đúng/);
    assert.match(html, /✔ Đúng/);
  });

  test('never: score only', async () => {
    const { location } = await submitted({ revealMode: 'never' });
    const html = await (await app.get(location)).text();
    assert.match(html, /\/ 10 điểm/);
    assert.match(html, /không cho xem đáp án/);
    assert.doesNotMatch(html, /Câu hỏi số 1|đáp án đúng|em chọn/);
  });

  test('after_deadline: hidden before the deadline, shown after it', async () => {
    const { id, location } = await submitted({ revealMode: 'after_deadline', deadline: '2099-01-01T00:00:00.000Z' });
    let html = await (await app.get(location)).text();
    assert.match(html, /Đáp án sẽ hiện ở trang này sau hạn nộp/);
    assert.doesNotMatch(html, /Câu hỏi số 1|đáp án đúng/);

    await app.db.execute({ sql: 'UPDATE homeworks SET deadline = ? WHERE id = ?', args: ['2000-01-01T00:00:00.000Z', id] });
    html = await (await app.get(location)).text();
    assert.match(html, /đáp án đúng/);
  });

  test('unknown link codes, or a code used with another homework, are 404', async () => {
    const { location } = await submitted();
    const other = await newHomework();
    assert.equal((await app.get(location.replace(/[^/]+$/, 'x'.repeat(32)))).status, 404);
    assert.equal((await app.get(location.replace(/\/h\/[^/]+\//, `/h/${other.shareCode}/`))).status, 404);
  });

  test('the share page offers this browser\'s last result', async () => {
    const { shareCode, location, cookie } = await submitted({}, 'Quang');
    const html = await (await app.get(`/h/${shareCode}`, cookie)).text();
    assert.match(html, /<strong>Quang<\/strong> đã nộp bài/);
    assert.ok(html.includes(`href="${location}"`));
    assert.match(html, /Bắt đầu làm bài/, 'the next student can still start');
  });

  test('the student name is shown as text, not HTML', async () => {
    const { location } = await submitted({}, '<b>Tý</b>');
    const html = await (await app.get(location)).text();
    assert.ok(html.includes('&lt;b&gt;Tý&lt;/b&gt;'));
    assert.ok(!html.includes('<b>Tý</b>'));
  });
});
