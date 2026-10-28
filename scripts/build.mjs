import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('dist', { recursive: true });
for (const format of ['esm', 'cjs']) {
  await build({ entryPoints: ['src/index.ts'], outfile: `dist/index.${format === 'esm' ? 'js' : 'cjs'}`,
    bundle: true, platform: 'node', target: 'node22.12', format, sourcemap: true,
    logLevel: 'warning', packages: 'external' });
}
const declaration = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--emitDeclarationOnly'], {
  stdio: 'inherit', shell: false, windowsHide: true,
});
if (declaration.status !== 0) process.exit(declaration.status ?? 1);
