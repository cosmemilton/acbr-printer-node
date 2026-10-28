// Explicit development operation. Installation never downloads or updates sources.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const acbr = JSON.parse(await readFile(join(root, '.deps/acbr-source.lock.json'), 'utf8'));
const files = {};
const fortes = join(root, '.deps/fortes');
async function visit(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else files[relative(fortes, file).split('\\').join('/')] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
}
await visit(join(fortes, 'Source'));
files.LICENSE = createHash('sha256').update(await readFile(join(fortes, 'LICENSE'))).digest('hex');
await writeFile(join(root, 'DEPENDENCIES.lock.json'), JSON.stringify({ formatVersion: 1,
  acbr: { url: acbr.source.url, revision: acbr.source.revision, treeHash: acbr.source.treeHash },
  fortes: { url: 'https://github.com/fortesinformatica/fortesreport-ce', commit: '888e387faca5a691b246a6b493776b8435be59f3', files },
}, null, 2) + '\n');
console.log('Dependências de impressão fixadas por revisão, commit e SHA-256.');
