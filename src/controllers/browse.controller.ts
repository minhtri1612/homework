// Public pages for browsing by grade: /lop/:grade and /lop/:grade/:section.
import type { Request, Response } from 'express';
import { listGradeHomeworks } from '../services/homework.service.ts';
import { isClosed } from '../services/submission.service.ts';
import { gradeName, SECTIONS } from '../catalog.ts';
import { gradeParam, sectionParam } from '../validation/browse.schema.ts';

function notFound(res: Response) {
  res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang này không tồn tại.' });
}

export function getGradePage(req: Request, res: Response) {
  const grade = gradeParam.parse(req.params.grade);
  if (grade === null) return notFound(res);
  res.render('grade', { title: gradeName(grade), grade, sections: SECTIONS });
}

export async function getSectionPage(req: Request, res: Response) {
  const grade = gradeParam.parse(req.params.grade);
  const section = sectionParam.parse(req.params.section);
  if (grade === null || section === null) return notFound(res);
  const homeworks =
    section.kind === 'homework'
      ? (await listGradeHomeworks(req.prisma, grade)).map((homework) => ({ ...homework, closed: isClosed(homework.deadline) }))
      : [];
  res.render('section', { title: `${section.name} · ${gradeName(grade)}`, grade, section, homeworks });
}
