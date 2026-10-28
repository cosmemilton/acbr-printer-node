// Explicit source preparation. npm installation never downloads Pascal sources.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, copyFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const options = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--verify-only') { options.set(argument, true); continue; }
  if (argument === '--help') {
    console.log('node scripts/prepare-sources.mjs [--acbr-source DIR] [--fortes-source DIR] [--verify-only]\nSem opções, obtém as fontes oficiais fixadas. Caminhos locais são copiados somente após verificar os hashes. Fontes já preparadas são verificadas, nunca sobrescritas.');
    process.exit(0);
  }
  if (!['--acbr-source', '--fortes-source'].includes(argument) || !process.argv[index + 1] || options.has(argument)) {
    throw Error('Opção desconhecida, repetida ou incompleta: ' + argument);
  }
  options.set(argument, resolve(process.argv[++index]));
}
if (options.has('--verify-only') && (options.has('--acbr-source') || options.has('--fortes-source'))) {
  throw Error('--verify-only verifica apenas .deps; não recebe fontes alternativas.');
}
const sourceLockFile = join(root, 'sources/acbr-source.lock.json');
const lock = JSON.parse(await readFile(sourceLockFile, 'utf8'));
const dependencies = JSON.parse(await readFile(join(root, 'DEPENDENCIES.lock.json'), 'utf8'));
const url = 'https://svn.code.sf.net/p/acbr/code/trunk2';
const revision = 48590;
const fortesURL = 'https://github.com/fortesinformatica/fortesreport-ce.git';
const fortesCommit = '888e387faca5a691b246a6b493776b8435be59f3';
const parts = ['Fontes', 'Exemplos/ACBrDFe/Schemas/NFe', 'Doctos/LICENSE.TXT'];
if (lock.formatVersion !== 1 || lock.source?.url !== url || lock.source.revision !== revision ||
    dependencies.acbr?.revision !== revision || dependencies.acbr.treeHash !== lock.source.treeHash ||
    JSON.stringify(lock.source.parts) !== JSON.stringify(parts) || dependencies.fortes?.commit !== fortesCommit) {
  throw Error('Os locks não correspondem às dependências fixadas desta versão.');
}
function confined(directory, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes('\\') || name.split('/').includes('..')) {
    throw Error('Caminho inválido no lock de fontes: ' + name);
  }
  const file = resolve(directory, name), location = relative(directory, file);
  if (!location || isAbsolute(location) || location === '..' || location.startsWith('..' + sep)) throw Error('Fonte fora da pasta esperada.');
  return file;
}
function inventory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw Error('Inventário de fontes ausente.');
  for (const [name, digest] of Object.entries(value)) {
    confined(root, name);
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw Error('Hash inválido no lock: ' + name);
  }
  return value;
}
const acbrFiles = inventory(lock.source.files), fortesFiles = inventory(dependencies.fortes.files);
const hash = content => createHash('sha256').update(content).digest('hex');
const orderedACBr = Object.fromEntries(Object.entries(acbrFiles).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
if (hash(JSON.stringify(orderedACBr)) !== lock.source.treeHash) throw Error('O inventário ACBr não corresponde ao treeHash versionado.');
async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function filesBelow(directory, skipVCS = false) {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipVCS && ['.git', '.svn'].includes(entry.name)) continue;
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Links não são aceitos no snapshot de fontes: ' + file);
    if (entry.isDirectory()) names.push(...await filesBelow(file, skipVCS));
    else if (entry.isFile()) names.push(file);
    else throw Error('Tipo de arquivo não aceito no snapshot: ' + file);
  }
  return names;
}
async function verify(directory, expected, name) {
  const canonical = await realpath(directory);
  for (const [location, digest] of Object.entries(expected)) {
    const file = confined(canonical, location), information = await lstat(file);
    if (!information.isFile() || information.isSymbolicLink()) throw Error(name + ': arquivo inválido: ' + location);
    const resolvedFile = await realpath(file);
    if (resolvedFile !== canonical && !resolvedFile.startsWith(canonical + sep)) throw Error(name + ': link para fora do snapshot.');
    if (hash(await readFile(file)) !== digest) throw Error(name + ': SHA-256 divergente: ' + location);
  }
  // Extra compilation units could shadow a locked unit in the build search path.
  const observed = name === 'ACBr' ? await filesBelow(canonical, true) : await filesBelow(join(canonical, 'Source'));
  for (const file of observed) {
    const location = relative(canonical, file).split(sep).join('/');
    if (!Object.hasOwn(expected, location)) throw Error(name + ': fonte não prevista no lock: ' + location);
  }
  console.log(name + ': ' + Object.keys(expected).length + ' arquivos verificados por SHA-256.');
}
function run(executable, arguments_, cwd = root) {
  const result = spawnSync(executable, arguments_, { cwd, shell: false, windowsHide: true,
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 300_000 });
  if (result.error || result.status !== 0) throw Error(executable + ' falhou: ' + (result.error?.message ?? '') + '\n' + ((result.stderr ?? '') || (result.stdout ?? '')).slice(-8000));
  return (result.stdout ?? '').trim();
}
async function copyLocked(source, target, expected) {
  for (const name of Object.keys(expected)) {
    const destination = confined(target, name);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(confined(source, name), destination);
  }
}
async function copyDirectory(source, target) {
  const files = await filesBelow(source);
  for (const file of files) {
    const destination = join(target, relative(source, file));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(file, destination);
  }
}
const deps = join(root, '.deps'), acbr = join(deps, 'acbr'), fortes = join(deps, 'fortes');
if (options.has('--verify-only')) {
  await verify(acbr, acbrFiles, 'ACBr');
  await verify(fortes, fortesFiles, 'Fortes');
  process.exit(0);
}
await mkdir(deps, { recursive: true });
if (await realpath(deps) !== deps) throw Error('.deps deve ser um diretório local, sem redirecionamento por link.');
const lockFile = join(deps, '.prepare-sources.lock');
const guard = await open(lockFile, 'wx');
const stage = join(deps, '.prepare-sources-' + randomUUID());
try {
  const existingACBr = await exists(acbr), existingFortes = await exists(fortes);
  if (existingACBr) await verify(acbr, acbrFiles, 'ACBr');
  if (existingFortes) await verify(fortes, fortesFiles, 'Fortes');
  await mkdir(stage);
  const stagedACBr = join(stage, 'acbr'), stagedFortes = join(stage, 'fortes');
  if (!existingACBr) {
    const local = options.get('--acbr-source');
    if (local) {
      await verify(local, acbrFiles, 'ACBr');
      await copyLocked(local, stagedACBr, acbrFiles);
    } else {
      for (const part of parts) {
        const destination = confined(stagedACBr, part);
        await mkdir(dirname(destination), { recursive: true });
        console.log('Exportando ACBr r' + revision + ': ' + part);
        run('svn', ['export', '--non-interactive', '--ignore-externals', '--native-eol', 'LF', '-r', String(revision), url + '/' + part + '@' + revision, destination]);
      }
    }
    await verify(stagedACBr, acbrFiles, 'ACBr');
  }
  if (!existingFortes) {
    const local = options.get('--fortes-source');
    if (local) {
      await verify(local, fortesFiles, 'Fortes');
      await copyLocked(local, stagedFortes, fortesFiles);
      await copyDirectory(join(local, 'Packages'), join(stagedFortes, 'Packages'));
    } else {
      console.log('Obtendo FortesReport CE no commit fixado.');
      run('git', ['clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--no-checkout', fortesURL, stagedFortes]);
      run('git', ['-C', stagedFortes, '-c', 'core.autocrlf=false', 'checkout', '--detach', fortesCommit]);
      if (run('git', ['-C', stagedFortes, 'rev-parse', 'HEAD']) !== fortesCommit) throw Error('Commit Fortes inesperado.');
    }
    await verify(stagedFortes, fortesFiles, 'Fortes');
  }
  async function installSnapshot(stagedSource, destination) {
    const actualSource = await realpath(stagedSource), actualStage = await realpath(stage), actualDeps = await realpath(deps);
    const finalDestination = resolve(actualDeps, basename(destination));
    if (dirname(actualSource) !== actualStage || dirname(actualStage) !== actualDeps ||
        dirname(destination) !== actualDeps || finalDestination !== destination) {
      throw Error('Caminhos de instalação fora da área de fontes; movimentação recusada.');
    }
    if (await exists(finalDestination)) throw Error('Outro processo criou o destino de fontes.');
    await rename(actualSource, finalDestination);
  }
  if (!existingACBr) await installSnapshot(stagedACBr, acbr);
  if (!existingFortes) await installSnapshot(stagedFortes, fortes);
  await copyFile(sourceLockFile, join(deps, 'acbr-source.lock.json'));
  console.log('Fontes preparadas. Nenhum compilador, motor fiscal ou impressora foi executado.');
} finally {
  await guard.close();
  // Only this invocation's checked staging directory is removed recursively.
  if (await exists(stage)) {
    const actualStage = await realpath(stage), actualDeps = await realpath(deps);
    if (dirname(actualStage) !== actualDeps || !actualStage.startsWith(actualDeps + sep + '.prepare-sources-')) throw Error('Área de staging divergente; limpeza recusada.');
    await rm(actualStage, { recursive: true, force: true });
  }
  await unlink(lockFile);
}
