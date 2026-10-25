// Pages for logged-in teachers: the homework list and the homework editor.
import { listHomeworks, getHomework, createHomework, updateHomework, HomeworkValidationError } from '../services/homework.service.js';
import { editorSchema, homeworkIdParam } from '../validation/homework.schema.js';
import { toVietnamInput } from '../vietnam-time.js';

const SAVED_MESSAGES = {
  new: 'Đã tạo bài tập.',
  1: 'Đã lưu.',
};

const BAD_FORM = new HomeworkValidationError([{ code: 'BAD_FORM', message: 'Dữ liệu câu hỏi bị hỏng. Hãy tải lại trang.' }]);

/** JSON that is safe to place inside a <script> element. */
function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderEditor(res, { status = 200, homework, errors = [], saved = null }) {
  const isNew = homework.id === undefined;
  res.status(status).render('editor', {
    title: isNew ? 'Tạo bài tập' : homework.title || 'Sửa bài tập',
    heading: isNew ? 'Tạo bài tập mới' : 'Sửa bài tập',
    action: isNew ? '/teacher/homeworks' : `/teacher/homeworks/${homework.id}`,
    homework,
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
export function setSiteUrl(req, res, next) {
  res.locals.siteUrl = `${req.protocol}://${req.get('host')}`;
  next();
}

/** The homework in :id; renders 404 and returns null unless this teacher owns it. */
async function ownHomework(req, res) {
  const id = homeworkIdParam.parse(req.params.id);
  const homework = id === null ? null : await getHomework(req.prisma, id);
  if (homework?.teacherId === req.teacher.id) return homework;
  res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không có bài tập này, hoặc bài tập không phải của bạn.' });
  return null;
}

export async function getDashboardPage(req, res) {
  const homeworks = await listHomeworks(req.prisma, req.teacher.id);
  res.render('dashboard', { title: 'Bài tập của tôi', homeworks });
}

export function getNewHomeworkPage(req, res) {
  renderEditor(res, {
    homework: { title: '', revealMode: 'after_submit', deadlineInput: '', shuffleQuestions: false, questions: [] },
  });
}

export async function postCreateHomework(req, res) {
  const form = editorSchema.parse(req.body);
  try {
    if (form.unreadable) throw BAD_FORM;
    const { id } = await createHomework(req.prisma, { teacherId: req.teacher.id, ...form });
    res.redirect(`/teacher/homeworks/${id}/edit?saved=new`);
  } catch (error) {
    if (!(error instanceof HomeworkValidationError)) throw error;
    renderEditor(res, { status: 400, homework: form, errors: error.errors });
  }
}

export async function getEditHomeworkPage(req, res) {
  const homework = await ownHomework(req, res);
  if (!homework) return;
  const saved = /^v\d+$/.test(req.query.saved ?? '')
    ? `Đã lưu thành phiên bản ${req.query.saved.slice(1)}. Bài đã nộp vẫn giữ câu hỏi cũ.`
    : (SAVED_MESSAGES[req.query.saved] ?? null);
  renderEditor(res, {
    homework: { ...homework, deadlineInput: toVietnamInput(homework.deadline) },
    saved,
  });
}

export async function postUpdateHomework(req, res) {
  const homework = await ownHomework(req, res);
  if (!homework) return;
  const form = editorSchema.parse(req.body);
  try {
    if (form.unreadable) throw BAD_FORM;
    const result = await updateHomework(req.prisma, { id: homework.id, teacherId: req.teacher.id, ...form });
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
