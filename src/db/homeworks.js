import { randomInt } from 'node:crypto';
import { validateQuestion } from '../shared/parser.js';

// No 0/O, 1/I/L, so a code read aloud or copied from the board is not mistyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const REVEAL_MODES = ['never', 'after_submit', 'after_deadline'];

export function generateShareCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * Checks a homework before saving. Returns a list of { code, message,
 * question? } in Vietnamese; empty means it can be saved.
 */
export function validateHomework({ title, questions, revealMode = 'after_submit', deadline = null }) {
  const errors = [];
  if (!String(title ?? '').trim()) errors.push({ code: 'NO_TITLE', message: 'Bài tập chưa có tiêu đề.' });
  if (!questions?.length) errors.push({ code: 'NO_QUESTIONS', message: 'Bài tập chưa có câu hỏi nào.' });
  questions?.forEach((question, i) => {
    for (const error of validateQuestion(question).errors) errors.push({ ...error, question: i + 1 });
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
      sql: `INSERT INTO homeworks (teacher_id, title, share_code, reveal_mode, deadline, shuffle_questions)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      args: [
        teacherId,
        title.normalize('NFC').trim(),
        shareCode,
        revealMode,
        deadline === null ? null : new Date(deadline).toISOString(),
        shuffleQuestions ? 1 : 0,
      ],
    });
    const id = homework.rows[0].id;
    const versionId = await insertVersion(tx, id, 1, questions);
    await tx.commit();
    return { id, shareCode, versionId };
  } finally {
    tx.close();
  }
}

async function insertVersion(tx, homeworkId, number, questions) {
  const version = await tx.execute({
    sql: 'INSERT INTO homework_versions (homework_id, number) VALUES (?, ?) RETURNING id',
    args: [homeworkId, number],
  });
  const versionId = version.rows[0].id;

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
  return versionId;
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

  const rows = await db.execute({
    sql: `SELECT q.id AS question_id, q.text AS question_text, q.shuffle_answers,
                 a.id AS answer_id, a.text AS answer_text, a.is_correct
          FROM questions q
          JOIN answers a ON a.question_id = q.id
          WHERE q.version_id = ?
          ORDER BY q.position, a.position`,
    args: [row.version_id],
  });
  const questions = [];
  for (const r of rows.rows) {
    if (questions.at(-1)?.id !== r.question_id) {
      questions.push({ id: r.question_id, text: r.question_text, shuffleAnswers: r.shuffle_answers === 1, answers: [] });
    }
    questions.at(-1).answers.push({ id: r.answer_id, text: r.answer_text, correct: r.is_correct === 1 });
  }

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
    version: { id: row.version_id, number: row.version_number },
    questions,
  };
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
