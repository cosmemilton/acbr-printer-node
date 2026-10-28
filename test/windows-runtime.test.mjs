import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { criarImpressora } from '../dist/index.js';
import { syntheticXml } from './fixtures/synthetic-nfe.mjs';

const enabled = process.platform === 'win32' && process.env.ACBR_PRINTER_WINDOWS_DEPENDENCY_TEST === '1';

test('missing libxml2 keeps the original Windows error as UTF-8 JSON, without physical printing',
  { skip: !enabled }, async () => {
    const runtime = resolve(process.env.ACBR_PRINTER_RUNTIME || 'runtime/win32-x64');
    const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
    assert.equal(manifest.platform, 'win32');
    // A new directory contains only the executable. No distributed DLL is
    // removed or changed, and no physical destination is configured.
    const isolated = await mkdtemp(join(tmpdir(), 'acbr-printer-missing-xml2-'));
    const executable = manifest.executable;
    const target = join(isolated, executable);
    await copyFile(join(runtime, executable), target);
    const digest = createHash('sha256').update(await readFile(target)).digest('hex');
    await writeFile(join(isolated, 'manifest.json'), JSON.stringify({
      formatVersion: 1, sourceRevision: 48590, platform: 'win32', arch: 'x64',
      executable, files: { [executable]: digest },
    }));
    const environment = {};
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
    environment.PATH = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    const printer = criarImpressora({
      runtimeDirectory: isolated,
      criaProcesso: (file, args, options) => spawn(file, args, {
        ...options, env: environment, stdio: ['pipe', 'pipe', 'pipe'],
      }),
    });
    try {
      const result = await printer.danfePdf(syntheticXml(55));
      assert.equal(result.sucesso, false);
      assert.equal(result.codigo, 'ERRO_ACBR');
      assert.equal(result.envioIniciado, false);
      assert.equal(result.resultadoIncerto, undefined);
      assert.equal(result.mensagem, 'Não foi possível carregar a biblioteca LibXml2.');
      assert.equal(result.mensagem.includes('\uFFFD'), false);

      // Our own UTF-8 literal passes through the same catch without a second
      // encoding conversion, even though the isolated runtime lacks libxml2.
      const ownError = await printer.danfePdf('<NFe>');
      assert.equal(ownError.codigo, 'XML_INVALIDO');
      assert.equal(ownError.mensagem, 'O documento XML não está bem formado.');
    } finally {
      await printer.fechar();
      await rm(isolated, { recursive: true, force: true });
    }
  });
