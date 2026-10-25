// Login sessions. The browser keeps a random token in a cookie; the database
// only keeps its SHA-256 hash, so a copy of the database cannot be used to log in.
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.ts';

export const SESSION_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session and returns { token, expiresAt } for the cookie. */
export async function createSession(prisma: PrismaClient, teacherId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { expiresAt: { lte: now.toISOString() } } }),
    prisma.session.create({
      data: { id: hashToken(token), teacherId, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() },
    }),
  ]);
  return { token, expiresAt };
}

/** Returns the logged-in teacher { id, email, name } for a token, or null if unknown or expired. */
export async function findSessionTeacher(prisma: PrismaClient, token: string) {
  const session = await prisma.session.findFirst({
    where: { id: hashToken(token), expiresAt: { gt: new Date().toISOString() } },
    select: { teacher: { select: { id: true, email: true, name: true } } },
  });
  return session?.teacher ?? null;
}

export async function deleteSession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
