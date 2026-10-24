// Login sessions. The browser keeps a random token in a cookie; the database
// only keeps its SHA-256 hash, so a copy of the database cannot be used to log in.
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_DAYS = 30;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session and returns { token, expiresAt } for the cookie. */
export async function createSession(db, teacherId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.batch(
    [
      { sql: 'DELETE FROM sessions WHERE expires_at <= ?', args: [new Date().toISOString()] },
      {
        sql: 'INSERT INTO sessions (id, teacher_id, expires_at) VALUES (?, ?, ?)',
        args: [hashToken(token), teacherId, expiresAt.toISOString()],
      },
    ],
    'write',
  );
  return { token, expiresAt };
}

/** Returns the logged-in teacher { id, email, name } for a token, or null if unknown or expired. */
export async function findSessionTeacher(db, token) {
  const result = await db.execute({
    sql: `SELECT t.id, t.email, t.name
          FROM sessions s JOIN teachers t ON t.id = s.teacher_id
          WHERE s.id = ? AND s.expires_at > ?`,
    args: [hashToken(token), new Date().toISOString()],
  });
  const row = result.rows[0];
  return row ? { id: row.id, email: row.email, name: row.name } : null;
}

export async function deleteSession(db, token) {
  await db.execute({ sql: 'DELETE FROM sessions WHERE id = ?', args: [hashToken(token)] });
}
