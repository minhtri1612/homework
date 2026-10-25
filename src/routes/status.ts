// The last handlers (a page that does not exist, and errors), and the health check.
import type { Request, Response, NextFunction } from 'express';

export function notFound(req: Request, res: Response) {
  res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang này không tồn tại.' });
}

// Express 5 sends errors thrown in async controllers here.
export function serverError(error: unknown, req: Request, res: Response, next: NextFunction) {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).render('error', { title: 'Có lỗi', message: 'Máy chủ gặp lỗi. Hãy thử lại sau ít phút.' });
}

/** GET /healthz for Render: "ok" when the database answers, 503 otherwise. A failing new deploy is not switched to. */
export async function healthz(req: Request, res: Response) {
  try {
    await req.prisma.$queryRaw`SELECT 1`;
    res.type('text/plain').send('ok');
  } catch (error) {
    console.error(error);
    res.status(503).type('text/plain').send('database unavailable');
  }
}
