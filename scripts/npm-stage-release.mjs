import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha256 = data => createHash('sha256').update(data).digest('hex');
const digest = (data, algorithm, encoding = 'hex') => createHash(algorithm).update(data).digest(encoding);
const allowedCodes = new Set(['E400', 'E401', 'E403', 'E404', 'E409', 'E413', 'E422', 'EOTP', 'ENEEDAUTH', 'EPUBLISHCONFLICT', 'E_STAGE_REQUIRED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EJSONPARSE', 'EUSAGE']);

export function assertManifest(value) {
  if (value?.name !== 'cosmemilton-acbr-printer-node' || !/^\d+\.\d+\.\d+$/.test(value.version ?? '') ||
      value.file !== `${value.name}-${value.version}.tgz` || !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') ||
      !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > 100 * 1024 * 1024 ||
      !/^[a-f0-9]{40}$/.test(value.sourceCommit ?? '') || value.npmAccount !== 'miltoncosme') {
    throw Error('Manifesto de release revisada inválido.');
  }
  return value;
}

function json(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8 * 1024 * 1024) throw Error('JSON npm inválido.');
  try { return JSON.parse(text); } catch { throw Error('JSON npm inválido.'); }
}

export function safeDiagnostic(result) {
  let code;
  try { code = json(result.stdout)?.error?.code; } catch {}
  code ??= /(?:^|\n)npm (?:ERR!|error) code ([A-Z0-9_]+)(?:\r?\n|$)/.exec(result.stderr ?? '')?.[1];
  return { exitCode: Number.isInteger(result.code) ? result.code : null, ...(allowedCodes.has(code) ? { errorCode: code } : {}) };
}

export async function run(command, args, { cwd = process.cwd(), allowFailure = false } = {}) {
  // Capture rather than echo npm output: error responses can contain auth links.
  const executable = command === 'npm' && process.platform === 'win32' ? process.execPath : command;
  const argv = command === 'npm' && process.platform === 'win32'
    ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args] : args;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', length = 0, oversized = false;
    const collect = key => chunk => {
      length += chunk.length;
      if (length > 8 * 1024 * 1024) { oversized = true; child.kill(); return; }
      if (key === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', () => reject(Error('Não foi possível executar o comando da release.')));
    child.on('close', code => oversized ? reject(Error('Saída do comando excedeu o limite.')) : resolve({ code, stdout, stderr }));
  });
  if (result.code !== 0 && !allowFailure) {
    const failure = Error(`Comando da release falhou (${JSON.stringify(safeDiagnostic(result))}).`);
    failure.npmDiagnostic = safeDiagnostic(result);
    throw failure;
  }
  return result;
}

export function assertRegistryMatches(dist, data) {
  if ((!dist?.integrity && !dist?.shasum) ||
      (dist.integrity && dist.integrity !== `sha512-${digest(data, 'sha512', 'base64')}`) ||
      (dist.shasum && dist.shasum !== digest(data, 'sha1'))) throw Error('Versão npm existente diverge dos bytes revisados.');
}

export async function registryDist(entry) {
  const response = await fetch(`${registry}/${encodeURIComponent(entry.name)}/${entry.version}`, {
    redirect: 'error', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw Error('Consulta pública npm falhou.');
  const metadata = await response.json();
  if (metadata.name !== entry.name || metadata.version !== entry.version || !metadata.dist) throw Error('Identidade pública npm inválida.');
  return metadata.dist;
}

function assertStage(stage, entry) {
  if (!uuid.test(stage?.id ?? '') || stage.packageName !== entry.name || stage.version !== entry.version ||
      stage.tag !== 'latest' || (stage.access !== undefined && stage.access !== 'public')) throw Error('Identidade/política do staging diverge da revisão.');
  assertRegistryMatches({ shasum: stage.shasum }, entry.data);
}

export async function stagedArtifact(entry, { npm = run } = {}) {
  const args = ['--json', '--registry', registry, '--loglevel', 'error'];
  const listed = await npm('npm', ['stage', 'list', entry.name, ...args], { allowFailure: true });
  if (listed.code !== 0) {
    const diagnostic = safeDiagnostic(listed);
    // A new package can be absent before its first staging creates a placeholder.
    if (diagnostic.errorCode === 'E404') return null;
    const failure = Error('Consulta de staging npm falhou.');
    failure.npmDiagnostic = diagnostic;
    throw failure;
  }
  const list = json(listed.stdout);
  if (!Array.isArray(list)) throw Error('Lista de staging inválida.');
  const matches = list.filter(item => item.packageName === entry.name && item.version === entry.version);
  if (!matches.length) return null;
  if (matches.length !== 1) throw Error('Múltiplos stagings para a versão revisada.');
  const stage = matches[0];
  assertStage(stage, entry);
  const details = json((await npm('npm', ['stage', 'view', stage.id, ...args])).stdout);
  assertStage(details, entry);
  if (details.id !== stage.id) throw Error('Identificador de staging mudou.');
  const temporary = await mkdtemp(path.join(tmpdir(), 'acbr-printer-stage-'));
  try {
    await npm('npm', ['stage', 'download', stage.id, ...args], { cwd: temporary });
    const filename = `${entry.name}-${entry.version}-${stage.id}.tgz`;
    const files = await readdir(temporary, { withFileTypes: true });
    if (files.length !== 1 || !files[0].isFile() || files[0].name !== filename ||
        !(await readFile(path.join(temporary, filename))).equals(entry.data)) throw Error('Bytes do staging divergem da revisão.');
    return { stageId: stage.id, stagedBytesMatchApproved: true };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function stageReviewed(entry, {
  npm = run, lookup = registryDist,
  stageLookup = current => stagedArtifact(current, { npm }),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onProgress = async () => {}, confirmationAttempts = 90,
} = {}) {
  const outcome = { name: entry.name, version: entry.version, sha256: entry.sha256, bytes: entry.bytes,
    status: 'preflight', accountPackagesUrl: `https://www.npmjs.com/settings/${entry.npmAccount}/packages` };
  const check = async () => {
    const dist = await lookup(entry);
    if (dist) { assertRegistryMatches(dist, entry.data); return { status: 'already-published' }; }
    const pending = await stageLookup(entry);
    return pending ? { status: 'awaiting-approval', ...pending } : null;
  };
  let phase = 'authentication', diagnostic;
  try {
    const identity = (await npm('npm', ['whoami', '--registry', registry, '--loglevel', 'error'])).stdout.trim();
    if (identity !== entry.npmAccount) throw Error('Conta npm autenticada difere da conta revisada.');
    phase = 'preflight';
    const existing = await check();
    if (existing) return { ...outcome, ...existing };
    phase = 'staging';
    outcome.status = 'submission-unconfirmed';
    await onProgress(outcome);
    // Exactly one submission. No fallback to npm publish and no POST retries.
    const result = await npm('npm', ['stage', 'publish', entry.tarball, '--access', 'public', '--tag', 'latest',
      '--ignore-scripts', '--dry-run=false', '--provenance=false', '--json', '--registry', registry,
      '--loglevel', 'error', '--fetch-retries=0'], { allowFailure: true });
    diagnostic = safeDiagnostic(result);
    // Local tarball metadata is not a publication receipt. Verify registry state.
    let candidate;
    try {
      const receipt = json(result.stdout)?.[entry.name];
      if (receipt && receipt.name === entry.name && receipt.version === entry.version &&
          receipt.size === entry.bytes && receipt.shasum === digest(entry.data, 'sha1') &&
          receipt.integrity === `sha512-${digest(entry.data, 'sha512', 'base64')}` && uuid.test(receipt.stageId ?? '')) candidate = receipt.stageId;
    } catch {}
    phase = 'confirmation';
    for (let attempt = 0; attempt < (result.code === 0 ? confirmationAttempts : 3); attempt++) {
      if (attempt) await pause(Math.min(attempt * 1000, 10000));
      const confirmed = await check();
      if (confirmed) {
        if (candidate && confirmed.stageId && candidate !== confirmed.stageId) throw Error('Staging retornado diverge do staging conferido.');
        return { ...outcome, ...confirmed, npmDiagnostic: diagnostic };
      }
    }
    throw Error('Submissão sem confirmação.');
  } catch (error) {
    diagnostic ??= error.npmDiagnostic;
    const failure = Error(`Release bloqueada na etapa ${phase}; consulte o resultado sanitizado antes de reenviar.`);
    failure.publicationResult = { ...outcome, status: ['staging', 'confirmation'].includes(phase) ? 'submission-unconfirmed' : 'blocked', phase,
      ...(diagnostic ? { npmDiagnostic: diagnostic } : {}) };
    throw failure;
  }
}

async function save(directory, result) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'PUBLICATION_RESULT.json'), JSON.stringify(result, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `npm: **${result.status}** — ${result.name}@${result.version}\n\n${result.stageId ? `Stage ID: \`${result.stageId}\`\n\n` : ''}[Abrir conta npm](${result.accountPackagesUrl}) → Staged Packages.\n`);
}

async function main() {
  const [mode, tarball, manifestFile, directory] = process.argv.slice(2);
  if (!['--audit', '--dry-run', '--stage'].includes(mode) || !tarball || !manifestFile || !directory) {
    throw Error('Use --audit|--dry-run|--stage TARBALL MANIFEST RESULT_DIRECTORY.');
  }
  const manifest = assertManifest(json(await readFile(manifestFile, 'utf8')));
  const data = await readFile(tarball);
  if (path.basename(tarball) !== manifest.file || data.length !== manifest.bytes || sha256(data) !== manifest.sha256) throw Error('Tarball difere dos bytes revisados.');
  const auditScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audit-reviewed-tarball.py');
  await run(process.platform === 'win32' ? 'python' : 'python3', [auditScript, path.resolve(tarball), path.resolve(manifestFile)]);
  const entry = { ...manifest, data, tarball: path.resolve(tarball) };
  if (mode === '--audit') { console.log(`Tarball revisado conferido: ${manifest.name}@${manifest.version}.`); return; }
  if (mode === '--dry-run') {
    await run('npm', ['stage', 'publish', entry.tarball, '--dry-run', '--access', 'public', '--tag', 'latest', '--ignore-scripts', '--json', '--registry', registry, '--loglevel', 'error']);
    console.log('Dry run de staging conferido; nenhum envio executado.');
    return;
  }
  try {
    const result = await stageReviewed(entry, { onProgress: result => save(directory, result) });
    await save(directory, result);
    console.log(`Resultado npm: ${result.status}${result.stageId ? `; stage ${result.stageId}` : ''}.`);
  } catch (error) {
    if (error.publicationResult) await save(directory, error.publicationResult);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('Operação da release falhou. Consulte PUBLICATION_RESULT.json quando disponível.');
  process.exitCode = 1;
});
