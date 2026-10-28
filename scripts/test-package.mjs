// Local tarball only. No lifecycle scripts, registry download or physical print.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.name, 'cosmemilton-acbr-printer-node');
assert.equal(typeof pkg.version, 'string');
const npmCli = process.env.npm_execpath;
if (!npmCli || !path.isAbsolute(npmCli)) throw new Error('Execute este teste com npm run test:package (npm_execpath é necessário).');
await access(npmCli);
await access(path.join(root, 'dist/index.js'));
await access(path.join(root, 'dist/index.cjs'));
if (process.argv.length !== 2) throw new Error('Este teste empacota e audita somente o pacote local; não recebe outros tarballs.');

const work = await mkdtemp(path.join(tmpdir(), 'acbr-printer-package-'));
const consumer = path.join(work, 'consumer');
const packs = path.join(work, 'tarballs');
const relativeConsumer = path.relative(root, consumer);
if (!path.isAbsolute(relativeConsumer) && relativeConsumer !== '..' && !relativeConsumer.startsWith('..' + path.sep)) {
  throw new Error('O consumidor de teste deve ficar fora do repositório.');
}
await mkdir(consumer);
await mkdir(packs);

function run(executable, args, cwd, name, env = process.env) {
  const result = spawnSync(executable, args, { cwd, env, shell: false, windowsHide: true,
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${name} falhou: ${result.error?.message ?? ''}\n${(result.stderr || result.stdout || '').slice(-12000)}`);
  }
  return result.stdout;
}
function npm(args, cwd, name) { return run(process.execPath, [npmCli, ...args], cwd, name); }
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function contained(directory, name) {
  if (typeof name !== 'string' || !name || path.isAbsolute(name) || name.includes('\\') || name.split('/').includes('..')) {
    throw new Error('Caminho inválido no artefato auditado.');
  }
  const file = path.resolve(directory, name), relative = path.relative(directory, file);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) {
    throw new Error('O artefato contém um caminho fora do diretório permitido.');
  }
  return file;
}

const packed = JSON.parse(npm(['pack', '--json', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--pack-destination', packs], root, 'npm pack'));
assert.equal(packed.length, 1, 'Um único tarball local deve ser produzido.');
const artifact = packed[0];
assert.equal(artifact.name, pkg.name);
assert.equal(artifact.version, pkg.version);
const tarball = contained(packs, artifact.filename);
assert.ok(Array.isArray(artifact.files) && artifact.files.length > 0);
const names = new Set(artifact.files.map(entry => entry.path));
for (const required of ['package.json', 'dist/index.js', 'dist/index.cjs', 'dist/types/src/index.d.ts', 'README.md', 'NOTICE', 'LICENSE']) {
  assert.ok(names.has(required), 'O pacote está incompleto: ' + required);
}
for (const name of names) {
  contained(root, name);
  assert.ok(!/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.git|\.deps|node_modules)(?:\/|$)/i.test(name), 'Arquivo privado/de desenvolvimento indevido: ' + name);
  assert.ok(!/\.(?:pfx|p12|key)$/i.test(name), 'Material de chave privada não deve integrar o tarball.');
}
const digest = await sha256(tarball);
await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'acbr-printer-consumer-offline', private: true, type: 'module' }, null, 2));
npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--omit=dev', '--omit=optional', tarball], consumer, 'npm install offline');

const installed = path.join(consumer, 'node_modules', pkg.name);
const installedPkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
assert.equal(installedPkg.version, pkg.version);
const runtimeAudits = [];
for (const platform of ['linux', 'win32']) {
  for (const base of ['runtime', 'dist/runtime']) {
    const directory = path.join(installed, base, `${platform}-x64`);
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.sourceRevision, 48590);
    assert.equal(manifest.platform, platform);
    assert.equal(manifest.arch, 'x64');
    assert.ok(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files));
    assert.ok(Object.hasOwn(manifest.files, manifest.executable));
    for (const [name, expected] of Object.entries(manifest.files)) {
      const file = contained(directory, name), info = await lstat(file);
      assert.ok(info.isFile() && !info.isSymbolicLink(), 'Arquivo de runtime inválido: ' + name);
      assert.match(expected, /^[a-f0-9]{64}$/);
      assert.equal(await sha256(file), expected, 'Hash divergente no runtime instalado: ' + name);
    }
    runtimeAudits.push({ platform, directory: path.relative(installed, directory), files: Object.keys(manifest.files).length,
      widgetset: manifest.widgetset ?? null, features: manifest.features ?? null });
  }
}
const currentRuntime = runtimeAudits.find(runtime => runtime.platform === process.platform);
if (currentRuntime?.widgetset === 'gtk2' && !process.env.DISPLAY) {
  throw new Error('Runtime Linux GTK2 presente: execute xvfb-run -a npm run test:package ou disponibilize DISPLAY.');
}

const common = `const assert = require('node:assert/strict');
module.exports = async function check(api) {
  assert.equal(typeof api.criarImpressora, 'function');
  assert.equal(typeof api.ErroAcbrImpressora, 'function');
  assert.equal(api.TIPOS_IMPRESSORA.Texto, 0);
  assert.equal(api.TIPOS_IMPRESSORA.EscPosStar, 8);
  assert.throws(() => api.criarImpressora({ tipo: 7 }), api.ErroAcbrImpressora);
  const printer = api.criarImpressora({ tipo: 0 });
  try {
    if (${Boolean(currentRuntime)}) {
      const capabilities = await printer.capacidades();
      assert.equal(capabilities.sucesso, true);
      assert.equal(capabilities.envioIniciado, false);
      assert.equal(capabilities.capacidades.tipoPadrao, 0);
      const bytes = await printer.gerarEscpos('TESTE INSTALACAO OFFLINE\\n');
      assert.equal(bytes.sucesso, true);
      assert.equal(bytes.envioIniciado, false);
      assert.ok(Buffer.isBuffer(bytes.dados) && bytes.dados.includes(Buffer.from('TESTE INSTALACAO OFFLINE')));
      return { runtime: true, capacidades: capabilities.capacidades, bytes: bytes.dados.length };
    }
    return { runtime: false, detalhe: 'Sem runtime da plataforma no tarball; apenas exports e validação da API foram exercitados.' };
  } finally { await printer.fechar(); }
};
`;
await writeFile(path.join(consumer, 'check.cjs'), common);
await writeFile(path.join(consumer, 'esm.mjs'), `import * as api from '${pkg.name}';\nimport check from './check.cjs';\nconsole.log(JSON.stringify({formato:'ESM', ...await check(api)}));\n`);
await writeFile(path.join(consumer, 'commonjs.cjs'), `const api = require('${pkg.name}');\nrequire('./check.cjs')(api).then(result => console.log(JSON.stringify({formato:'CommonJS', ...result}))).catch(error => { console.error(error); process.exitCode=1; });\n`);
// Tests consume the installed tarball without FPC/Lazarus in PATH.
const smokeEnv = { ...process.env, PATH: path.dirname(process.execPath) };
if (process.platform === 'win32') { delete smokeEnv.Path; smokeEnv.PATH += ';' + path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'); }
const esm = run(process.execPath, ['esm.mjs'], consumer, 'Consumidor ESM', smokeEnv).trim();
const commonjs = run(process.execPath, ['commonjs.cjs'], consumer, 'Consumidor CommonJS', smokeEnv).trim();
const audit = { package: pkg.name, version: pkg.version, tarball, sha256: digest, files: names.size,
  consumer, platform: process.platform, arch: process.arch, node: process.version, runtimeAudits,
  esm: JSON.parse(esm), commonjs: JSON.parse(commonjs), physicalPrint: false, network: false, lifecycleScripts: false };
await writeFile(path.join(work, 'audit.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify(audit, null, 2));
console.log('Artefatos e evidência preservados em: ' + work);
