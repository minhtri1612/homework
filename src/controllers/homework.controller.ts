// Pages for logged-in teachers: the homework list and the homework editor.
import type { Request, Response, NextFunction } from 'express';
import {
  listHomeworks,
  getHomework,
  createHomework,
  updateHomework,
  setHomeworkGrade,
  HomeworkValidationError,
  type HomeworkError,
  type QuestionInput,
} from '../services/homework.service.ts';
import { currentTeacher } from '../middleware/auth.ts';
import { editorSchema, homeworkIdParam, moveSchema } from '../validation/homework.schema.ts';
import { toVietnamInput } from '../vietnam-time.ts';
import { GRADES, SECTIONS } from '../catalog.ts';

const SAVED_MESSAGES: Record<string, string> = {
  new: 'Đã tạo bài tập.',
  1: 'Đã lưu.',
};

const BAD_FORM = new HomeworkValidationError([{ code: 'BAD_FORM', message: 'Dữ liệu câu hỏi bị hỏng. Hãy tải lại trang.' }]);

/** JSON that is safe to place inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** What the editor page shows: a new homework, a saved one, or what the teacher just sent. */
interface EditorHomework {
  id?: number;
  title: string;
  revealMode: string;
  deadlineInput: string;
  shuffleQuestions: boolean;
  timeLimitInput: string;
  /** '' for "Chưa xếp lớp", otherwise the grade number as text. */
  gradeInput: string;
  questions: QuestionInput[];
}

interface EditorPage {
  status?: number;
  homework: EditorHomework;
  errors?: HomeworkError[];
  saved?: string | null;
}

function renderEditor(res: Response, { status = 200, homework, errors = [], saved = null }: EditorPage) {
  const isNew = homework.id === undefined;
  res.status(status).render('editor', {
    title: isNew ? 'Tạo bài tập' : homework.title || 'Sửa bài tập',
    heading: isNew ? 'Tạo bài tập mới' : 'Sửa bài tập',
    action: isNew ? '/teacher/homeworks' : `/teacher/homeworks/${homework.id}`,
    homework,
    grades: GRADES,
    errors,
    saved,
    initialJson: scriptJson(homework.questions.map(({ text, shuffleAnswers, answers }) => ({
      text,
      shuffleAnswers,
      answers: answers.map(({ text, correct }) => ({ text, correct })),
    }))),
  });
}

/** For the full student links. trust proxy makes req.protocol "https" on Render. */
export function setSiteUrl(req: Request, res: Response, next: NextFunction) {
  res.locals.siteUrl = `${req.protocol}://${req.get('host')}`;
  next();
}

/** The homework in :id; renders 404 and returns null unless this teacher owns it. */
export async function ownHomework(req: Request, res: Response) {
  const id = homeworkIdParam.parse(req.params.id);
  const homework = id === null ? null : await getHomework(req.prisma, id);
  if (homework?.teacherId === currentTeacher(req).id) return homework;
  res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không có bài tập này, hoặc bài tập không phải của bạn.' });
  return null;
}

const DASHBOARD_NOTICES: Record<string, string> = {
  'homework-deleted': 'Đã xoá bài tập.',
  'homework-moved': 'Đã chuyển bài tập.',
};

/** The teacher's homeworks in the same grade → section structure students browse, plus "Chưa xếp lớp". */
export async function getDashboardPage(req: Request, res: Response) {
  const homeworks = await listHomeworks(req.prisma, currentTeacher(req).id);
  const notice = typeof req.query.notice === 'string' ? (DASHBOARD_NOTICES[req.query.notice] ?? null) : null;
  res.render('dashboard', {
    title: 'Bài tập của tôi',
    homeworks,
    unplaced: homeworks.filter((homework) => homework.grade === null),
    grades: GRADES.map((grade) => ({ grade, homeworks: homeworks.filter((homework) => homework.grade === grade) })),
    sections: SECTIONS,
    notice,
  });
}

export async function postMoveHomework(req: Request, res: Response) {
  const homework = await ownHomework(req, res);
  if (!homework) return;
  const { grade } = moveSchema.parse(req.body);
  try {
    if (!(await setHomeworkGrade(req.prisma, { id: homework.id, teacherId: currentTeacher(req).id, grade }))) {
      return res.redirect(303, '/teacher'); // deleted in the meantime
    }
  } catch (error) {
    if (!(error instanceof HomeworkValidationError)) throw error;
    return res.status(400).render('error', { title: 'Chưa chuyển được', message: error.message });
  }
  res.redirect(303, `/teacher?notice=homework-moved#${grade === null ? 'chua-xep-lop' : `lop-${grade}`}`);
}

export function getNewHomeworkPage(req: Request, res: Response) {
  // ?grade=12 (from the dashboard's grade sections) pre-selects that grade.
  const gradeInput = GRADES.map(String).find((grade) => grade === req.query.grade) ?? '';
  renderEditor(res, {
    homework: { title: '', revealMode: 'after_submit', deadlineInput: '', shuffleQuestions: false, timeLimitInput: '', gradeInput, questions: [] },
  });
}

export async function postCreateHomework(req: Request, res: Response) {
  const form = editorSchema.parse(req.body);
  try {
    if (form.unreadable) throw BAD_FORM;
    const { id } = await createHomework(req.prisma, { teacherId: currentTeacher(req).id, ...form });
    res.redirect(`/teacher/homeworks/${id}/edit?saved=new`);
  } catch (error) {
    if (!(error instanceof HomeworkValidationError)) throw error;
    renderEditor(res, { status: 400, homework: form, errors: error.errors });
  }
}

export async function getEditHomeworkPage(req: Request, res: Response) {
  const homework = await ownHomework(req, res);
  if (!homework) return;
  // A repeated ?saved= arrives as an array: no notice then, as before.
  const savedParam = typeof req.query.saved === 'string' ? req.query.saved : '';
  const saved = /^v\d+$/.test(savedParam)
    ? `Đã lưu thành phiên bản ${savedParam.slice(1)}. Bài đã nộp vẫn giữ câu hỏi cũ.`
    : (SAVED_MESSAGES[savedParam] ?? null);
  renderEditor(res, {
    homework: {
      ...homework,
      deadlineInput: toVietnamInput(homework.deadline),
      timeLimitInput: homework.timeLimitMinutes === null ? '' : String(homework.timeLimitMinutes),
      gradeInput: homework.grade === null ? '' : String(homework.grade),
    },
    saved,
  });
}

export async function postUpdateHomework(req: Request, res: Response) {
  const homework = await ownHomework(req, res);
  if (!homework) return;
  const form = editorSchema.parse(req.body);
  try {
    if (form.unreadable) throw BAD_FORM;
    const result = await updateHomework(req.prisma, { id: homework.id, teacherId: currentTeacher(req).id, ...form });
    if (!result) return res.redirect('/teacher'); // deleted in the meantime
    res.redirect(`/teacher/homeworks/${homework.id}/edit?saved=${result.newVersion ? `v${result.version}` : 1}`);
  } catch (error) {
    if (!(error instanceof HomeworkValidationError)) throw error;
    renderEditor(res, {
      status: 400,
      homework: { ...homework, ...form },
      errors: error.errors,
    });
  }
}
