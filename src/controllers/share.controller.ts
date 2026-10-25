// Pages for students, who have no account: open a homework by its share code,
// enter a name, answer, submit and see the result.
import type { Request, Response } from 'express';
import { findSharedHomework } from '../services/homework.service.ts';
import {
  canReveal,
  findAttempt,
  getQuestionsForStudent,
  getResult,
  hasSubmitted,
  isClosed,
  nameTakenMessage,
  recordAway,
  secondsLeft,
  startAttempt,
  submitAnswers,
  SubmissionError,
} from '../services/submission.service.ts';
import { readCookie } from '../middleware/auth.ts';
import { formatScore } from '../grading.ts';
import { joinSchema, shareCodeParam } from '../validation/share.schema.ts';
import { awaySchema, nameSchema, submitSchema } from '../validation/student.schema.ts';

const RESULT_COOKIE_DAYS = 365;

// The code box on the home page (a GET form, so nothing to protect).
export function getJoin(req: Request, res: Response) {
  const result = joinSchema.safeParse(req.query);
  if (result.success) return res.redirect(`/h/${result.data.code}`);
  res.status(400).render('home', {
    title: 'Bài tập trắc nghiệm',
    codeInput: String(req.query.code ?? ''),
    codeError: result.error.issues[0]!.message,
  });
}

function notFound(res: Response) {
  res.status(404).render('error', {
    title: 'Không tìm thấy',
    message: 'Không có bài tập nào với mã này. Hãy kiểm tra lại mã, hoặc hỏi thầy cô.',
  });
}

/**
 * The share code in the address, or null after answering. One address per
 * homework: /h/abc234/… redirects to /h/ABC234/… (GET only), and a code that
 * cannot exist is a 404.
 */
function codeOf(req: Request, res: Response): string | null {
  const code = shareCodeParam.parse(req.params.code);
  if (!code) {
    notFound(res);
    return null;
  }
  if (code !== req.params.code && req.method === 'GET') {
    const rest = req.originalUrl.slice(`/h/${req.params.code}`.length);
    res.redirect(`/h/${code}${rest}`);
    return null;
  }
  return code;
}

// The private result link of the last submission from this browser, per homework.
function resultCookie(code: string) {
  return `result_${code}`;
}

function resultPath(code: string, token: string) {
  return `/h/${code}/result/${token}`;
}

interface SharePage {
  status?: number;
  nameInput?: string;
  nameError?: string | null;
  notice?: string | null;
}

/** The homework's start page: title, deadline, the name box, and the last result from this browser. */
async function renderShare(req: Request, res: Response, code: string, page: SharePage = {}) {
  const homework = await findSharedHomework(req.prisma, code);
  if (!homework) return notFound(res);

  // On a shared school computer this is the previous student's result; the
  // name box stays available for the next one.
  const token = readCookie(req, resultCookie(code));
  const previous = token ? await getResult(req.prisma, code, token) : null;

  res.status(page.status ?? 200).render('share', {
    title: homework.title,
    homework,
    closed: isClosed(homework.deadline),
    previous: previous && { name: previous.studentName, url: resultPath(code, token!) },
    nameInput: page.nameInput ?? '',
    nameError: page.nameError ?? null,
    notice: page.notice ?? null,
  });
}

export async function getSharedHomework(req: Request, res: Response) {
  const code = codeOf(req, res);
  if (code) await renderShare(req, res, code);
}

/**
 * The name box of a homework with a time limit: records when this student
 * started (the first time only), then opens the answer page.
 */
export async function postStart(req: Request, res: Response) {
  const code = codeOf(req, res);
  if (!code) return;
  const nameInput = String(req.body?.name ?? '');
  const parsed = nameSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return renderShare(req, res, code, { status: 400, nameInput, nameError: parsed.error.issues[0]!.message });
  }
  const { name } = parsed.data;

  const homework = await findSharedHomework(req.prisma, code);
  if (!homework) return notFound(res);
  if (isClosed(homework.deadline)) return renderShare(req, res, code, { status: 403 });
  if (await hasSubmitted(req.prisma, homework.id, name)) {
    return renderShare(req, res, code, { status: 409, nameInput, nameError: nameTakenMessage(name) });
  }
  // Without a time limit (the teacher just removed it) nothing needs recording.
  if (homework.timeLimitMinutes !== null) await startAttempt(req.prisma, homework.id, name);
  res.redirect(303, `/h/${code}/answer?name=${encodeURIComponent(name)}`);
}

// Without a time limit, the name box is a GET form to /h/CODE/answer?name=…:
// nothing is saved yet. With one, postStart() comes first.
export async function getAnswerPage(req: Request, res: Response) {
  const code = codeOf(req, res);
  if (!code) return;
  const nameInput = String(req.query.name ?? '');
  const parsed = nameSchema.safeParse(req.query);
  if (!parsed.success) {
    return renderShare(req, res, code, { status: 400, nameInput, nameError: parsed.error.issues[0]!.message });
  }
  const { name } = parsed.data;

  const homework = await getQuestionsForStudent(req.prisma, code, name);
  if (!homework) return notFound(res);
  if (isClosed(homework.deadline)) return renderShare(req, res, code, { status: 403 });
  if (await hasSubmitted(req.prisma, homework.id, name)) {
    return renderShare(req, res, code, { status: 409, nameInput, nameError: nameTakenMessage(name) });
  }

  let left: number | null = null;
  let leaveCount = 0;
  if (homework.timeLimitMinutes !== null) {
    const attempt = await findAttempt(req.prisma, homework.id, name);
    // Not started yet (an old link, or the time limit was added since): the
    // start page, with the name filled in, explains the time limit first.
    if (attempt === null) return renderShare(req, res, code, { nameInput });
    left = secondsLeft(homework, attempt.startedAt)!;
    leaveCount = attempt.leaveCount;
    if (left <= 0) {
      const notice = `Đã hết giờ làm bài (${homework.timeLimitMinutes} phút), bài làm không được ghi nhận.`;
      return renderShare(req, res, code, { status: 403, nameInput, notice });
    }
  }

  res.render('answer', { title: homework.title, homework, name, secondsLeft: left, leaveCount });
}

/** The answer page reporting that the student left it or came back. Nothing to show: 204. */
export async function postAway(req: Request, res: Response) {
  const code = codeOf(req, res);
  if (!code) return;
  const form = awaySchema.safeParse(req.body ?? {});
  if (!form.success) return res.sendStatus(400);
  await recordAway(req.prisma, { shareCode: code, ...form.data });
  res.sendStatus(204);
}

const SUBMIT_STATUS: Record<SubmissionError['code'], number> = {
  NOT_FOUND: 404,
  CLOSED: 403,
  TIME_UP: 403,
  NAME_TAKEN: 409,
  CHANGED: 409,
  INVALID: 400,
};

export async function postSubmit(req: Request, res: Response) {
  const code = codeOf(req, res);
  if (!code) return;
  const form = submitSchema.safeParse(req.body);
  if (!form.success) {
    return res.status(400).render('error', { title: 'Có lỗi', message: 'Dữ liệu bài làm không hợp lệ. Hãy mở lại bài tập và làm lại.' });
  }

  let token: string;
  try {
    ({ token } = await submitAnswers(req.prisma, { shareCode: code, ...form.data }));
  } catch (error) {
    if (!(error instanceof SubmissionError)) throw error;
    if (error.code === 'NOT_FOUND') return notFound(res);
    if (error.code === 'INVALID') return res.status(400).render('error', { title: 'Có lỗi', message: error.message });
    return renderShare(req, res, code, {
      status: SUBMIT_STATUS[error.code],
      nameInput: form.data.name,
      notice: error.message,
    });
  }

  res.cookie(resultCookie(code), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/h/${code}`,
    maxAge: RESULT_COOKIE_DAYS * 24 * 60 * 60 * 1000,
  });
  // 303: the browser follows with a GET, so reloading the result page does not submit again.
  res.redirect(303, resultPath(code, token));
}

export async function getResultPage(req: Request, res: Response) {
  const code = codeOf(req, res);
  if (!code) return;
  const result = await getResult(req.prisma, code, String(req.params.token));
  if (!result) {
    return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không có kết quả nào ở link này. Hãy kiểm tra lại link.' });
  }
  res.render('result', {
    title: `Kết quả: ${result.title}`,
    result,
    score: formatScore(result.score),
    resultUrl: `${req.protocol}://${req.get('host')}${resultPath(code, String(req.params.token))}`,
    revealLater: result.questions === null && result.revealMode === 'after_deadline' && !canReveal(result),
  });
}
