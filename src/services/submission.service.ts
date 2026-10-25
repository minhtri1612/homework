// The student side: the questions a student answers (without the correct
// answers), grading a submission, and the result page.
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client.ts';
import { isUniqueViolation } from '../config/client.ts';
import { computeScore } from '../grading.ts';
import { seededShuffle } from './shuffle.service.ts';

// See homework.service.ts: the default 5 s is too short for big saves over Turso.
const WRITE_TIMEOUT = { timeout: 30_000 };

/** One attempt per name: the name lower-cased (it is already NFC with spaces collapsed). */
export function studentKey(name: string): string {
  return name.toLocaleLowerCase('vi');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * How late a submission may arrive after the time limit or the deadline: the
 * page submits by itself when time is up, and the request still has to cross
 * a slow phone network (or the phone slept through the last seconds).
 */
export const SUBMIT_GRACE_MS = 60_000;

/** True once the deadline has passed (a homework without a deadline never closes). */
export function isClosed(deadline: string | null, now = new Date()): boolean {
  return deadline !== null && new Date(deadline) <= now;
}

/** True once even a late submission (SUBMIT_GRACE_MS) for this deadline is refused. */
function submissionsClosed(deadline: string | null, now: Date): boolean {
  return isClosed(deadline, new Date(now.getTime() - SUBMIT_GRACE_MS));
}

/**
 * Whether the result page may show the correct answers now. The score is
 * always shown. after_deadline waits for the grace period too, so nobody can
 * read the answers while a late submission is still accepted.
 */
export function canReveal(homework: { revealMode: string; deadline: string | null }, now = new Date()): boolean {
  if (homework.revealMode === 'after_submit') return true;
  if (homework.revealMode === 'after_deadline') return submissionsClosed(homework.deadline, now);
  return false;
}

/**
 * Whole seconds this student has left on a homework with a time limit: until
 * startedAt + the limit, or the deadline if that comes first. 0 or less means
 * time is up. null when the homework has no time limit.
 */
export function secondsLeft(
  homework: { timeLimitMinutes: number | null; deadline: string | null },
  startedAt: string,
  now = new Date(),
): number | null {
  if (homework.timeLimitMinutes === null) return null;
  let end = new Date(startedAt).getTime() + homework.timeLimitMinutes * 60_000;
  if (homework.deadline !== null) end = Math.min(end, new Date(homework.deadline).getTime());
  return Math.floor((end - now.getTime()) / 1000);
}

/**
 * Records that this student started (homework with a time limit). Starting
 * again keeps the first time, so reloading or another device cannot restart
 * the clock. Returns when they started.
 */
export async function startAttempt(prisma: PrismaClient, homeworkId: number, name: string, now = new Date()): Promise<string> {
  const key = { homeworkId, studentKey: studentKey(name) };
  const attempt = await prisma.attempt.upsert({
    where: { homeworkId_studentKey: key },
    create: { ...key, startedAt: now.toISOString() },
    update: {},
    select: { startedAt: true },
  });
  return attempt.startedAt;
}

/** When this student started, or null if they have not pressed "Bắt đầu làm bài". */
export async function findAttempt(prisma: PrismaClient, homeworkId: number, name: string): Promise<string | null> {
  const attempt = await prisma.attempt.findUnique({
    where: { homeworkId_studentKey: { homeworkId, studentKey: studentKey(name) } },
    select: { startedAt: true },
  });
  return attempt?.startedAt ?? null;
}

interface OrderSource {
  homeworkId: number;
  versionId: number;
  shuffleQuestions: boolean;
  key: string;
}

/**
 * Puts questions and answers in the order this student sees them: the
 * teacher's order, or shuffled per student when the teacher asked for it.
 */
function inStudentOrder<A, Q extends { id: number; shuffleAnswers: boolean; answers: A[] }>(
  questions: Q[],
  { homeworkId, versionId, shuffleQuestions, key }: OrderSource,
): Q[] {
  const seed = `${homeworkId}:${versionId}:${key}`;
  const ordered = shuffleQuestions ? seededShuffle(questions, seed) : questions;
  return ordered.map((question) =>
    question.shuffleAnswers ? { ...question, answers: seededShuffle(question.answers, `${seed}:${question.id}`) } : question,
  );
}

const ORDERED_QUESTIONS = {
  orderBy: { position: 'asc' },
  select: {
    id: true,
    text: true,
    shuffleAnswers: true,
    answers: { orderBy: { position: 'asc' }, select: { id: true, text: true, isCorrect: true } },
  },
} satisfies Prisma.HomeworkVersion$questionsArgs;

/** A question as the student answers it: no correct answers. */
export interface StudentQuestion {
  id: number;
  text: string;
  answers: { id: number; text: string }[];
}

/**
 * The latest version's questions for this student, in their order, without
 * which answer is correct, or null for an unknown code. Safe for student pages.
 */
export async function getQuestionsForStudent(prisma: PrismaClient, shareCode: string, name: string) {
  const homework = await prisma.homework.findUnique({
    where: { shareCode },
    select: {
      id: true,
      title: true,
      shareCode: true,
      deadline: true,
      timeLimitMinutes: true,
      shuffleQuestions: true,
      versions: { orderBy: { number: 'desc' }, take: 1, select: { id: true, questions: ORDERED_QUESTIONS } },
    },
  });
  const version = homework?.versions[0];
  if (!homework || !version) return null;

  const ordered = inStudentOrder(version.questions, {
    homeworkId: homework.id,
    versionId: version.id,
    shuffleQuestions: homework.shuffleQuestions,
    key: studentKey(name),
  });
  return {
    id: homework.id,
    title: homework.title,
    shareCode: homework.shareCode,
    deadline: homework.deadline,
    timeLimitMinutes: homework.timeLimitMinutes,
    versionId: version.id,
    // Built field by field so that isCorrect cannot slip through.
    questions: ordered.map(
      (q): StudentQuestion => ({ id: q.id, text: q.text, answers: q.answers.map((a) => ({ id: a.id, text: a.text })) }),
    ),
  };
}

/** Whether someone with this name has already submitted this homework. */
export async function hasSubmitted(prisma: PrismaClient, homeworkId: number, name: string): Promise<boolean> {
  const found = await prisma.submission.findUnique({
    where: { homeworkId_studentKey: { homeworkId, studentKey: studentKey(name) } },
    select: { id: true },
  });
  return found !== null;
}

/** Why a submission was not saved. message is shown to the student (Vietnamese). */
export class SubmissionError extends Error {
  code: 'NOT_FOUND' | 'CLOSED' | 'TIME_UP' | 'NAME_TAKEN' | 'CHANGED' | 'INVALID';

  constructor(code: SubmissionError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export interface SubmissionInput {
  shareCode: string;
  name: string;
  /** The version whose questions the student saw. */
  versionId: number;
  /** The ids of the questions on the student's page. */
  questionIds: number[];
  /** Chosen answer id per question id; a question left out or null was left blank. */
  choices: Map<number, number | null>;
}

/**
 * Grades and saves a submission in one transaction, so it cannot interleave
 * with the teacher editing the questions. Returns the code for the private
 * result link (only its hash is stored, like login sessions).
 */
export async function submitAnswers(
  prisma: PrismaClient,
  { shareCode, name, versionId, questionIds, choices }: SubmissionInput,
): Promise<{ token: string; score: number }> {
  const token = randomBytes(24).toString('base64url');
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const homework = await tx.homework.findUnique({
        where: { shareCode },
        select: {
          id: true,
          deadline: true,
          timeLimitMinutes: true,
          attempts: { where: { studentKey: studentKey(name) }, select: { startedAt: true } },
        },
      });
      if (!homework) throw new SubmissionError('NOT_FOUND', 'Không có bài tập nào với mã này.');
      if (submissionsClosed(homework.deadline, now)) {
        throw new SubmissionError('CLOSED', 'Đã hết hạn nộp bài, bài làm không được ghi nhận.');
      }
      // No attempt: the teacher set the time limit while this student was already answering.
      const startedAt = homework.attempts[0]?.startedAt ?? null;
      const left = startedAt === null ? null : secondsLeft(homework, startedAt, now);
      if (left !== null && left * 1000 < -SUBMIT_GRACE_MS) {
        throw new SubmissionError('TIME_UP', `Đã hết giờ làm bài (${homework.timeLimitMinutes} phút), bài làm không được ghi nhận.`);
      }

      const version = await tx.homeworkVersion.findFirst({
        where: { id: versionId, homeworkId: homework.id },
        select: { id: true, questions: { select: { id: true, answers: { select: { id: true, isCorrect: true } } } } },
      });
      // Without submissions, the teacher's edits replace the questions (new ids):
      // the page the student answered no longer matches what is stored.
      const stored = new Set(version?.questions.map((q) => q.id));
      if (!version || stored.size !== new Set(questionIds).size || !questionIds.every((id) => stored.has(id))) {
        throw new SubmissionError(
          'CHANGED',
          'Giáo viên vừa sửa bài tập trong lúc bạn làm bài, nên bài làm này không chấm được. Hãy làm lại.',
        );
      }

      let correct = 0;
      const answers = version.questions.map((question) => {
        const answerId = choices.get(question.id) ?? null;
        const chosen = answerId === null ? null : question.answers.find((a) => a.id === answerId);
        if (chosen === undefined) throw new SubmissionError('INVALID', 'Dữ liệu bài làm không hợp lệ.');
        if (chosen?.isCorrect) correct++;
        return { questionId: question.id, answerId };
      });
      const total = version.questions.length;
      const score = computeScore(correct, total);

      await tx.submission.create({
        data: {
          homeworkId: homework.id,
          versionId: version.id,
          studentName: name,
          studentKey: studentKey(name),
          startedAt,
          submittedAt: now.toISOString(),
          correctCount: correct,
          totalCount: total,
          score,
          resultTokenHash: hashToken(token),
          // One statement for all answers (see insertQuestions in homework.service.ts).
          answers: { createMany: { data: answers } },
        },
        select: { id: true },
      });
      return { token, score };
    }, WRITE_TIMEOUT);
  } catch (error) {
    // The same name submitted from another tab a moment ago.
    if (isUniqueViolation(error)) throw new SubmissionError('NAME_TAKEN', nameTakenMessage(name));
    throw error;
  }
}

export function nameTakenMessage(name: string): string {
  return `Tên “${name}” đã nộp bài này rồi, mỗi tên chỉ nộp một lần. Nếu đó không phải bạn, hãy ghi thêm họ hoặc tên lớp.`;
}

/** One question on the result page, when answers may be shown. */
export interface ResultQuestion {
  id: number;
  text: string;
  /** null when left blank. */
  chosenId: number | null;
  answers: { id: number; text: string; correct: boolean }[];
}

/**
 * The result behind a private link, or null if the code is unknown or belongs
 * to another homework. questions is null unless the reveal mode allows
 * showing the correct answers now.
 */
export async function getResult(prisma: PrismaClient, shareCode: string, token: string, now = new Date()) {
  const submission = await prisma.submission.findUnique({
    where: { resultTokenHash: hashToken(token) },
    select: {
      studentName: true,
      studentKey: true,
      submittedAt: true,
      correctCount: true,
      totalCount: true,
      score: true,
      answers: { select: { questionId: true, answerId: true } },
      homework: { select: { id: true, title: true, shareCode: true, revealMode: true, deadline: true, shuffleQuestions: true } },
      version: { select: { id: true, questions: ORDERED_QUESTIONS } },
    },
  });
  if (!submission || submission.homework.shareCode !== shareCode) return null;

  const { homework, version } = submission;
  const revealed = canReveal(homework, now);
  const chosen = new Map(submission.answers.map((a) => [a.questionId, a.answerId]));
  const questions = revealed
    ? inStudentOrder(version.questions, {
        homeworkId: homework.id,
        versionId: version.id,
        shuffleQuestions: homework.shuffleQuestions,
        key: submission.studentKey,
      }).map(
        (q): ResultQuestion => ({
          id: q.id,
          text: q.text,
          chosenId: chosen.get(q.id) ?? null,
          answers: q.answers.map((a) => ({ id: a.id, text: a.text, correct: a.isCorrect })),
        }),
      )
    : null;

  return {
    title: homework.title,
    shareCode: homework.shareCode,
    revealMode: homework.revealMode,
    deadline: homework.deadline,
    studentName: submission.studentName,
    submittedAt: submission.submittedAt,
    correctCount: submission.correctCount,
    totalCount: submission.totalCount,
    score: submission.score,
    questions,
  };
}
