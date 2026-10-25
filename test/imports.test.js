import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The type checker accepts "./form.js" when only form.ts exists, but Node
// does not: it loads exactly the file named. This catches such imports in
// every file, including ones no other test happens to load.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

function sourceFiles(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(js|ts)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${join('src', 'generated')}`));
}

test('every relative import names a file that exists', () => {
  const missing = [];
  for (const file of [...['src', 'scripts', 'test'].flatMap(sourceFiles), join(ROOT, 'prisma.config.js')]) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      if (!existsSync(resolve(dirname(file), specifier))) missing.push(`${relative(ROOT, file)} → ${specifier}`);
    }
  }
  assert.deepEqual(missing, []);
});
