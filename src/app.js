// Builds the web app. Kept apart from server.js so tests can start it with
// their own database.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { loadTeacher, sameOriginPosts } from './auth/middleware.js';
import { authRoutes } from './routes/auth.js';
import { teacherRoutes } from './routes/teacher.js';

const DATE_FORMAT = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short' });

export function createApp({ db }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render's proxy, so req.secure sees HTTPS
  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('./views', import.meta.url)));
  app.locals.formatDate = (iso) => DATE_FORMAT.format(new Date(iso));

  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
  app.use(express.urlencoded({ extended: false }));
  app.use(loadTeacher(db));
  app.use(sameOriginPosts);

  app.get('/', (req, res) => res.render('home', { title: 'Bài tập trắc nghiệm' }));
  app.use(authRoutes(db));
  app.use(teacherRoutes(db));

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
