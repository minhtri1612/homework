// Teacher register / login / logout pages.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { createTeacher, findTeacherByEmail } from '../services/teacher.service.ts';
import { createSession, deleteSession } from '../services/session.service.ts';
import { hashPassword, verifyPassword } from '../services/password.service.ts';
import { COOKIE_NAME, sessionCookieOptions } from '../middleware/auth.ts';
import { isUniqueViolation } from '../config/client.ts';
import { registerForm, registerSchema, loginSchema, type RegisterForm } from '../validation/auth.schema.ts';
import { fieldErrors } from '../validation/form.ts';

const EMAIL_TAKEN = 'Email này đã được đăng ký. Hãy đăng nhập.';
const INVITE_MISSING = 'Hãy nhập mã mời. Trang này chỉ dành cho giáo viên được mời.';
const INVITE_WRONG = 'Mã mời không đúng. Hãy hỏi người quản lý trang web để lấy đúng mã mời.';

/** Compares in constant time (both sides hashed to the same length), so timing reveals nothing about the code. */
function sameInvite(given: string, expected: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text.normalize('NFC')).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** The invite problem, or null when the code is right or none is required. */
function inviteError(req: Request, given: string): string | null {
  if (req.inviteCode === null) return null;
  if (!given) return INVITE_MISSING;
  return sameInvite(given, req.inviteCode) ? null : INVITE_WRONG;
}

// Checked when the email is unknown, so a wrong email takes as long as a
// wrong password and the response time does not reveal which emails exist.
let dummyHash: string | undefined;

async function logIn(req: Request, res: Response, teacherId: number) {
  const { token } = await createSession(req.prisma, teacherId);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.redirect('/teacher');
}

// The invite code is never sent back to the page, like the passwords.
function renderRegister(req: Request, res: Response, { values, errors }: { values: RegisterForm; errors: Record<string, string> }) {
  res.status(400).render('register', {
    title: 'Đăng ký',
    values: { name: values.name, email: values.email },
    errors,
    needsInvite: req.inviteCode !== null,
  });
}

export function getRegisterPage(req: Request, res: Response) {
  if (req.teacher) return res.redirect('/teacher');
  res.render('register', { title: 'Đăng ký', values: {}, errors: {}, needsInvite: req.inviteCode !== null });
}

export async function postRegister(req: Request, res: Response) {
  const result = registerSchema.safeParse(req.body);
  const values = result.success ? result.data : registerForm.parse(req.body);
  const errors: Record<string, string> = result.success ? {} : fieldErrors(result.error);
  const invite = inviteError(req, values.invite);
  if (invite) errors.invite = invite;

  // Only with a valid invite: otherwise this form would tell strangers which emails are registered.
  if (!errors.email && !errors.invite && (await findTeacherByEmail(req.prisma, values.email))) errors.email = EMAIL_TAKEN;
  if (Object.keys(errors).length) return renderRegister(req, res, { values, errors });

  let teacherId;
  try {
    teacherId = await createTeacher(req.prisma, values);
  } catch (error) {
    // Someone registered the same email a moment ago.
    if (!isUniqueViolation(error)) throw error;
    return renderRegister(req, res, { values, errors: { email: EMAIL_TAKEN } });
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
