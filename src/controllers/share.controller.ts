// Pages for students, who have no account: open a homework by its share code.
import type { Request, Response } from 'express';
import { findSharedHomework } from '../services/homework.service.ts';
import { joinSchema, shareCodeParam } from '../validation/share.schema.ts';

// The code box on the home page (a GET form, so nothing to protect).
export function getJoin(req: Request, res: Response) {
  const result = joinSchema.safeParse(req.query);
  if (result.success) return res.redirect(`/h/${result.data.code}`);
  res.status(400).render('home', {
    title: 'Bài tập trắc nghiệm',
    codeInput: String(req.query.code ?? ''),
    codeError: result.error.issues[0].message,
  });
}

export async function getSharedHomework(req: Request, res: Response) {
  const code = shareCodeParam.parse(req.params.code);
  // One address per homework: /h/abc234 → /h/ABC234.
  if (code && code !== req.params.code) return res.redirect(`/h/${code}`);
  const homework = code ? await findSharedHomework(req.prisma, code) : null;
  if (!homework) {
    return res.status(404).render('error', {
      title: 'Không tìm thấy',
      message: 'Không có bài tập nào với mã này. Hãy kiểm tra lại mã, hoặc hỏi thầy cô.',
    });
  }
  res.render('share', {
    title: homework.title,
    homework,
    closed: homework.deadline !== null && new Date(homework.deadline) <= new Date(),
  });
}
