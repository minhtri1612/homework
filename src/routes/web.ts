// Every page of the site: path → middleware → controller.
import { Router } from 'express';
import { requireTeacher } from '../middleware/auth.ts';
import { getHomePage } from '../controllers/home.controller.ts';
import { getRegisterPage, postRegister, getLoginPage, postLogin, postLogout } from '../controllers/auth.controller.ts';
import {
  setSiteUrl,
  getDashboardPage,
  getNewHomeworkPage,
  postCreateHomework,
  getEditHomeworkPage,
  postUpdateHomework,
} from '../controllers/homework.controller.ts';
import {
  getResultsPage,
  getResultsCsv,
  getDeleteSubmissionPage,
  postDeleteSubmission,
  getDeleteHomeworkPage,
  postDeleteHomework,
  getResetAttemptPage,
  postResetAttempt,
} from '../controllers/results.controller.ts';
import { getJoin, getSharedHomework, postStart, getAnswerPage, postAway, postSubmit, getResultPage } from '../controllers/share.controller.ts';

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
  router.get('/teacher/homeworks/:id/results', getResultsPage);
  router.get('/teacher/homeworks/:id/results.csv', getResultsCsv);
  router.get('/teacher/homeworks/:id/submissions/:submissionId/delete', getDeleteSubmissionPage);
  router.post('/teacher/homeworks/:id/submissions/:submissionId/delete', postDeleteSubmission);
  router.get('/teacher/homeworks/:id/attempts/:studentKey/reset', getResetAttemptPage);
  router.post('/teacher/homeworks/:id/attempts/:studentKey/reset', postResetAttempt);
  router.get('/teacher/homeworks/:id/delete', getDeleteHomeworkPage);
  router.post('/teacher/homeworks/:id/delete', postDeleteHomework);

  // Students (no account)
  router.get('/join', getJoin);
  router.get('/h/:code', getSharedHomework);
  router.post('/h/:code/start', postStart);
  router.get('/h/:code/answer', getAnswerPage);
  router.post('/h/:code/away', postAway);
  router.post('/h/:code/submit', postSubmit);
  router.get('/h/:code/result/:token', getResultPage);

  return router;
}
