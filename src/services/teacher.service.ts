import type { PrismaClient } from '../generated/prisma/client.ts';
import { hashPassword } from './password.service.ts';

export interface NewTeacher {
  email: string;
  name: string;
  password: string;
}

/** Creates a teacher and returns its id. Fails if the email is taken (any letter case). */
export async function createTeacher(prisma: PrismaClient, { email, name, password }: NewTeacher): Promise<number> {
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
export async function findTeacherByEmail(prisma: PrismaClient, email: string) {
  return prisma.teacher.findUnique({
    where: { email: String(email).trim().toLowerCase() },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
}
