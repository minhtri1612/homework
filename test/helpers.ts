// Shared by the tests that run the real app on a random port with a fresh
// database file (never data/local.db). The app uses prisma; db is a plain
// libSQL connection to the same file, for tests that check rows with SQL.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { applyMigrations } from '../src/config/migrate.ts';
import { createPrisma, openDb } from '../src/config/client.ts';
import { createApp } from '../src/app.ts';

export async function startApp() {
  const dir = mkdtempSync(join(tmpdir(), 'homework-test-'));
  const url = `file:${join(dir, 'test.db')}`;
  const db = openDb({ url });
  await applyMigrations(db);
  const prisma = createPrisma({ url });
  const server = createApp({ prisma }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  return {
    db,
    prisma,
    base,
    get(path: string, cookie?: string | null): Promise<Response> {
      return fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    },
    post(
      path: string,
      fields: Record<string, string>,
      { cookie, origin = base }: { cookie?: string | null; origin?: string } = {},
    ): Promise<Response> {
      return fetch(base + path, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin, ...(cookie ? { cookie } : {}) },
        body: new URLSearchParams(fields),
      });
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await prisma.$disconnect();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The "sid=…" part of the response's session cookie, or null. */
export function sessionCookie(response: Response): string | null {
  const header = response.headers.getSetCookie().find((c) => c.startsWith('sid='));
  return header ? header.split(';')[0] : null;
}

export type TestApp = Awaited<ReturnType<typeof startApp>>;
