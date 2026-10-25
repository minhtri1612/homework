import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registerSchema, registerForm } from '../src/validation/auth.schema.ts';
import { editorSchema, homeworkIdParam } from '../src/validation/homework.schema.ts';
import { joinSchema, shareCodeParam } from '../src/validation/share.schema.ts';
import { fieldErrors } from '../src/validation/form.ts';

function registerErrors(body: Record<string, unknown>) {
  const result = registerSchema.safeParse(body);
  return result.success ? {} : fieldErrors(result.error);
}

describe('register form', () => {
  const ok = { name: ' Cô   Lan ', email: ' Lan@Example.COM ', password: 'matkhau123', confirm: 'matkhau123' };

  test('cleans name and email', () => {
    assert.deepEqual(registerSchema.parse(ok), { name: 'Cô Lan', email: 'lan@example.com', password: 'matkhau123', confirm: 'matkhau123', invite: '' });
  });

  test('missing fields are empty, not a crash; one message per field', () => {
    assert.deepEqual(registerErrors({}), {
      name: 'Hãy nhập họ tên.',
      email: 'Email không hợp lệ.',
      password: 'Mật khẩu cần ít nhất 8 ký tự.',
    });
    assert.deepEqual(registerForm.parse({}), { name: '', email: '', password: '', confirm: '', invite: '' });
  });

  test('mismatched passwords are reported next to other errors, but not when the password is too short', () => {
    assert.deepEqual(registerErrors({ ...ok, name: '', confirm: 'khac' }), {
      name: 'Hãy nhập họ tên.',
      confirm: 'Hai mật khẩu không giống nhau.',
    });
    assert.deepEqual(registerErrors({ ...ok, password: 'ngan', confirm: 'khac' }), { password: 'Mật khẩu cần ít nhất 8 ký tự.' });
  });

  test('a repeated field (array) is read as text', () => {
    assert.equal(registerSchema.parse({ ...ok, name: ['A', 'B'] }).name, 'A,B');
  });
});

describe('editor form', () => {
  test('defaults when fields are missing', () => {
    assert.deepEqual(editorSchema.parse({}), {
      title: '',
      revealMode: 'after_submit',
      shuffleQuestions: false,
      deadline: null,
      deadlineInput: '',
      timeLimitMinutes: null,
      timeLimitInput: '',
      questions: [],
      unreadable: false,
    });
  });

  test('time limit: empty is none, digits are minutes, anything else is NaN for validation to report', () => {
    assert.equal(editorSchema.parse({ timeLimit: ' 40 ' }).timeLimitMinutes, 40);
    assert.equal(editorSchema.parse({ timeLimit: '  ' }).timeLimitMinutes, null);
    for (const typed of ['40,5', '-5', 'bốn mươi', '1e3']) {
      const form = editorSchema.parse({ timeLimit: typed });
      assert.ok(Number.isNaN(form.timeLimitMinutes), typed);
      assert.equal(form.timeLimitInput, typed);
    }
  });

  test('Vietnam-time deadline becomes UTC; the typed text is kept', () => {
    const form = editorSchema.parse({ deadline: '2026-11-01T17:00', shuffleQuestions: '1' });
    assert.equal(form.deadline, '2026-11-01T10:00:00.000Z');
    assert.equal(form.deadlineInput, '2026-11-01T17:00');
    assert.equal(form.shuffleQuestions, true);
  });

  test('broken JSON is flagged; JSON that is not a list gives no questions', () => {
    assert.equal(editorSchema.parse({ questions: '[{' }).unreadable, true);
    assert.deepEqual(editorSchema.parse({ questions: '{"a":1}' }).questions, []);
  });

  test('odd values inside the questions are coerced to the right shape', () => {
    const { questions } = editorSchema.parse({
      questions: JSON.stringify([5, { text: 7, shuffleAnswers: 'yes', answers: [{ text: 'x', correct: true }, null, { correct: 1 }] }]),
    });
    assert.deepEqual(questions, [
      { text: '', shuffleAnswers: false, answers: [] },
      {
        text: '7',
        shuffleAnswers: false,
        answers: [{ text: 'x', correct: true }, { text: '', correct: false }, { text: '', correct: false }],
      },
    ]);
  });

  test('homework id in the address', () => {
    assert.deepEqual(['1', '42', 'abc', '01', '1e2', '-1', '99999999999999999999'].map((v) => homeworkIdParam.parse(v)), [
      1, 42, null, null, null, null, null,
    ]);
  });
});

describe('share code', () => {
  test('the home page box: empty, malformed, any accepted form', () => {
    const message = (code: unknown) => joinSchema.safeParse({ code }).error?.issues[0].message;
    assert.equal(message(undefined), 'Hãy nhập mã bài tập.');
    assert.equal(message('   '), 'Hãy nhập mã bài tập.');
    assert.match(message('ab"<x>') ?? '', /gồm 6 chữ cái và chữ số/);
    assert.deepEqual(joinSchema.parse({ code: 'abc-234' }), { code: 'ABC234' });
  });

  test('the code in /h/CODE', () => {
    assert.equal(shareCodeParam.parse('abc234'), 'ABC234');
    assert.equal(shareCodeParam.parse('ABC0O1'), null);
  });
});
