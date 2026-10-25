// The teacher's results: submissions of a homework, statistics per question,
// the CSV export, and deleting a submission or the whole homework. Every
// route goes through ownHomework(): another teacher's homework is a 404.
import type { Request, Response } from 'express';
import { ownHomework } from './homework.controller.ts';
import { currentTeacher } from '../middleware/auth.ts';
import { formatScore } from '../grading.ts';
import { formatVietnamDateTime } from '../vietnam-time.ts';
import {
  deleteHomework,
  deleteSubmission,
  findSubmission,
  listSubmissions,
  listUnfinished,
  listVersions,
  questionStats,
  resetAttempt,
  submissionsCsv,
  type Away,
} from '../services/results.service.ts';
import { secondsLeft } from '../services/submission.service.ts';
import { deleteHomeworkForm, studentKeyParam, submissionIdParam, versionQuery } from '../validation/results.schema.ts';

const NOTICES: Record<string, string> = {
  'submission-deleted': 'Đã xoá bài nộp. Học sinh đó có thể nộp lại với cùng tên.',
  'attempt-reset': 'Đã cho làm lại. Học sinh đó bắt đầu lại với đồng hồ mới.',
};

/** 45 → "45 giây", 200 → "3 phút 20 giây", 3900 → "1 giờ 5 phút". */
function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return m ? `${h} giờ ${m} phút` : `${h} giờ`;
  if (m) return s ? `${m} phút ${s} giây` : `${m} phút`;
  return `${s} giây`;
}

/** "Rời trang 4 lần, tổng 3 phút 20 giây", or null when the student never left (or nothing was recorded). */
function awayText(away: Away | null): string | null {
  if (!away || away.leaveCount === 0) return null;
  return `Rời trang ${away.leaveCount} lần, tổng ${duration(away.awaySeconds)}`;
}

function notFound(res: Response, message: string) {
  res.status(404).render('error', { title: 'Không tìm thấy', message });
}

/**
 * The versions and the one picked with ?version=N. Without the parameter:
 * all submissions, or the only version when there is just one. undefined
 * (after rendering a 404) for a version that does not exist.
 */
async function pickVersion(req: Request, res: Response, homeworkId: number) {
  const versions = await listVersions(req.prisma, homeworkId);
  const { version } = versionQuery.parse(req.query);
  if (version === null) return { versions, selected: versions.length === 1 ? versions[0]! : null };
  const selected = versions.find((v) => v.number === version);
  if (!selected) {
    notFound(res, 'Bài tập này không có phiên bản đó.');
    return undefined;
  }
  return { versions, selected };
}

export async function getResultsPage(req: Request, res: Response) {
  const homework = await ownHomework(req, res);
  if (!homework) return;
  const picked = await pickVersion(req, res, homework.id);
  if (!picked) return;
  const { versions, selected } = picked;

  const submissions = await listSubmissions(req.prisma, homework.id, selected?.id ?? null);
  const average = submissions.length ? submissions.reduce((sum, s) => sum + s.score, 0) / submissions.length : null;
  const notice = typeof req.query.notice === 'string' ? (NOTICES[req.query.notice] ?? null) : null;

  const unfinished = (await listUnfinished(req.prisma, homework.id)).map((a) => {
    const left = secondsLeft(homework, a.startedAt);
    return {
      ...a,
      status: left === null ? 'Đã bắt đầu' : left > 0 ? `Đang làm, còn ${Math.ceil(left / 60)} phút` : 'Hết giờ, chưa nộp',
      awayText: awayText(a),
      resetUrl: `/teacher/homeworks/${homework.id}/attempts/${encodeURIComponent(a.studentKey)}/reset`,
    };
  });

  res.render('results', {
    title: `Kết quả: ${homework.title}`,
    homework,
    versions,
    selected,
    unfinished,
    showAway: submissions.some((s) => s.away !== null),
    submissions: submissions.map((s) => ({ ...s, scoreText: formatScore(s.score), awayText: awayText(s.away) })),
    average: average === null ? null : formatScore(Math.round(average * 100) / 100),
    stats: selected && selected.submissionCount > 0 ? await questionStats(req.prisma, selected.id) : null,
    csvUrl: `/teacher/homeworks/${homework.id}/results.csv${selected && versions.length > 1 ? `?version=${selected.number}` : ''}`,
    notice,
  });
}

export async function getResultsCsv(req: Request, res: Response) {
  const homework = await ownHomework(req, res);
  if (!homework) return;
  const picked = await pickVersion(req, res, homework.id);
  if (!picked) return;
  const { versions, selected } = picked;

  const rows = await listSubmissions(req.prisma, homework.id, selected?.id ?? null);
  const suffix = selected && versions.length > 1 ? `-v${selected.number}` : '';
  res.type('text/csv; charset=utf-8');
  res.attachment(`ket-qua-${homework.shareCode}${suffix}.csv`);
  res.send(submissionsCsv(rows));
}

/** The submission in :submissionId of this teacher's homework, or a 404. */
async function ownSubmission(req: Request, res: Response) {
  const homework = await ownHomework(req, res);
  if (!homework) return null;
  const submissionId = submissionIdParam.parse(req.params.submissionId);
  const submission = submissionId === null ? null : await findSubmission(req.prisma, homework.id, submissionId);
  if (!submission) {
    notFound(res, 'Không có bài nộp này.');
    return null;
  }
  return { homework, submission };
}

export async function getDeleteSubmissionPage(req: Request, res: Response) {
  const own = await ownSubmission(req, res);
  if (!own) return;
  const { homework, submission } = own;
  res.render('confirm-delete', {
    title: 'Xoá bài nộp',
    heading: 'Xoá bài nộp?',
    lines: [
      `Bài tập: ${homework.title}`,
      `Học sinh: ${submission.studentName}, ${formatScore(submission.score)} điểm.`,
      'Bài nộp và các đáp án đã chọn bị xoá vĩnh viễn. Sau đó học sinh có thể nộp lại với cùng tên.',
    ],
    action: `/teacher/homeworks/${homework.id}/submissions/${submission.id}/delete`,
    cancel: `/teacher/homeworks/${homework.id}/results`,
    button: 'Xoá bài nộp',
    check: null,
    error: null,
  });
}

export async function postDeleteSubmission(req: Request, res: Response) {
  const own = await ownSubmission(req, res);
  if (!own) return;
  await deleteSubmission(req.prisma, {
    homeworkId: own.homework.id,
    teacherId: currentTeacher(req).id,
    submissionId: own.submission.id,
  });
  res.redirect(303, `/teacher/homeworks/${own.homework.id}/results?notice=submission-deleted`);
}

/** The unfinished attempt in :studentKey of this teacher's homework, or a 404. */
async function ownUnfinished(req: Request, res: Response) {
  const homework = await ownHomework(req, res);
  if (!homework) return null;
  const key = studentKeyParam.parse(req.params.studentKey);
  const attempt = key === null ? undefined : (await listUnfinished(req.prisma, homework.id)).find((a) => a.studentKey === key);
  if (!attempt) {
    notFound(res, 'Không có học sinh nào đang làm dở bài này với tên đó.');
    return null;
  }
  return { homework, attempt };
}

export async function getResetAttemptPage(req: Request, res: Response) {
  const own = await ownUnfinished(req, res);
  if (!own) return;
  const { homework, attempt } = own;
  res.render('confirm-delete', {
    title: 'Cho làm lại',
    heading: 'Cho học sinh làm lại?',
    lines: [
      `Bài tập: ${homework.title}`,
      `Học sinh: ${attempt.studentName}, bắt đầu lúc ${formatVietnamDateTime(attempt.startedAt)} (giờ Việt Nam), chưa nộp bài.`,
      'Giờ bắt đầu và số lần rời trang của em đó bị xoá. Em đó có thể bấm “Bắt đầu làm bài” lại với đồng hồ mới.',
    ],
    action: `/teacher/homeworks/${homework.id}/attempts/${encodeURIComponent(attempt.studentKey)}/reset`,
    cancel: `/teacher/homeworks/${homework.id}/results`,
    button: 'Cho làm lại',
    check: null,
    error: null,
  });
}

export async function postResetAttempt(req: Request, res: Response) {
  const own = await ownUnfinished(req, res);
  if (!own) return;
  await resetAttempt(req.prisma, {
    homeworkId: own.homework.id,
    teacherId: currentTeacher(req).id,
    studentKey: own.attempt.studentKey,
  });
  res.redirect(303, `/teacher/homeworks/${own.homework.id}/results?notice=attempt-reset`);
}

async function renderDeleteHomework(req: Request, res: Response, { status = 200, error = null as string | null } = {}): Promise<void> {
  const homework = await ownHomework(req, res);
  if (!homework) return;
  const versions = await listVersions(req.prisma, homework.id);
  const submissionCount = versions.reduce((sum, v) => sum + v.submissionCount, 0);
  res.status(status).render('confirm-delete', {
    title: 'Xoá bài tập',
    heading: 'Xoá bài tập?',
    lines: [
      `“${homework.title}” (mã ${homework.shareCode}), ${versions.length} phiên bản, ${submissionCount} bài nộp.`,
      'Câu hỏi, các phiên bản và mọi bài nộp bị xoá vĩnh viễn, không lấy lại được. Link và mã bài tập ngừng hoạt động.',
    ],
    action: `/teacher/homeworks/${homework.id}/delete`,
    cancel: `/teacher/homeworks/${homework.id}/edit`,
    button: 'Xoá bài tập',
    check: submissionCount > 0 ? `Tôi hiểu rằng ${submissionCount} bài nộp của học sinh cũng bị xoá.` : null,
    error,
  });
}

export async function getDeleteHomeworkPage(req: Request, res: Response) {
  await renderDeleteHomework(req, res);
}

export async function postDeleteHomework(req: Request, res: Response) {
  const homework = await ownHomework(req, res);
  if (!homework) return;
  const outcome = await deleteHomework(req.prisma, {
    id: homework.id,
    teacherId: currentTeacher(req).id,
    submissionsConfirmed: deleteHomeworkForm.parse(req.body).confirm,
  });
  if (outcome === 'needs_confirmation') {
    await renderDeleteHomework(req, res, { status: 400, error: 'Hãy đánh dấu ô xác nhận trước khi xoá.' });
    return;
  }
  // 'not_found': deleted a moment ago (another tab); the dashboard is the right place either way.
  res.redirect(303, outcome === 'deleted' ? '/teacher?notice=homework-deleted' : '/teacher');
}
