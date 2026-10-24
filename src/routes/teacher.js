// Pages for logged-in teachers: the homework list and the homework editor.
import { Router } from 'express';
import { requireTeacher } from '../auth/middleware.js';
import { listHomeworks, getHomework, createHomework, updateHomework, HomeworkValidationError } from '../db/homeworks.js';
import { fromVietnamInput, toVietnamInput } from '../vietnam-time.js';

const SAVED_MESSAGES = {
  new: 'Đã tạo bài tập.',
  1: 'Đã lưu.',
};

/**
 * Reads the editor form. The cards arrive as JSON in the hidden "questions"
 * field; anything unexpected in it is coerced to the right shape so that
 * validation, not a crash, reports what is wrong.
 */
function readEditorForm(body) {
  let raw;
  try {
    raw = JSON.parse(String(body.questions ?? '[]'));
  } catch {
    raw = null;
  }
  const questions = Array.isArray(raw)
    ? raw.map((q) => ({
        text: String(q?.text ?? ''),
        shuffleAnswers: q?.shuffleAnswers === true,
        answers: Array.isArray(q?.answers)
          ? q.answers.map((a) => ({ text: String(a?.text ?? ''), correct: a?.correct === true }))
          : [],
      }))
    : [];
  return {
    title: String(body.title ?? '').normalize('NFC').replace(/\s+/g, ' ').trim(),
    revealMode: String(body.revealMode ?? 'after_submit'),
    deadline: fromVietnamInput(body.deadline),
    deadlineInput: String(body.deadline ?? ''),
    shuffleQuestions: body.shuffleQuestions === '1',
    questions,
    unreadable: raw === null,
  };
}

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

export function teacherRoutes(db) {
  const router = Router();
  router.use('/teacher', requireTeacher, (req, res, next) => {
    // For the full student links. trust proxy makes req.protocol "https" on Render.
    res.locals.siteUrl = `${req.protocol}://${req.get('host')}`;
    next();
  });

  router.get('/teacher', async (req, res) => {
    const homeworks = await listHomeworks(db, req.teacher.id);
    res.render('dashboard', { title: 'Bài tập của tôi', homeworks });
  });

  router.get('/teacher/homeworks/new', (req, res) => {
    renderEditor(res, {
      homework: { title: '', revealMode: 'after_submit', deadlineInput: '', shuffleQuestions: false, questions: [] },
    });
  });

  router.post('/teacher/homeworks', async (req, res) => {
    const form = readEditorForm(req.body);
    try {
      if (form.unreadable) throw new HomeworkValidationError([{ code: 'BAD_FORM', message: 'Dữ liệu câu hỏi bị hỏng. Hãy tải lại trang.' }]);
      const { id } = await createHomework(db, { teacherId: req.teacher.id, ...form });
      res.redirect(`/teacher/homeworks/${id}/edit?saved=new`);
    } catch (error) {
      if (!(error instanceof HomeworkValidationError)) throw error;
      renderEditor(res, { status: 400, homework: form, errors: error.errors });
    }
  });

  // Loads the homework for the routes below; 404 unless this teacher owns it.
  async function ownHomework(req, res) {
    const id = Number(req.params.id);
    const homework = Number.isSafeInteger(id) ? await getHomework(db, id) : null;
    if (homework?.teacherId === req.teacher.id) return homework;
    res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không có bài tập này, hoặc bài tập không phải của bạn.' });
    return null;
  }

  router.get('/teacher/homeworks/:id/edit', async (req, res) => {
    const homework = await ownHomework(req, res);
    if (!homework) return;
    const saved = /^v\d+$/.test(req.query.saved ?? '')
      ? `Đã lưu thành phiên bản ${req.query.saved.slice(1)}. Bài đã nộp vẫn giữ câu hỏi cũ.`
      : (SAVED_MESSAGES[req.query.saved] ?? null);
    renderEditor(res, {
      homework: { ...homework, deadlineInput: toVietnamInput(homework.deadline) },
      saved,
    });
  });

  router.post('/teacher/homeworks/:id', async (req, res) => {
    const homework = await ownHomework(req, res);
    if (!homework) return;
    const form = readEditorForm(req.body);
    try {
      if (form.unreadable) throw new HomeworkValidationError([{ code: 'BAD_FORM', message: 'Dữ liệu câu hỏi bị hỏng. Hãy tải lại trang.' }]);
      const result = await updateHomework(db, { id: homework.id, teacherId: req.teacher.id, ...form });
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
  });

  return router;
}
