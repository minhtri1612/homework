// Pages for logged-in teachers.
import { Router } from 'express';
import { requireTeacher } from '../auth/middleware.js';
import { listHomeworks } from '../db/homeworks.js';

export function teacherRoutes(db) {
  const router = Router();
  router.use('/teacher', requireTeacher);

  router.get('/teacher', async (req, res) => {
    const homeworks = await listHomeworks(db, req.teacher.id);
    res.render('dashboard', { title: 'Bài tập của tôi', homeworks });
  });

  return router;
}
