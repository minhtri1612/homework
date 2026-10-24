// Shared by the tests that run the real app on a random port with a fresh
// database file (never data/local.db).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, initSchema } from '../src/db/client.js';
import { createApp } from '../src/app.js';

export async function startApp() {
  const dir = mkdtempSync(join(tmpdir(), 'homework-test-'));
  const db = openDb({ url: `file:${join(dir, 'test.db')}` });
  await initSchema(db);
  const server = createApp({ db }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://localhost:${server.address().port}`;

  return {
    db,
    base,
    get(path, cookie) {
      return fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    },
    post(path, fields, { cookie, origin = base } = {}) {
      return fetch(base + path, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin, ...(cookie && { cookie }) },
        body: new URLSearchParams(fields),
      });
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The "sid=…" part of the response's session cookie, or null. */
export function sessionCookie(response) {
  const header = response.headers.getSetCookie().find((c) => c.startsWith('sid='));
  return header ? header.split(';')[0] : null;
}
