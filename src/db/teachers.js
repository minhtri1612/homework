import { hashPassword } from '../auth/password.js';

/** Creates a teacher and returns its id. Fails if the email is taken (any letter case). */
export async function createTeacher(db, { email, name, password }) {
  const result = await db.execute({
    sql: 'INSERT INTO teachers (email, name, password_hash) VALUES (?, ?, ?) RETURNING id',
    args: [email.trim().toLowerCase(), name.normalize('NFC').trim(), await hashPassword(password)],
  });
  return result.rows[0].id;
}
