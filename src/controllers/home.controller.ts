import type { Request, Response } from 'express';
export function getHomePage(req: Request, res: Response) {
  res.render('home', { title: 'Bài tập trắc nghiệm', codeInput: '', codeError: null });
}
