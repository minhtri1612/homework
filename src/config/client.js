// Creates the Prisma client the app queries with. Locally the database is a
// file (data/local.db); in production DATABASE_URL points at Turso instead.
// The same libSQL adapter talks to both, so the services do not care which.
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '../generated/prisma/client.ts';
import { DEFAULT_URL } from '../db/client.js';

export function createPrisma({
  url = process.env.DATABASE_URL || DEFAULT_URL,
  authToken = process.env.DATABASE_AUTH_TOKEN,
} = {}) {
  return new PrismaClient({ adapter: new PrismaLibSql({ url, authToken }) });
}

/** True for "the row would break a UNIQUE constraint" (Prisma error P2002). */
export function isUniqueViolation(error) {
  return error?.code === 'P2002';
}
