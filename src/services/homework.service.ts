import type { Prisma, PrismaClient } from '../generated/prisma/client.ts';
import { validateQuestion } from '../shared/parser.js';
import { generateShareCode } from './share-code.service.ts';

const REVEAL_MODES = ['never', 'after_submit', 'after_deadline'];

/** The client itself or the tx inside prisma.$transaction(async (tx) => …). */
type Db = PrismaClient | Prisma.TransactionClient;

/** A question as the parser and the editor produce it. */
export interface QuestionInput {
  text: string;
  answers: { text: string; correct: boolean }[];
  shuffleAnswers?: boolean;
}

/** A saved question: like QuestionInput, plus the ids. */
export interface SavedQuestion {
  id: number;
  text: string;
  shuffleAnswers: boolean;
  answers: { id: number; text: string; correct: boolean }[];
}

/** One reason a homework cannot be saved. message is Vietnamese. */
export interface HomeworkError {
  code: string;
  message: string;
  /** 1-based number of the question the error is about. */
  question?: number;
  line?: number;
}

/**
 * The settings and questions of a homework. deadline is a UTC ISO string,
 * null for none, or the INVALID_TIME marker from fromVietnamInput().
 */
export interface HomeworkInput {
  title: string;
  questions: QuestionInput[];
  revealMode?: string;
  deadline?: string | null;
  shuffleQuestions?: boolean;
}

export const LIMITS = { title: 200, questions: 200, questionText: 2000, answerText: 500 };

// Prisma's interactive transactions give up after 5 s by default. Saving 200
// questions is about 400 statements, which over Turso's network can take longer.
const WRITE_TIMEOUT = { timeout: 30_000 };

/**
 * Checks a homework before saving. Returns a list of { code, message,
 * question? } in Vietnamese; empty means it can be saved.
 */
export function validateHomework({ title, questions, revealMode = 'after_submit', deadline = null }: HomeworkInput): HomeworkError[] {
  const errors: HomeworkError[] = [];
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
  errors: HomeworkError[];

  constructor(errors: HomeworkError[]) {
    super(errors.map((e) => e.message).join(' '));
    this.errors = errors;
  }
}

/**
 * Saves a new homework as version 1. questions use the parser's shape:
 * { text, answers: [{ text, correct }], shuffleAnswers? }.
 * Returns { id, shareCode, versionId }. Nothing is written if it is invalid.
 */
export async function createHomework(
  prisma: PrismaClient,
  { teacherId, title, questions, revealMode = 'after_submit', deadline = null, shuffleQuestions = false }: HomeworkInput & { teacherId: number },
): Promise<{ id: number; shareCode: string; versionId: number }> {
  const errors = validateHomework({ title, questions, revealMode, deadline });
  if (errors.length) throw new HomeworkValidationError(errors);

  const now = new Date().toISOString();
  return prisma.$transaction(async (tx) => {
    // Transactions run one at a time, so a code that is free here is still
    // free when the insert runs. The UNIQUE constraint backs this up.
    let shareCode: string;
    do {
      shareCode = generateShareCode();
    } while (await tx.homework.findUnique({ where: { shareCode }, select: { id: true } }));

    const homework = await tx.homework.create({
      data: { ...settingsData({ title, revealMode, deadline, shuffleQuestions }), teacherId, shareCode, createdAt: now, updatedAt: now },
      select: { id: true },
    });
    const versionId = await insertVersion(tx, homework.id, 1, questions, now);
    return { id: homework.id, shareCode, versionId };
  }, WRITE_TIMEOUT);
}

/**
 * Saves changes to a homework the teacher owns. If students have already
 * submitted the current version and the questions changed, the questions go
 * into a new version; otherwise the current version is updated in place.
 * Returns { version, newVersion } or null when the homework is not this
 * teacher's (or does not exist).
 */
export async function updateHomework(
  prisma: PrismaClient,
  { id, teacherId, title, questions, revealMode = 'after_submit', deadline = null, shuffleQuestions = false }: HomeworkInput & { id: number; teacherId: number },
): Promise<{ version: number; newVersion: boolean } | null> {
  const errors = validateHomework({ title, questions, revealMode, deadline });
  if (errors.length) throw new HomeworkValidationError(errors);

  const now = new Date().toISOString();
  return prisma.$transaction(async (tx) => {
    const version = await tx.homeworkVersion.findFirst({
      where: { homework: { id, teacherId } },
      orderBy: { number: 'desc' },
      select: { id: true, number: true, _count: { select: { submissions: true } } },
    });
    if (!version) return null;

    await tx.homework.update({
      where: { id },
      data: { ...settingsData({ title, revealMode, deadline, shuffleQuestions }), updatedAt: now },
    });

    if (sameQuestions(await loadQuestions(tx, version.id), questions)) {
      return { version: version.number, newVersion: false };
    }
    if (version._count.submissions > 0) {
      await insertVersion(tx, id, version.number + 1, questions, now);
      return { version: version.number + 1, newVersion: true };
    }
    await tx.question.deleteMany({ where: { versionId: version.id } });
    await insertQuestions(tx, version.id, questions);
    return { version: version.number, newVersion: false };
  }, WRITE_TIMEOUT);
}

function settingsData({ title, revealMode, deadline, shuffleQuestions }: Required<Omit<HomeworkInput, 'questions'>>) {
  return {
    title: title.normalize('NFC').trim(),
    revealMode,
    deadline: deadline === null ? null : new Date(deadline).toISOString(),
    shuffleQuestions: Boolean(shuffleQuestions),
  };
}

/** Compares what students would see, ignoring ids and Unicode/space differences. */
function sameQuestions(saved: SavedQuestion[], questions: QuestionInput[]): boolean {
  const key = (list: (SavedQuestion | QuestionInput)[]) =>
    JSON.stringify(
      list.map((q) => [clean(q.text), Boolean(q.shuffleAnswers), q.answers.map((a) => [clean(a.text), Boolean(a.correct)])]),
    );
  return key(saved) === key(questions);
}

async function insertVersion(
  tx: Prisma.TransactionClient,
  homeworkId: number,
  number: number,
  questions: QuestionInput[],
  createdAt: string,
): Promise<number> {
  const version = await tx.homeworkVersion.create({
    data: { homeworkId, number, createdAt },
    select: { id: true },
  });
  await insertQuestions(tx, version.id, questions);
  return version.id;
}

// One nested create per question: the question and its answers in one call.
async function insertQuestions(tx: Prisma.TransactionClient, versionId: number, questions: QuestionInput[]): Promise<void> {
  for (const [i, question] of questions.entries()) {
    await tx.question.create({
      data: {
        versionId,
        position: i + 1,
        text: clean(question.text),
        shuffleAnswers: Boolean(question.shuffleAnswers),
        answers: {
          create: question.answers.map((answer, j) => ({
            position: j + 1,
            text: clean(answer.text),
            isCorrect: Boolean(answer.correct),
          })),
        },
      },
      select: { id: true },
    });
  }
}

/**
 * Loads a homework with the questions of its current (latest) version, or
 * null. Includes the correct answers: for the teacher and for grading only,
 * never send this object as-is to a student's browser.
 */
export async function getHomework(prisma: PrismaClient, id: number) {
  const homework = await prisma.homework.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { number: 'desc' },
        take: 1,
        select: { id: true, number: true, _count: { select: { submissions: true } } },
      },
    },
  });
  const version = homework?.versions[0];
  if (!version) return null;

  return {
    id: homework.id,
    teacherId: homework.teacherId,
    title: homework.title,
    shareCode: homework.shareCode,
    revealMode: homework.revealMode,
    deadline: homework.deadline,
    shuffleQuestions: homework.shuffleQuestions,
    createdAt: homework.createdAt,
    updatedAt: homework.updatedAt,
    version: { id: version.id, number: version.number, submissionCount: version._count.submissions },
    questions: await loadQuestions(prisma, version.id),
  };
}

/**
 * What anyone with the share code may see about a homework, or null. Safe to
 * show to students: no questions, no answers.
 */
export async function findSharedHomework(prisma: PrismaClient, shareCode: string) {
  const homework = await prisma.homework.findUnique({
    where: { shareCode },
    select: {
      id: true,
      title: true,
      shareCode: true,
      deadline: true,
      teacher: { select: { name: true } },
      ...LATEST_QUESTION_COUNT,
    },
  });
  if (!homework) return null;
  return {
    id: homework.id,
    title: homework.title,
    shareCode: homework.shareCode,
    deadline: homework.deadline,
    teacherName: homework.teacher.name,
    questionCount: questionCount(homework),
  };
}

// Selects the number of questions in the latest version; read it with questionCount().
const LATEST_QUESTION_COUNT = {
  versions: { orderBy: { number: 'desc' }, take: 1, select: { _count: { select: { questions: true } } } },
} satisfies Prisma.HomeworkSelect;

function questionCount(homework: { versions: { _count: { questions: number } }[] }): number {
  return homework.versions[0]?._count.questions ?? 0;
}

/** Questions of one version with their answers, in order. prisma can be a transaction. */
async function loadQuestions(prisma: Db, versionId: number): Promise<SavedQuestion[]> {
  const questions = await prisma.question.findMany({
    where: { versionId },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      text: true,
      shuffleAnswers: true,
      answers: { orderBy: { position: 'asc' }, select: { id: true, text: true, isCorrect: true } },
    },
  });
  return questions.map((q) => ({
    id: q.id,
    text: q.text,
    shuffleAnswers: q.shuffleAnswers,
    answers: q.answers.map((a) => ({ id: a.id, text: a.text, correct: a.isCorrect })),
  }));
}

function clean(text: unknown): string {
  return String(text ?? '').normalize('NFC').trim();
}

/** A teacher's homework sets, newest first, with question and submission counts. */
export async function listHomeworks(prisma: PrismaClient, teacherId: number) {
  const homeworks = await prisma.homework.findMany({
    where: { teacherId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      title: true,
      shareCode: true,
      createdAt: true,
      _count: { select: { submissions: true } },
      ...LATEST_QUESTION_COUNT,
    },
  });
  return homeworks.map((homework) => ({
    id: homework.id,
    title: homework.title,
    shareCode: homework.shareCode,
    createdAt: homework.createdAt,
    questionCount: questionCount(homework),
    submissionCount: homework._count.submissions,
  }));
}
