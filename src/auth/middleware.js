import { findSessionTeacher, SESSION_DAYS } from '../db/sessions.js';

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
export function loadTeacher(db) {
  return async (req, res, next) => {
    req.sessionToken = readCookie(req, COOKIE_NAME);
    req.teacher = req.sessionToken ? await findSessionTeacher(db, req.sessionToken) : null;
    if (req.sessionToken && !req.teacher) res.clearCookie(COOKIE_NAME, { path: '/' });
    res.locals.teacher = req.teacher;
    next();
  };
}

/** Sends visitors who are not logged in to the login page. */
export function requireTeacher(req, res, next) {
  if (req.teacher) return next();
  res.redirect('/login');
}

/**
 * Rejects form posts coming from another website. Browsers send an Origin
 * header with every POST; it must match the site the form was posted to.
 */
export function sameOriginPosts(req, res, next) {
  if (req.method !== 'POST') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host === req.get('host')) return next();
  res.status(403).render('error', { title: 'Không được phép', message: 'Yêu cầu này đến từ một trang web khác nên đã bị chặn.' });
}
