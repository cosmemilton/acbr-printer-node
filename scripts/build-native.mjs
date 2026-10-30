import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--pos-only') { args.set(arg, true); continue; }
  if (arg === '--help') {
    console.log('node scripts/build-native.mjs [--source DIR] [--fortes DIR] [--lazarus DIR] [--fpc FILE] [--widgetset gtk2|nogui|win32] [--libxml2 FILE] [--pos-only]');
    process.exit(0);
  }
  if (!['--source', '--fortes', '--lazarus', '--fpc', '--widgetset', '--libxml2'].includes(arg) || !process.argv[i + 1]) throw Error('Opção desconhecida ou incompleta: ' + arg);
  args.set(arg, process.argv[++i]);
}
if (!['linux', 'win32'].includes(process.platform) || process.arch !== 'x64') throw Error('Build suporta Linux e Windows x64.');
const platform = process.platform;
const posOnly = args.has('--pos-only');
const source = resolve(args.get('--source') ?? join(root, '.deps/acbr'));
const fortes = resolve(args.get('--fortes') ?? join(root, '.deps/fortes'));
const lazarus = await realpath(args.get('--lazarus') ?? process.env.LAZARUS_ROOT ?? (platform === 'linux' ? '/usr/lib/lazarus/default' : 'C:\\lazarus'));
const widgetset = args.get('--widgetset') ?? (platform === 'win32' ? 'win32' : posOnly ? 'nogui' : 'gtk2');
if (!['nogui', 'gtk2', 'win32'].includes(widgetset)) throw Error('Widgetset não suportado.');
if (!posOnly && widgetset === 'nogui') throw Error('Fortes precisa de canvas/fontes. Use gtk2/Win32 ou --pos-only para nogui.');
const fpc = args.get('--fpc') ?? process.env.FPC ?? 'fpc';
const libxml2 = resolve(args.get('--libxml2') ?? join(root, '.deps/windows-libraries/libxml2.dll'));
if (platform === 'win32' && !posOnly) {
  try { await access(libxml2); await access(libxml2 + '.LICENSE'); }
  catch { throw Error('DANFE Windows requer libxml2.dll e licença .LICENSE adjacente. Execute npm run build:libxml2 no WSL ou informe --libxml2 FILE.'); }
}
const target = platform === 'win32' ? 'win64' : 'linux';
const runtime = join(root, 'runtime', platform + '-x64');
const work = join(root, '.build', platform + '-x64-' + widgetset);
const units = join(work, 'units');
await mkdir(units, { recursive: true });
await mkdir(runtime, { recursive: true });
const lock = JSON.parse(await readFile(join(root, '.deps/acbr-source.lock.json'), 'utf8'));
if (lock.source.revision !== 48590) throw Error('Fonte ACBr deve corresponder à revisão 48590.');
const hash = data => createHash('sha256').update(data).digest('hex');
for (const [name, expected] of Object.entries(lock.source.files)) {
  if (hash(await readFile(join(source, name))) !== expected) throw Error('Fonte ACBr alterada: ' + name);
}
if (!posOnly) {
  const dependencies = JSON.parse(await readFile(join(root, 'DEPENDENCIES.lock.json'), 'utf8'));
  if (dependencies.fortes.commit !== '888e387faca5a691b246a6b493776b8435be59f3') throw Error('Commit Fortes não corresponde ao contrato revisado.');
  for (const [name, expected] of Object.entries(dependencies.fortes.files)) {
    if (hash(await readFile(join(fortes, name))) !== expected) throw Error('Fonte Fortes alterada: ' + name);
  }
}
async function directories(path) {
  const paths = [path];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && !['.git', '.svn', '__history', '__recovery'].includes(entry.name)) paths.push(...await directories(join(path, entry.name)));
  }
  return paths;
}
const fonts = await directories(join(source, 'Fontes'));
const fpcUnits = platform === 'win32'
  ? await directories(resolve(dirname(fpc), '../..', 'units', 'x86_64-win64')) : [];
const packagePaths = [
  join(lazarus, 'components/lazutils/lib', 'x86_64-' + target),
  join(lazarus, 'lcl/units', 'x86_64-' + target),
  join(lazarus, 'lcl/units', 'x86_64-' + target, widgetset),
  join(lazarus, 'packager/units', 'x86_64-' + target),
  join(lazarus, 'components/printers/lib', 'x86_64-' + target, widgetset),
  join(lazarus, 'components/cairocanvas/lib', 'x86_64-' + target, widgetset),
  join(lazarus, 'components/printers'),
  join(lazarus, 'components/printers/' + widgetset),
];
const executable = 'acbr-printer-worker' + (platform === 'win32' ? '.exe' : '');
const search = [join(root, 'native'), ...fpcUnits, ...fonts, ...packagePaths, ...(posOnly ? [] : [join(fortes, 'Source')])];
const compilerArgs = [
  '-vew', '-Mdelphi', '-Scghi', '-O2', '-g-',
  ...(posOnly ? [] : ['-dACBR_PRINTER_FORTES', '-dACBR_PRINTER_NFE']),
  ...(widgetset === 'nogui' ? ['-dNOGUI'] : []),
  '-FU' + units, '-FE' + runtime, '-o' + executable,
  ...search.map(path => '-Fu' + path), ...fonts.map(path => '-Fi' + path), ...packagePaths.map(path => '-Fi' + path),
  ...(posOnly ? [] : ['-Fi' + join(fortes, 'Source')]),
];
const response = join(work, 'compiler.rsp');
if (compilerArgs.some(value => /["\r\n]/.test(value))) throw Error('Caminhos do compilador não podem conter aspas ou quebras de linha.');
// FPC reads one argument per response-file line, retaining embedded spaces.
// Quotes would become part of a search path rather than shell escaping.
await writeFile(response, compilerArgs.join('\n') + '\n');
console.log('Compilando Free Pascal: ' + platform + '-x64, ' + widgetset + ', ' + (posOnly ? 'PosPrinter' : 'PosPrinter + Fortes + DANFE'));
const build = spawnSync(fpc, ['@' + response, join(root, 'native/acbr_printer_worker.lpr')], {
  cwd: root, shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000,
});
await writeFile(join(work, 'compiler.log'), (build.stdout ?? '') + (build.stderr ?? '') + (build.error?.message ?? ''));
if (build.status !== 0) throw Error('Falha FPC. Log: ' + join(work, 'compiler.log') + '\n' + ((build.stdout ?? '') + (build.stderr ?? '')).slice(-8000));

await mkdir(join(runtime, 'licenses'), { recursive: true });
await copyFile(join(source, 'Doctos/LICENSE.TXT'), join(runtime, 'licenses/ACBr-LICENSE.txt'));
if (!posOnly) await copyFile(join(fortes, 'LICENSE'), join(runtime, 'licenses/Fortes-LICENSE.txt'));
for (const dependency of ['fpc', 'lazarus']) {
  for (const name of await readdir(join(root, 'docs/licenses', dependency))) {
    const original = join(root, 'docs/licenses', dependency, name);
    if ((await stat(original)).isFile()) await copyFile(original, join(runtime, 'licenses', dependency + '-' + name));
  }
}
if (platform === 'win32' && !posOnly) {
  await mkdir(join(runtime, 'lib'), { recursive: true });
  await copyFile(libxml2, join(runtime, 'lib/libxml2.dll'));
  await copyFile(libxml2 + '.LICENSE', join(runtime, 'licenses/libxml2.dll.LICENSE'));
  for (const name of await readdir(dirname(libxml2))) {
    if (/license|copyright|source\.json/i.test(name)) await copyFile(join(dirname(libxml2), name), join(runtime, 'licenses', name));
  }
}
await mkdir(join(runtime, 'sources'), { recursive: true });
for (const [name, directory, entries] of [
  ['acbr-source.tar.gz', source, ['.']],
  ...(!posOnly ? [['fortes-source.tar.gz', fortes, ['Source', 'LICENSE', 'Packages']]] : []),
]) {
  const archived = spawnSync('tar', ['--exclude=.git', '--exclude=.svn', '-czf', join(runtime, 'sources', name), '-C', directory, ...entries], {
    shell: false, windowsHide: true, encoding: 'utf8', timeout: 120_000,
  });
  if (archived.status !== 0) throw Error('Falha ao preservar fontes correspondentes: ' + archived.stderr);
}
await copyFile(join(root, '.deps/acbr-source.lock.json'), join(runtime, 'sources/acbr-source.lock.json'));
await writeFile(join(runtime, 'sources/build.json'), JSON.stringify({
  sourceRevision: 48590, fortesCommit: posOnly ? null : '888e387faca5a691b246a6b493776b8435be59f3',
  platform, arch: 'x64', widgetset, posOnly, compiler: fpc, compilerArgs,
  note: 'Free Pascal/Lazarus; não usa Delphi nem ACBr Pro. Saída de impressão física não é testada pelo build.',
}, null, 2) + '\n');
const files = {};
async function inventory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await inventory(file);
    else if (entry.name !== 'manifest.json') files[relative(runtime, file).split('\\').join('/')] = hash(await readFile(file));
  }
}
await inventory(runtime);
await writeFile(join(runtime, 'manifest.json'), JSON.stringify({ formatVersion: 1, sourceRevision: 48590, platform,
  arch: 'x64', executable, widgetset, features: posOnly ? ['pos', 'serial', 'modelos-acbr'] : ['pos', 'fortes', 'danfe', 'serial', 'layout-spooler', 'modelos-acbr'], files }, null, 2) + '\n');
console.log('Runtime validado: ' + runtime);
