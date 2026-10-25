// Pages for students, who have no account: open a homework by its share code.
import { Router } from 'express';
import { findSharedHomework } from '../services/homework.service.js';
import { normalizeShareCode } from '../services/share-code.service.js';

export function studentRoutes(prisma) {
  const router = Router();

  // The code box on the home page (a GET form, so nothing to protect).
  router.get('/join', (req, res) => {
    const input = String(req.query.code ?? '');
    const code = normalizeShareCode(input);
    if (code) return res.redirect(`/h/${code}`);
    res.status(400).render('home', {
      title: 'Bài tập trắc nghiệm',
      codeInput: input,
      codeError: input.trim()
        ? 'Mã bài tập gồm 6 chữ cái và chữ số, ví dụ ABC234. Hãy kiểm tra lại.'
        : 'Hãy nhập mã bài tập.',
    });
  });

  router.get('/h/:code', async (req, res) => {
    const code = normalizeShareCode(req.params.code);
    // One address per homework: /h/abc234 → /h/ABC234.
    if (code && code !== req.params.code) return res.redirect(`/h/${code}`);
    const homework = code ? await findSharedHomework(prisma, code) : null;
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
  });

  return router;
}
