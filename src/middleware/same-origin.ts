// Protection against forms posted from other websites (CSRF).
import type { Request, Response, NextFunction } from 'express';

/**
 * Rejects form posts coming from another website. Browsers send an Origin
 * header with every POST; it must match the site the form was posted to.
 */
export function sameOriginPosts(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'POST') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host === req.get('host')) return next();
  res.status(403).render('error', { title: 'Không được phép', message: 'Yêu cầu này đến từ một trang web khác nên đã bị chặn.' });
}
