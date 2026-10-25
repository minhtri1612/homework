// Database connections. Locally the database is a file (data/local.db); in
// production DATABASE_URL points at Turso instead. The rest of the code does
// not know or care which one it is talking to.
//   createPrisma()  the Prisma client the app and the services query with
//   openDb()        a plain libSQL client, for applying migrations and for
//                   tests that check rows with SQL
import { createClient } from '@libsql/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '../generated/prisma/client.ts';

export const DEFAULT_URL = 'file:data/local.db';

export function createPrisma({
  url = process.env.DATABASE_URL || DEFAULT_URL,
  authToken = process.env.DATABASE_AUTH_TOKEN,
} = {}) {
  return new PrismaClient({ adapter: new PrismaLibSql({ url, authToken }) });
}

export function openDb({
  url = process.env.DATABASE_URL || DEFAULT_URL,
  authToken = process.env.DATABASE_AUTH_TOKEN,
} = {}) {
  if (isLocal(url)) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
  return createClient({ url, authToken });
}

export function isLocal(url) {
  return url.startsWith('file:');
}

/** True for "the row would break a UNIQUE constraint" (Prisma error P2002). */
export function isUniqueViolation(error) {
  return error?.code === 'P2002';
}
