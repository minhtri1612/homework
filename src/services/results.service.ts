// The teacher's side of submissions: the list, statistics per question,
// the CSV export, and deleting a submission or a whole homework.
import type { PrismaClient } from '../generated/prisma/client.ts';
import { toVietnamInput } from '../vietnam-time.ts';

/** The versions of a homework, oldest first, with how many submissions each has. */
export async function listVersions(prisma: PrismaClient, homeworkId: number) {
  const versions = await prisma.homeworkVersion.findMany({
    where: { homeworkId },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, _count: { select: { submissions: true } } },
  });
  return versions.map((v) => ({ id: v.id, number: v.number, submissionCount: v._count.submissions }));
}

export interface SubmissionRow {
  id: number;
  studentName: string;
  score: number;
  correctCount: number;
  totalCount: number;
  versionNumber: number;
  submittedAt: string;
}

/** A homework's submissions, oldest first; only those of one version when versionId is given. */
export async function listSubmissions(prisma: PrismaClient, homeworkId: number, versionId: number | null = null): Promise<SubmissionRow[]> {
  const submissions = await prisma.submission.findMany({
    where: { homeworkId, ...(versionId !== null && { versionId }) },
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      studentName: true,
      score: true,
      correctCount: true,
      totalCount: true,
      submittedAt: true,
      version: { select: { number: true } },
    },
  });
  return submissions.map(({ version, ...s }) => ({ ...s, versionNumber: version.number }));
}

export interface QuestionStats {
  id: number;
  text: string;
  /** Submissions of this version that got the question right. */
  correctCount: number;
  blankCount: number;
  answers: { id: number; text: string; correct: boolean; chosenCount: number }[];
}

/** For one version: each question (teacher's order) with how often each answer was chosen. */
export async function questionStats(prisma: PrismaClient, versionId: number): Promise<QuestionStats[]> {
  const [questions, chosen] = await Promise.all([
    prisma.question.findMany({
      where: { versionId },
      orderBy: { position: 'asc' },
      select: { id: true, text: true, answers: { orderBy: { position: 'asc' }, select: { id: true, text: true, isCorrect: true } } },
    }),
    prisma.submissionAnswer.findMany({ where: { submission: { versionId } }, select: { questionId: true, answerId: true } }),
  ]);

  const counts = new Map<number | null, number>();
  const blanks = new Map<number, number>();
  for (const { questionId, answerId } of chosen) {
    if (answerId === null) blanks.set(questionId, (blanks.get(questionId) ?? 0) + 1);
    else counts.set(answerId, (counts.get(answerId) ?? 0) + 1);
  }
  return questions.map((q) => {
    const answers = q.answers.map((a) => ({ id: a.id, text: a.text, correct: a.isCorrect, chosenCount: counts.get(a.id) ?? 0 }));
    return {
      id: q.id,
      text: q.text,
      correctCount: answers.find((a) => a.correct)?.chosenCount ?? 0,
      blankCount: blanks.get(q.id) ?? 0,
      answers,
    };
  });
}

// A cell starting with one of these is run as a formula by Excel and Google
// Sheets. Student names come from anyone with the link, so such cells get a
// leading apostrophe, which spreadsheets show as plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The submissions as CSV: comma-separated, score with a decimal point, CRLF
 * line ends, and a UTF-8 byte order mark so that Excel reads Vietnamese
 * correctly. Times are Vietnam time.
 */
export function submissionsCsv(rows: SubmissionRow[]): string {
  const header = ['STT', 'Họ tên', 'Điểm', 'Số câu đúng', 'Tổng số câu', 'Phiên bản', 'Nộp lúc (giờ Việt Nam)'];
  const lines = rows.map((row, i) => [
    i + 1,
    row.studentName,
    row.score,
    row.correctCount,
    row.totalCount,
    row.versionNumber,
    toVietnamInput(row.submittedAt).replace('T', ' '),
  ]);
  return `﻿${[header, ...lines].map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** One submission of a homework, for the delete confirmation; null if it is not in that homework. */
export async function findSubmission(prisma: PrismaClient, homeworkId: number, submissionId: number) {
  return prisma.submission.findFirst({
    where: { id: submissionId, homeworkId },
    select: { id: true, studentName: true, score: true, submittedAt: true },
  });
}

/**
 * Deletes one submission (its answers cascade). The name is free again, so
 * the student can submit once more. False if it is not this teacher's.
 */
export async function deleteSubmission(
  prisma: PrismaClient,
  { homeworkId, teacherId, submissionId }: { homeworkId: number; teacherId: number; submissionId: number },
): Promise<boolean> {
  const { count } = await prisma.submission.deleteMany({ where: { id: submissionId, homework: { id: homeworkId, teacherId } } });
  return count > 0;
}

/**
 * Deletes a homework with all its versions, questions and submissions
 * (ON DELETE CASCADE). A homework with submissions is only deleted when the
 * teacher confirmed that; checked in the same transaction, so a student
 * submitting at that moment cannot slip past the confirmation.
 */
export async function deleteHomework(
  prisma: PrismaClient,
  { id, teacherId, submissionsConfirmed }: { id: number; teacherId: number; submissionsConfirmed: boolean },
): Promise<'deleted' | 'not_found' | 'needs_confirmation'> {
  return prisma.$transaction(async (tx) => {
    const homework = await tx.homework.findFirst({
      where: { id, teacherId },
      select: { _count: { select: { submissions: true } } },
    });
    if (!homework) return 'not_found';
    if (homework._count.submissions > 0 && !submissionsConfirmed) return 'needs_confirmation';
    await tx.homework.delete({ where: { id } });
    return 'deleted';
  });
}
