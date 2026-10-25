import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, type TestApp } from './helpers.ts';

// The browser runs JavaScript compiled from the TypeScript sources. If that
// build were older than the sources, the editor preview would check questions
// with an old parser while the server saves with the new one. This compiles
// the sources afresh and compares the result with what the site serves.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let app: TestApp;
let fresh: string;

before(async () => {
  fresh = mkdtempSync(join(tmpdir(), 'homework-build-'));
  const build = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.browser.json', '--outDir', fresh], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  app = await startApp();
});

after(async () => {
  await app.close();
  rmSync(fresh, { recursive: true, force: true });
});

for (const [url, file] of [
  ['/shared/parser.js', 'shared/parser.js'],
  ['/js/editor.js', 'public/js/editor.js'],
  ['/js/copy.js', 'public/js/copy.js'],
  ['/js/answer.js', 'public/js/answer.js'],
]) {
  test(`${url} is the current build of its TypeScript source (npm run build:browser)`, async () => {
    const response = await app.get(url!);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /javascript/);
    assert.equal(await response.text(), readFileSync(join(fresh, file!), 'utf8'));
  });
}

test('TypeScript sources are not served', async () => {
  for (const url of ['/shared/parser.ts', '/js/editor.ts', '/js/copy.ts']) {
    assert.equal((await app.get(url)).status, 404, url);
  }
  assert.equal((await app.get('/style.css')).status, 200);
});
