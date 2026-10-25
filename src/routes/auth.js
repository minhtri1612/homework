// Teacher register / login / logout pages.
import { Router } from 'express';
import { createTeacher, findTeacherByEmail } from '../services/teacher.service.js';
import { createSession, deleteSession } from '../services/session.service.js';
import { hashPassword, verifyPassword } from '../services/password.service.js';
import { COOKIE_NAME, sessionCookieOptions } from '../auth/middleware.js';
import { isUniqueViolation } from '../config/client.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MIN_PASSWORD = 8;

// Checked when the email is unknown, so a wrong email takes as long as a
// wrong password and the response time does not reveal which emails exist.
let dummyHash;

function validateRegistration({ name, email, password, confirm }) {
  const errors = {};
  if (!name) errors.name = 'Hãy nhập họ tên.';
  else if (name.length > 100) errors.name = 'Họ tên dài quá (tối đa 100 ký tự).';
  if (!EMAIL.test(email) || email.length > 254) errors.email = 'Email không hợp lệ.';
  if (password.length < MIN_PASSWORD) errors.password = `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.`;
  else if (password.length > 200) errors.password = 'Mật khẩu dài quá (tối đa 200 ký tự).';
  else if (password !== confirm) errors.confirm = 'Hai mật khẩu không giống nhau.';
  return errors;
}

async function logIn(prisma, res, teacherId) {
  const { token } = await createSession(prisma, teacherId);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.redirect('/teacher');
}

export function authRoutes(prisma) {
  const router = Router();

  router.get('/register', (req, res) => {
    if (req.teacher) return res.redirect('/teacher');
    res.render('register', { title: 'Đăng ký', values: {}, errors: {} });
  });

  router.post('/register', async (req, res) => {
    const values = {
      name: String(req.body.name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim(),
      email: String(req.body.email ?? '').trim().toLowerCase(),
    };
    const password = String(req.body.password ?? '');
    const errors = validateRegistration({ ...values, password, confirm: String(req.body.confirm ?? '') });

    if (!errors.email && (await findTeacherByEmail(prisma, values.email))) {
      errors.email = 'Email này đã được đăng ký. Hãy đăng nhập.';
    }
    if (Object.keys(errors).length) {
      return res.status(400).render('register', { title: 'Đăng ký', values, errors });
    }

    let teacherId;
    try {
      teacherId = await createTeacher(prisma, { ...values, password });
    } catch (error) {
      // Someone registered the same email a moment ago.
      if (!isUniqueViolation(error)) throw error;
      errors.email = 'Email này đã được đăng ký. Hãy đăng nhập.';
      return res.status(400).render('register', { title: 'Đăng ký', values, errors });
    }
    await logIn(prisma, res, teacherId);
  });

  router.get('/login', (req, res) => {
    if (req.teacher) return res.redirect('/teacher');
    res.render('login', { title: 'Đăng nhập', values: {}, error: null });
  });

  router.post('/login', async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    const teacher = await findTeacherByEmail(prisma, email);
    dummyHash ??= await hashPassword('dummy password');
    const ok = await verifyPassword(password, teacher?.passwordHash ?? dummyHash);

    if (!teacher || !ok) {
      return res.status(400).render('login', {
        title: 'Đăng nhập',
        values: { email },
        error: 'Email hoặc mật khẩu không đúng.',
      });
    }
    // A fresh session on every login; drop the old one if there was one.
    if (req.sessionToken) await deleteSession(prisma, req.sessionToken);
    await logIn(prisma, res, teacher.id);
  });

  router.post('/logout', async (req, res) => {
    if (req.sessionToken) await deleteSession(prisma, req.sessionToken);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.redirect('/');
  });

  return router;
}
