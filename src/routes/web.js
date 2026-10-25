// Every page of the site: path → middleware → controller.
import { Router } from 'express';
import { requireTeacher } from '../middleware/auth.js';
import { getHomePage } from '../controllers/home.controller.js';
import { getRegisterPage, postRegister, getLoginPage, postLogin, postLogout } from '../controllers/auth.controller.js';
import {
  setSiteUrl,
  getDashboardPage,
  getNewHomeworkPage,
  postCreateHomework,
  getEditHomeworkPage,
  postUpdateHomework,
} from '../controllers/homework.controller.js';
import { getJoin, getSharedHomework } from '../controllers/share.controller.js';

export function webRoutes() {
  const router = Router();

  router.get('/', getHomePage);

  // Teacher accounts
  router.get('/register', getRegisterPage);
  router.post('/register', postRegister);
  router.get('/login', getLoginPage);
  router.post('/login', postLogin);
  router.post('/logout', postLogout);

  // Teacher pages: everything under /teacher needs a login
  router.use('/teacher', requireTeacher, setSiteUrl);
  router.get('/teacher', getDashboardPage);
  router.get('/teacher/homeworks/new', getNewHomeworkPage);
  router.post('/teacher/homeworks', postCreateHomework);
  router.get('/teacher/homeworks/:id/edit', getEditHomeworkPage);
  router.post('/teacher/homeworks/:id', postUpdateHomework);

  // Students (no account)
  router.get('/join', getJoin);
  router.get('/h/:code', getSharedHomework);

  return router;
}
