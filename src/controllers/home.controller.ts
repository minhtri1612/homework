import type { Request, Response } from 'express';
import { GRADES } from '../catalog.ts';

/** The home page: the share-code box and the grades. Also shown again by /join when the code is wrong. */
export function renderHome(res: Response, { status = 200, codeInput = '', codeError = null as string | null } = {}) {
  res.status(status).render('home', { title: 'Bài tập trắc nghiệm', grades: GRADES, codeInput, codeError });
}

export function getHomePage(req: Request, res: Response) {
  renderHome(res);
}
