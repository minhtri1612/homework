import { randomInt } from 'node:crypto';
import { validateQuestion } from '../shared/parser.js';

// No 0/O, 1/I/L, so a code read aloud or copied from the board is not mistyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const REVEAL_MODES = ['never', 'after_submit', 'after_deadline'];

export const LIMITS = { title: 200, questions: 200, questionText: 2000, answerText: 500 };

export function generateShareCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * What a student typed or pasted → a share code, or null if it cannot be one.
 * Accepts any letter case, spaces and dashes ("abc 234", "ABC-234") and a
 * whole link (".../h/abc234").
 */
export function normalizeShareCode(input) {
  let text = String(input ?? '').normalize('NFC').trim();
  const link = text.match(/\/h\/([^/?#\s]+)/u);
  if (link) text = link[1];
  text = text.replace(/[\s-]/gu, '').toUpperCase();
  return CODE_PATTERN.test(text) ? text : null;
}

/**
 * Checks a homework before saving. Returns a list of { code, message,
 * question? } in Vietnamese; empty means it can be saved.
 */
export function validateHomework({ title, questions, revealMode = 'after_submit', deadline = null }) {
  const errors = [];
  if (!String(title ?? '').trim()) errors.push({ code: 'NO_TITLE', message: 'Bài tập chưa có tiêu đề.' });
  else if (title.length > LIMITS.title) {
    errors.push({ code: 'TITLE_TOO_LONG', message: `Tiêu đề dài quá (tối đa ${LIMITS.title} ký tự).` });
  }
  if (!questions?.length) errors.push({ code: 'NO_QUESTIONS', message: 'Bài tập chưa có câu hỏi nào.' });
  else if (questions.length > LIMITS.questions) {
    errors.push({ code: 'TOO_MANY_QUESTIONS', message: `Tối đa ${LIMITS.questions} câu hỏi (hiện có ${questions.length}).` });
  }
  questions?.forEach((question, i) => {
    for (const error of validateQuestion(question).errors) errors.push({ ...error, question: i + 1 });
    const tooLong =
      String(question.text ?? '').length > LIMITS.questionText ||
      question.answers?.some((answer) => String(answer.text ?? '').length > LIMITS.answerText);
    if (tooLong) {
      errors.push({
        code: 'TEXT_TOO_LONG',
        message: `Câu hỏi tối đa ${LIMITS.questionText} ký tự, mỗi đáp án tối đa ${LIMITS.answerText} ký tự.`,
        question: i + 1,
      });
    }
  });
  if (!REVEAL_MODES.includes(revealMode)) {
    errors.push({ code: 'BAD_REVEAL_MODE', message: 'Chế độ hiện đáp án không hợp lệ.' });
  }
  if (deadline !== null && Number.isNaN(new Date(deadline).getTime())) {
    errors.push({ code: 'BAD_DEADLINE', message: 'Hạn nộp không hợp lệ.' });
  } else if (revealMode === 'after_deadline' && deadline === null) {
    errors.push({ code: 'NO_DEADLINE', message: 'Muốn hiện đáp án sau hạn nộp thì cần đặt hạn nộp.' });
  }
  return errors;
}

export class HomeworkValidationError extends Error {
  constructor(errors) {
    super(errors.map((e) => e.message).join(' '));
    this.errors = errors;
  }
}

/**
 * Saves a new homework as version 1. questions use the parser's shape:
 * { text, answers: [{ text, correct }], shuffleAnswers? }.
 * Returns { id, shareCode, versionId }. Nothing is written if it is invalid.
 */
export async function createHomework(db, { teacherId, title, questions, revealMode = 'after_submit', deadline = null, shuffleQuestions = false }) {
  const errors = validateHomework({ title, questions, revealMode, deadline });
  if (errors.length) throw new HomeworkValidationError(errors);

  const tx = await db.transaction('write');
  try {
    // The write transaction locks the database, so a code that is free here
    // is still free when the insert runs.
    let shareCode;
    do {
      shareCode = generateShareCode();
    } while ((await tx.execute({ sql: 'SELECT 1 FROM homeworks WHERE share_code = ?', args: [shareCode] })).rows.length);

    const homework = await tx.execute({
      sql: `INSERT INTO homeworks (title, reveal_mode, deadline, shuffle_questions, teacher_id, share_code)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      args: [...settingsArgs({ title, revealMode, deadline, shuffleQuestions }), teacherId, shareCode],
    });
    const id = homework.rows[0].id;
    const versionId = await insertVersion(tx, id, 1, questions);
    await tx.commit();
    return { id, shareCode, versionId };
  } finally {
    tx.close();
  }
}

/**
 * Saves changes to a homework the teacher owns. If students have already
 * submitted the current version and the questions changed, the questions go
 * into a new version; otherwise the current version is updated in place.
 * Returns { version, newVersion } or null when the homework is not this
 * teacher's (or does not exist).
 */
export async function updateHomework(db, { id, teacherId, title, questions, revealMode = 'after_submit', deadline = null, shuffleQuestions = false }) {
  const errors = validateHomework({ title, questions, revealMode, deadline });
  if (errors.length) throw new HomeworkValidationError(errors);

  const tx = await db.transaction('write');
  try {
    const current = await tx.execute({
      sql: `SELECT v.id, v.number,
                   (SELECT count(*) FROM submissions s WHERE s.version_id = v.id) AS submission_count
            FROM homeworks h JOIN homework_versions v ON v.homework_id = h.id
            WHERE h.id = ? AND h.teacher_id = ?
            ORDER BY v.number DESC LIMIT 1`,
      args: [id, teacherId],
    });
    const version = current.rows[0];
    if (!version) return null;

    await tx.execute({
      sql: `UPDATE homeworks
            SET title = ?, reveal_mode = ?, deadline = ?, shuffle_questions = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?`,
      args: [...settingsArgs({ title, revealMode, deadline, shuffleQuestions }), id],
    });

    let result = { version: version.number, newVersion: false };
    if (!sameQuestions(await loadQuestions(tx, version.id), questions)) {
      if (version.submission_count > 0) {
        await insertVersion(tx, id, version.number + 1, questions);
        result = { version: version.number + 1, newVersion: true };
      } else {
        await tx.execute({ sql: 'DELETE FROM questions WHERE version_id = ?', args: [version.id] });
        await insertQuestions(tx, version.id, questions);
      }
    }
    await tx.commit();
    return result;
  } finally {
    tx.close();
  }
}

function settingsArgs({ title, revealMode, deadline, shuffleQuestions }) {
  return [
    title.normalize('NFC').trim(),
    revealMode,
    deadline === null ? null : new Date(deadline).toISOString(),
    shuffleQuestions ? 1 : 0,
  ];
}

/** Compares what students would see, ignoring ids and Unicode/space differences. */
function sameQuestions(saved, questions) {
  const key = (list) =>
    JSON.stringify(
      list.map((q) => [clean(q.text), Boolean(q.shuffleAnswers), q.answers.map((a) => [clean(a.text), Boolean(a.correct)])]),
    );
  return key(saved) === key(questions);
}

async function insertVersion(tx, homeworkId, number, questions) {
  const version = await tx.execute({
    sql: 'INSERT INTO homework_versions (homework_id, number) VALUES (?, ?) RETURNING id',
    args: [homeworkId, number],
  });
  const versionId = version.rows[0].id;
  await insertQuestions(tx, versionId, questions);
  return versionId;
}

async function insertQuestions(tx, versionId, questions) {
  for (const [i, question] of questions.entries()) {
    const row = await tx.execute({
      sql: 'INSERT INTO questions (version_id, position, text, shuffle_answers) VALUES (?, ?, ?, ?) RETURNING id',
      args: [versionId, i + 1, clean(question.text), question.shuffleAnswers ? 1 : 0],
    });
    const questionId = row.rows[0].id;
    await tx.batch(
      question.answers.map((answer, j) => ({
        sql: 'INSERT INTO answers (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)',
        args: [questionId, j + 1, clean(answer.text), answer.correct ? 1 : 0],
      })),
    );
  }
}

/**
 * Loads a homework with the questions of its current (latest) version, or
 * null. Includes the correct answers: for the teacher and for grading only,
 * never send this object as-is to a student's browser.
 */
export async function getHomework(db, id) {
  const result = await db.execute({
    sql: `SELECT h.*, v.id AS version_id, v.number AS version_number
          FROM homeworks h
          JOIN homework_versions v ON v.homework_id = h.id
          WHERE h.id = ?
          ORDER BY v.number DESC LIMIT 1`,
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return null;

  const submissions = await db.execute({
    sql: 'SELECT count(*) AS n FROM submissions WHERE version_id = ?',
    args: [row.version_id],
  });

  return {
    id: row.id,
    teacherId: row.teacher_id,
    title: row.title,
    shareCode: row.share_code,
    revealMode: row.reveal_mode,
    deadline: row.deadline,
    shuffleQuestions: row.shuffle_questions === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: { id: row.version_id, number: row.version_number, submissionCount: submissions.rows[0].n },
    questions: await loadQuestions(db, row.version_id),
  };
}

/**
 * What anyone with the share code may see about a homework, or null. Safe to
 * show to students: no questions, no answers.
 */
export async function findSharedHomework(db, shareCode) {
  const result = await db.execute({
    sql: `SELECT h.id, h.title, h.share_code, h.deadline, t.name AS teacher_name,
                 (SELECT count(*) FROM questions q
                  WHERE q.version_id = (SELECT v.id FROM homework_versions v
                                        WHERE v.homework_id = h.id
                                        ORDER BY v.number DESC LIMIT 1)) AS question_count
          FROM homeworks h JOIN teachers t ON t.id = h.teacher_id
          WHERE h.share_code = ?`,
    args: [shareCode],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    shareCode: row.share_code,
    deadline: row.deadline,
    teacherName: row.teacher_name,
    questionCount: row.question_count,
  };
}

/** Questions of one version with their answers, in order. db can be a transaction. */
async function loadQuestions(db, versionId) {
  const rows = await db.execute({
    sql: `SELECT q.id AS question_id, q.text AS question_text, q.shuffle_answers,
                 a.id AS answer_id, a.text AS answer_text, a.is_correct
          FROM questions q
          JOIN answers a ON a.question_id = q.id
          WHERE q.version_id = ?
          ORDER BY q.position, a.position`,
    args: [versionId],
  });
  const questions = [];
  for (const r of rows.rows) {
    if (questions.at(-1)?.id !== r.question_id) {
      questions.push({ id: r.question_id, text: r.question_text, shuffleAnswers: r.shuffle_answers === 1, answers: [] });
    }
    questions.at(-1).answers.push({ id: r.answer_id, text: r.answer_text, correct: r.is_correct === 1 });
  }
  return questions;
}

function clean(text) {
  return String(text ?? '').normalize('NFC').trim();
}

/** A teacher's homework sets, newest first, with question and submission counts. */
export async function listHomeworks(db, teacherId) {
  const result = await db.execute({
    sql: `SELECT h.id, h.title, h.share_code, h.created_at,
                 (SELECT count(*) FROM questions q
                  WHERE q.version_id = (SELECT v.id FROM homework_versions v
                                        WHERE v.homework_id = h.id
                                        ORDER BY v.number DESC LIMIT 1)) AS question_count,
                 (SELECT count(*) FROM submissions s WHERE s.homework_id = h.id) AS submission_count
          FROM homeworks h
          WHERE h.teacher_id = ?
          ORDER BY h.created_at DESC, h.id DESC`,
    args: [teacherId],
  });
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    shareCode: row.share_code,
    createdAt: row.created_at,
    questionCount: row.question_count,
    submissionCount: row.submission_count,
  }));
}
