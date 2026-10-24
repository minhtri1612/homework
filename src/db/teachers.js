import { hashPassword } from '../auth/password.js';

/** Creates a teacher and returns its id. Fails if the email is taken (any letter case). */
export async function createTeacher(db, { email, name, password }) {
  const result = await db.execute({
    sql: 'INSERT INTO teachers (email, name, password_hash) VALUES (?, ?, ?) RETURNING id',
    args: [email.trim().toLowerCase(), name.normalize('NFC').trim(), await hashPassword(password)],
  });
  return result.rows[0].id;
}

/** Returns { id, email, name, passwordHash } or null. Email is matched in any letter case. */
export async function findTeacherByEmail(db, email) {
  const result = await db.execute({
    sql: 'SELECT id, email, name, password_hash FROM teachers WHERE email = ?',
    args: [String(email).trim().toLowerCase()],
  });
  const row = result.rows[0];
  return row ? { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash } : null;
}
