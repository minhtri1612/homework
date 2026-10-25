// Builds the web app. Kept apart from server.js so tests can start it with
// their own database (a Prisma client).
import express from 'express';
import { fileURLToPath } from 'node:url';
import { loadTeacher, sameOriginPosts } from './auth/middleware.js';
import { authRoutes } from './routes/auth.js';
import { teacherRoutes } from './routes/teacher.js';
import { studentRoutes } from './routes/student.js';
import { formatVietnamDate, formatVietnamDateTime } from './vietnam-time.js';

export function createApp({ prisma }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render's proxy, so req.secure sees HTTPS
  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('./views', import.meta.url)));
  app.locals.formatDate = formatVietnamDate;
  app.locals.formatDateTime = formatVietnamDateTime;

  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
  // The parser also runs in the browser, for the editor's live preview.
  app.use('/shared', express.static(fileURLToPath(new URL('./shared', import.meta.url))));
  // 1 MB fits 200 long questions; the default 100 KB does not.
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(loadTeacher(prisma));
  app.use(sameOriginPosts);

  app.get('/', (req, res) => res.render('home', { title: 'Bài tập trắc nghiệm', codeInput: '', codeError: null }));
  app.use(authRoutes(prisma));
  app.use(teacherRoutes(prisma));
  app.use(studentRoutes(prisma));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang này không tồn tại.' });
  });
  // Express 5 sends errors thrown in async routes here.
  app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    res.status(500).render('error', { title: 'Có lỗi', message: 'Máy chủ gặp lỗi. Hãy thử lại sau ít phút.' });
  });

  return app;
}
