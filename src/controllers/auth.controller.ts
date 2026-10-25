// Teacher register / login / logout pages.
import type { Request, Response } from 'express';
import { createTeacher, findTeacherByEmail } from '../services/teacher.service.ts';
import { createSession, deleteSession } from '../services/session.service.ts';
import { hashPassword, verifyPassword } from '../services/password.service.ts';
import { COOKIE_NAME, sessionCookieOptions } from '../middleware/auth.ts';
import { isUniqueViolation } from '../config/client.ts';
import { registerForm, registerSchema, loginSchema, type RegisterForm } from '../validation/auth.schema.ts';
import { fieldErrors } from '../validation/form.ts';

const EMAIL_TAKEN = 'Email này đã được đăng ký. Hãy đăng nhập.';

// Checked when the email is unknown, so a wrong email takes as long as a
// wrong password and the response time does not reveal which emails exist.
let dummyHash: string | undefined;

async function logIn(req: Request, res: Response, teacherId: number) {
  const { token } = await createSession(req.prisma, teacherId);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.redirect('/teacher');
}

function renderRegister(res: Response, { values, errors }: { values: RegisterForm; errors: Record<string, string> }) {
  res.status(400).render('register', { title: 'Đăng ký', values: { name: values.name, email: values.email }, errors });
}

export function getRegisterPage(req: Request, res: Response) {
  if (req.teacher) return res.redirect('/teacher');
  res.render('register', { title: 'Đăng ký', values: {}, errors: {} });
}

export async function postRegister(req: Request, res: Response) {
  const result = registerSchema.safeParse(req.body);
  const values = result.success ? result.data : registerForm.parse(req.body);
  const errors: Record<string, string> = result.success ? {} : fieldErrors(result.error);

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

export function getLoginPage(req: Request, res: Response) {
  if (req.teacher) return res.redirect('/teacher');
  res.render('login', { title: 'Đăng nhập', values: {}, error: null });
}

export async function postLogin(req: Request, res: Response) {
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

export async function postLogout(req: Request, res: Response) {
  if (req.sessionToken) await deleteSession(req.prisma, req.sessionToken);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.redirect('/');
}
