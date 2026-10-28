import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const sourceScript = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/prepare-sources.mjs');
const digest = content => createHash('sha256').update(content).digest('hex');
async function file(name, content) { await mkdir(dirname(name), { recursive: true }); await writeFile(name, content); }
async function fixture(t) {
  const work = await mkdtemp(join(tmpdir(), 'acbr-printer-source-fixture-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const root = join(work, 'project'), acbr = join(work, 'acbr'), fortes = join(work, 'fortes');
  const acbrValues = { 'Fontes/unit.pas': 'unit unit;\n', 'Exemplos/ACBrDFe/Schemas/NFe/test.xsd': '<schema/>\n', 'Doctos/LICENSE.TXT': 'ACBr fixture notice\n' };
  const fortesValues = { 'Source/RLReport.pas': 'unit RLReport;\n', LICENSE: 'Fortes fixture notice\n' };
  for (const [name, value] of Object.entries(acbrValues)) await file(join(acbr, name), value);
  for (const [name, value] of Object.entries(fortesValues)) await file(join(fortes, name), value);
  await file(join(fortes, 'Packages/frce.lpk'), '<CONFIG/>\n');
  const source = { url: 'https://svn.code.sf.net/p/acbr/code/trunk2', revision: 48590,
    parts: ['Fontes', 'Exemplos/ACBrDFe/Schemas/NFe', 'Doctos/LICENSE.TXT'],
    files: Object.fromEntries(Object.entries(acbrValues).map(([name, value]) => [name, digest(value)])) };
  source.treeHash = digest(JSON.stringify(Object.fromEntries(Object.entries(source.files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))));
  const dependencies = { acbr: { revision: 48590, treeHash: source.treeHash },
    fortes: { commit: '888e387faca5a691b246a6b493776b8435be59f3',
      files: Object.fromEntries(Object.entries(fortesValues).map(([name, value]) => [name, digest(value)])) } };
  await file(join(root, 'sources/acbr-source.lock.json'), JSON.stringify({ formatVersion: 1, source }));
  await file(join(root, 'DEPENDENCIES.lock.json'), JSON.stringify(dependencies));
  await mkdir(join(root, 'scripts'));
  await copyFile(sourceScript, join(root, 'scripts/prepare-sources.mjs'));
  function run(...args) {
    const result = spawnSync(process.execPath, ['scripts/prepare-sources.mjs', ...args], {
      cwd: root, shell: false, windowsHide: true, encoding: 'utf8', timeout: 15000,
      // No Git/SVN/compiler is available. Local snapshot use must stay offline.
      env: { ...process.env, PATH: '' },
    });
    assert.ifError(result.error);
    return result;
  }
  return { root, acbr, fortes, run };
}

test('source preparation imports local locked snapshots and reuses them without external tools', async t => {
  const { root, acbr, fortes, run } = await fixture(t);
  const lock = await readFile(join(root, 'sources/acbr-source.lock.json'));
  let result = run('--acbr-source', acbr, '--fortes-source', fortes);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(join(root, '.deps/acbr-source.lock.json')), lock);
  assert.equal(await readFile(join(root, '.deps/fortes/Packages/frce.lpk'), 'utf8'), '<CONFIG/>\n');
  const before = (await stat(join(root, '.deps/acbr/Fontes/unit.pas'))).mtimeMs;
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await stat(join(root, '.deps/acbr/Fontes/unit.pas'))).mtimeMs, before);
  result = run('--verify-only');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(join(root, '.deps'))).sort(), ['acbr', 'acbr-source.lock.json', 'fortes']);
});

test('source preparation refuses changed snapshots and removes only its temporary staging', async t => {
  const { root, acbr, fortes, run } = await fixture(t);
  await writeFile(join(acbr, 'Fontes/unit.pas'), 'changed');
  const result = run('--acbr-source', acbr, '--fortes-source', fortes);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256 divergente/);
  assert.deepEqual(await readdir(join(root, '.deps')), []);
  assert.equal(await readFile(join(acbr, 'Fontes/unit.pas'), 'utf8'), 'changed');
});

test('source verification rejects extra units and never overwrites a divergent prepared source', async t => {
  const { root, acbr, fortes, run } = await fixture(t);
  assert.equal(run('--acbr-source', acbr, '--fortes-source', fortes).status, 0);
  const extra = join(root, '.deps/acbr/Fontes/Shadow.pas');
  await writeFile(extra, 'unexpected unit');
  const result = run('--verify-only');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fonte não prevista no lock/);
  assert.equal(await readFile(extra, 'utf8'), 'unexpected unit');
  await rm(extra);
  const prepared = join(root, '.deps/acbr/Fontes/unit.pas');
  await writeFile(prepared, 'preserve this divergent source');
  const retry = run('--acbr-source', acbr, '--fortes-source', fortes);
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /SHA-256 divergente/);
  assert.equal(await readFile(prepared, 'utf8'), 'preserve this divergent source');
  assert.deepEqual((await readdir(join(root, '.deps'))).sort(), ['acbr', 'acbr-source.lock.json', 'fortes']);
});
