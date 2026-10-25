// Teacher login state: the session cookie and the pages that need a login.
import { findSessionTeacher, SESSION_DAYS } from '../services/session.service.ts';

export const COOKIE_NAME = 'sid';

export function sessionCookieOptions() {
  return {
    httpOnly: true, // page JavaScript cannot read it
    sameSite: 'lax', // not sent with forms posted from other websites
    secure: process.env.NODE_ENV === 'production', // HTTPS only once deployed
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Sets req.teacher and res.locals.teacher (null when not logged in). */
export async function loadTeacher(req, res, next) {
  req.sessionToken = readCookie(req, COOKIE_NAME);
  req.teacher = req.sessionToken ? await findSessionTeacher(req.prisma, req.sessionToken) : null;
  if (req.sessionToken && !req.teacher) res.clearCookie(COOKIE_NAME, { path: '/' });
  res.locals.teacher = req.teacher;
  next();
}

/** Sends visitors who are not logged in to the login page. */
export function requireTeacher(req, res, next) {
  if (req.teacher) return next();
  res.redirect('/login');
}
