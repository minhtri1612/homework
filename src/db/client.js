// Opens the database. Locally it is a file (data/local.db); in production
// DATABASE_URL points at a hosted libSQL database (Turso) instead. The rest of
// the code does not know or care which one it is talking to.
import { createClient } from '@libsql/client';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_URL = 'file:data/local.db';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// Children before parents, so dropping never breaks a foreign key.
const TABLES = [
  'submission_answers',
  'submissions',
  'answers',
  'questions',
  'homework_versions',
  'homeworks',
  'sessions',
  'teachers',
];

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

/** Creates any missing tables and indexes. */
export async function initSchema(db) {
  await db.executeMultiple(SCHEMA);
}

/** Deletes all tables and their data. */
export async function dropSchema(db) {
  await db.executeMultiple(TABLES.map((table) => `DROP TABLE IF EXISTS ${table};`).join('\n'));
}
