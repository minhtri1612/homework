import { hashPassword } from './password.service.js';

/** Creates a teacher and returns its id. Fails if the email is taken (any letter case). */
export async function createTeacher(prisma, { email, name, password }) {
  const teacher = await prisma.teacher.create({
    data: {
      email: email.trim().toLowerCase(),
      name: name.normalize('NFC').trim(),
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    },
    select: { id: true },
  });
  return teacher.id;
}

/** Returns { id, email, name, passwordHash } or null. Email is matched in any letter case. */
export async function findTeacherByEmail(prisma, email) {
  return prisma.teacher.findUnique({
    where: { email: String(email).trim().toLowerCase() },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
}
