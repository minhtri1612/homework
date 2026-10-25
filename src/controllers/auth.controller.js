// Teacher register / login / logout pages.
import { createTeacher, findTeacherByEmail } from '../services/teacher.service.js';
import { createSession, deleteSession } from '../services/session.service.js';
import { hashPassword, verifyPassword } from '../services/password.service.js';
import { COOKIE_NAME, sessionCookieOptions } from '../middleware/auth.js';
import { isUniqueViolation } from '../config/client.js';
import { registerForm, registerSchema, loginSchema } from '../validation/auth.schema.js';
import { fieldErrors } from '../validation/form.js';

const EMAIL_TAKEN = 'Email này đã được đăng ký. Hãy đăng nhập.';

// Checked when the email is unknown, so a wrong email takes as long as a
// wrong password and the response time does not reveal which emails exist.
let dummyHash;

async function logIn(req, res, teacherId) {
  const { token } = await createSession(req.prisma, teacherId);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.redirect('/teacher');
}

function renderRegister(res, { values, errors }) {
  res.status(400).render('register', { title: 'Đăng ký', values: { name: values.name, email: values.email }, errors });
}

export function getRegisterPage(req, res) {
  if (req.teacher) return res.redirect('/teacher');
  res.render('register', { title: 'Đăng ký', values: {}, errors: {} });
}

export async function postRegister(req, res) {
  const result = registerSchema.safeParse(req.body);
  const values = result.success ? result.data : registerForm.parse(req.body);
  const errors = result.success ? {} : fieldErrors(result.error);

  if (!errors.email && (await findTeacherByEmail(req.prisma, values.email))) errors.email = EMAIL_TAKEN;
  if (Object.keys(errors).length) return renderRegister(res, { values, errors });

  let teacherId;
  try {
    teacherId = await createTeacher(req.prisma, values);
  } catch (error) {
    // Someone registered the same email a moment ago.
    if (!isUniqueViolation(error)) throw error;
    return renderRegister(res, { values, errors: { email: EMAIL_TAKEN } });
  }
  await logIn(req, res, teacherId);
}

export function getLoginPage(req, res) {
  if (req.teacher) return res.redirect('/teacher');
  res.render('login', { title: 'Đăng nhập', values: {}, error: null });
}

export async function postLogin(req, res) {
  const { email, password } = loginSchema.parse(req.body);
  const teacher = await findTeacherByEmail(req.prisma, email);
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
  if (req.sessionToken) await deleteSession(req.prisma, req.sessionToken);
  await logIn(req, res, teacher.id);
}

export async function postLogout(req, res) {
  if (req.sessionToken) await deleteSession(req.prisma, req.sessionToken);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.redirect('/');
}
