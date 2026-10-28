import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { criarImpressora, ErroAcbrImpressora } from '../dist/index.js';

const xml = '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe versao="4.00"><ide><mod>65</mod></ide></infNFe></NFe></nfeProc>';
const base64 = value => Buffer.from(value).toString('base64');
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, responder = request => ({ dadosBase64: base64(request.texto ?? '') })) {
  const directory = await mkdtemp(join(tmpdir(), 'acbr-printer-node-test-'));
  const executable = 'worker';
  const binary = Buffer.from('Synthetic binary: never executed by this test.');
  const manifest = { formatVersion: 1, sourceRevision: 48590, platform: process.platform,
    arch: process.arch, executable, files: { [executable]: hash(binary) } };
  await writeFile(join(directory, executable), binary);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  const sessions = [];
  let nextResponder = responder;
  const waiting = [];
  const launched = (count = 1) => sessions.length >= count ? Promise.resolve(sessions[count - 1]) : new Promise((resolve, reject) => {
    const item = { count, resolve, timer: setTimeout(() => reject(new Error('Timed out waiting for synthetic child launch.')), 2000) };
    waiting.push(item);
  });
  const launch = (exe, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      pid: 92000 + sessions.length, killed: false, unref() {} });
    let closed = false;
    const session = { child, exe, args, options, request: undefined, kills: [],
      marker() { child.stdout.write(JSON.stringify({ tipo: 'envioIniciado', id: session.request.id }) + '\n'); },
      send(fields = {}) {
        const request = session.request;
        child.stdout.write(JSON.stringify({ versao: 1, id: request.id, sourceRevision: 48590,
          sucesso: true, estado: request.comando === 'imprimirTexto' || request.comando === 'imprimirDanfe'
            ? 'ENVIADO' : request.comando === 'danfePdf' ? 'GERADO' : 'PREPARADO',
          envioIniciado: request.comando === 'imprimirTexto' || request.comando === 'imprimirDanfe',
          ...(request.comando === 'gerarEscpos' ? { dadosBase64: base64(request.texto) } : {}),
          ...(request.comando === 'capacidades' ? { capacidades: { escpos: true } } : {}),
          ...(request.comando === 'listarImpressoras' ? { impressoras: [] } : {}),
          ...fields }) + '\n');
      },
      close(code = 0) {
        if (closed) return;
        closed = true;
        child.stdout.end(); child.stderr.end();
        child.emit('exit', code, null); child.emit('close', code, null);
      },
    };
    child.kill = signal => {
      session.kills.push(signal); child.killed = true;
      queueMicrotask(() => session.close(null));
      return true;
    };
    let requestText = '';
    child.stdin.on('data', chunk => { requestText += chunk.toString(); });
    child.stdin.on('finish', () => {
      session.request = JSON.parse(requestText);
      queueMicrotask(async () => {
        try {
          const response = await nextResponder(session.request, session);
          if (response !== undefined) { session.send(response); session.close(); }
        } catch (error) { child.emit('error', error); }
      });
    });
    sessions.push(session);
    queueMicrotask(() => {
      child.emit('spawn');
      for (let index = waiting.length - 1; index >= 0; index--) {
        const item = waiting[index];
        if (sessions.length >= item.count) { clearTimeout(item.timer); item.resolve(sessions[item.count - 1]); waiting.splice(index, 1); }
      }
    });
    return child;
  };
  const printers = [];
  const create = (options = {}) => {
    const printer = criarImpressora({ runtimeDirectory: directory, criaProcesso: launch,
      porta: join(directory, 'synthetic-output.prn'), ...options });
    printers.push(printer);
    return printer;
  };
  t.after(async () => {
    await Promise.all(printers.map(printer => printer.fechar()));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, manifest, sessions, launch, launched, create,
    respondWith(value) { nextResponder = value; } };
}

const expectedError = (code, uncertain = false) => error => {
  assert.ok(error instanceof ErroAcbrImpressora);
  if (code !== undefined) assert.equal(error.codigo, code);
  assert.equal(error.resultadoIncerto, uncertain);
  return true;
};

test('text defaults to ACBr type zero and content travels only through stdin', async t => {
  const f = await fixture(t);
  const text = 'TESTE SEM VALOR FISCAL\n"; $(comando) & outro | comando\n';
  const result = await f.create().gerarEscpos(text);
  assert.equal(result.sucesso, true);
  assert.ok(Buffer.isBuffer(result.dados));
  assert.equal(result.dados.toString('utf8'), text);
  assert.equal(f.sessions.length, 1);
  const session = f.sessions[0];
  assert.deepEqual(session.request.config, { modo: 'escpos', porta: join(f.directory, 'synthetic-output.prn'),
    tipo: 0, colunas: 48, linhasEntreCupons: 0, interpretarTags: false });
  assert.equal(session.request.texto, text);
  assert.equal(session.options.shell, false);
  assert.equal(session.options.windowsHide, true);
  assert.equal(session.args.some(value => value.includes(text) || value.includes('SEM VALOR')), false);
});

test('ACBr type eight remains explicit and is generated without physical printing', async t => {
  const f = await fixture(t);
  await f.create({ tipo: 8, interpretarTags: true }).gerarEscpos('<n>TESTE</n>\n');
  assert.equal(f.sessions[0].request.config.tipo, 8);
  assert.equal(f.sessions[0].request.config.interpretarTags, true);
  assert.equal(f.sessions[0].request.comando, 'gerarEscpos');
  assert.equal(f.sessions[0].kills.length, 0);
});

test('configuration rejects invalid ranges, modes and unexpected credential fields', () => {
  for (const config of [
    { modo: 'raw' }, { tipo: 1 }, { tipo: '0' }, { colunas: 0 }, { colunas: 201 },
    { linhasEntreCupons: -1 }, { linhasEntreCupons: 101 }, { timeoutMs: 0 },
    { limiteFila: -1 }, { interpretarTags: 'true' }, { certificado: { senha: 'secret' } },
    { impressora: 'x\nother' }, { modo: null }, { tipo: null }, { colunas: null },
    { linhasEntreCupons: null }, { timeoutMs: null }, { limiteFila: null }, { interpretarTags: null },
  ]) {
    assert.throws(() => criarImpressora(config), expectedError(), JSON.stringify(config));
  }
});

test('text, XML and report options reject invalid input before launching transport', async t => {
  const f = await fixture(t);
  const printer = f.create();
  for (const invoke of [
    () => printer.gerarEscpos(''), () => printer.imprimirTexto(123),
    () => printer.danfePdf({ xmlBase64: 'invalid base64' }),
    () => printer.danfePdf(xml, { copias: 0 }),
    () => printer.danfePdf(xml, { larguraPapel: -1 }),
    () => printer.danfePdf(xml, { senha: 'unwanted' }),
  ]) await assert.rejects(invoke, expectedError());
  assert.equal(f.sessions.length, 0);
});

test('XML integration is structural and accepts emitter output without importing emitter', async t => {
  const f = await fixture(t, () => ({ pdfBase64: base64('%PDF-1.4\nsynthetic\n%%EOF') }));
  const printer = f.create();
  for (const input of [xml, Buffer.from(xml), { xmlBase64: base64(xml), sucesso: true, estado: 'AUTORIZADA' }]) {
    const result = await printer.danfePdf(input, { larguraPapel: 80 });
    assert.ok(Buffer.isBuffer(result.pdf));
    assert.match(result.pdf.toString(), /^%PDF-/);
  }
  assert.equal(f.sessions.length, 3);
  for (const session of f.sessions) {
    assert.equal(session.request.xmlBase64, base64(xml));
    assert.equal(session.request.comando, 'danfePdf');
    assert.equal(session.request.opcoes.larguraPapel, 80);
    assert.equal('certificado' in session.request, false);
  }
});

test('UNC printing is rejected outside Windows while offline byte generation is allowed',
  { skip: process.platform === 'win32' }, async t => {
    const f = await fixture(t);
    const printer = f.create({ porta: String.raw`\\localhost\elgin` });
    await assert.rejects(() => printer.imprimirTexto('NAO IMPRIMIR\n'),
      expectedError('DESTINO_WINDOWS_REQUER_NODE_WINDOWS'));
    assert.equal(f.sessions.length, 0);
    await printer.gerarEscpos('SEM ACESSO A IMPRESSORA\n');
    assert.equal(f.sessions.length, 1);
  });

test('runtime hashes, revision, platform and paths are verified before spawn', async t => {
  const f = await fixture(t);
  const original = { ...f.manifest, files: { ...f.manifest.files } };
  for (const patch of [
    { sourceRevision: 1 }, { platform: 'synthetic-os' },
    { executable: '../worker', files: { '../worker': hash('x') } },
    { files: { worker: '0'.repeat(64) } },
  ]) {
    await writeFile(join(f.directory, 'manifest.json'), JSON.stringify({ ...original, ...patch }));
    await assert.rejects(() => f.create().capacidades(), expectedError());
  }
  assert.equal(f.sessions.length, 0);
});

test('native failure preserves original result and never retries the job', async t => {
  const f = await fixture(t, () => ({ sucesso: false, estado: 'ERRO', codigo: 'PORTA_INDISPONIVEL',
    mensagem: 'Synthetic unavailable printer', envioIniciado: false }));
  const result = await f.create().imprimirTexto('NAO IMPRIMIR\n');
  assert.equal(result.sucesso, false);
  assert.equal(result.codigo, 'PORTA_INDISPONIVEL');
  assert.equal(result.mensagem, 'Synthetic unavailable printer');
  assert.equal(f.sessions.length, 1);
});

test('a successful print frame does not resolve until the owned worker closes successfully', async t => {
  const f = await fixture(t, (_request, session) => { session.marker(); session.send(); });
  let settled = false;
  const operation = f.create().imprimirTexto('NAO IMPRIMIR');
  void operation.then(() => { settled = true; }, () => { settled = true; });
  const session = await f.launched();
  await nextTurn();
  assert.equal(settled, false);
  session.close();
  const result = await operation;
  assert.equal(result.sucesso, true);
  assert.equal(result.estado, 'ENVIADO');
  assert.equal(result.envioIniciado, true);
});

test('malformed, mismatched and duplicate JSONL frames are rejected without retry', async t => {
  const f = await fixture(t);
  for (const output of ['not json\n', JSON.stringify({ versao: 1, id: 'wrong', sourceRevision: 48590,
    sucesso: true, estado: 'ENVIADO', envioIniciado: false }) + '\n', 'duplicate']) {
    f.respondWith((_request, session) => {
      if (output === 'duplicate') { session.send(); session.send(); }
      else session.child.stdout.write(output);
      session.close();
    });
    await assert.rejects(() => f.create().gerarEscpos('NAO IMPRIMIR\n'), expectedError());
  }
  assert.equal(f.sessions.length, 3);
});

test('same-destination jobs are serialized, including across factory instances', async t => {
  let release;
  let call = 0;
  const f = await fixture(t, async (_request, session) => {
    if (++call === 1) await new Promise(resolve => { release = resolve; });
    return { dadosBase64: base64(session.request.texto) };
  });
  const first = f.create().gerarEscpos('first');
  await f.launched();
  await nextTurn();
  const second = f.create().gerarEscpos('second');
  await nextTurn();
  assert.equal(f.sessions.length, 1);
  release();
  assert.equal((await first).dados.toString(), 'first');
  assert.equal((await second).dados.toString(), 'second');
  assert.equal(f.sessions.length, 2);
});

test('queue capacity rejects extra jobs instead of silently dropping them', async t => {
  let release;
  const f = await fixture(t, async () => {
    await new Promise(resolve => { release = resolve; });
    return {};
  });
  const printer = f.create({ limiteFila: 0 });
  const first = printer.capacidades();
  await f.launched();
  await nextTurn();
  await assert.rejects(() => printer.capacidades(), expectedError());
  assert.equal(f.sessions.length, 1);
  release();
  await first;
});

test('abort before launch has no side effects and an offline generation timeout is certain', async t => {
  const f = await fixture(t, () => undefined);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => f.create().imprimirTexto('NAO IMPRIMIR', { signal: controller.signal }), expectedError());
  assert.equal(f.sessions.length, 0);
  await assert.rejects(() => f.create({ timeoutMs: 20 }).gerarEscpos('NAO IMPRIMIR'), expectedError());
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0].kills.length, 1);
});

test('timeout after send marker is uncertain and never automatically reprints', async t => {
  const f = await fixture(t, (_request, session) => { session.marker(); });
  await assert.rejects(() => f.create({ timeoutMs: 25 }).imprimirTexto('NAO IMPRIMIR'), expectedError(undefined, true));
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0].kills.length, 1);
});

test('close cancels only owned child, rejects pending jobs and refuses further jobs', async t => {
  const f = await fixture(t, () => undefined);
  const printer = f.create();
  const first = printer.imprimirTexto('NAO IMPRIMIR');
  const firstRejected = assert.rejects(first, expectedError(undefined, true));
  await f.launched();
  const pending = printer.imprimirTexto('NAO IMPRIMIR OUTRO');
  const pendingRejected = assert.rejects(pending, expectedError());
  await printer.fechar();
  await Promise.all([firstRejected, pendingRejected]);
  await assert.rejects(() => printer.capacidades(), expectedError());
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0].kills.length, 1);
  await printer.fechar();
});

test('closing one instance does not cancel an unrelated destination job', async t => {
  const f = await fixture(t, () => undefined);
  const a = f.create({ porta: join(f.directory, 'a.prn') });
  const b = f.create({ porta: join(f.directory, 'b.prn') });
  const first = a.imprimirTexto('NAO IMPRIMIR');
  const firstRejected = assert.rejects(first, expectedError(undefined, true));
  const second = b.imprimirTexto('NAO IMPRIMIR');
  const secondRejected = assert.rejects(second, expectedError(undefined, true));
  await f.launched(2);
  await nextTurn();
  assert.equal(f.sessions.length, 2);
  await a.fechar();
  assert.equal(f.sessions.find(session => session.request.config.porta.endsWith('a.prn')).kills.length, 1);
  assert.equal(f.sessions.find(session => session.request.config.porta.endsWith('b.prn')).kills.length, 0);
  await b.fechar();
  await Promise.all([firstRejected, secondRejected]);
});

test('failed child teardown closes the owning instance and reports cleanup uncertainty', async t => {
  const f = await fixture(t, () => undefined);
  const printer = f.create();
  const operation = printer.imprimirTexto('NAO IMPRIMIR');
  const rejected = assert.rejects(operation, error => {
    assert.ok(expectedError(undefined, true)(error));
    assert.equal(error.falhaLimpeza, true);
    return true;
  });
  const session = await f.launched();
  await nextTurn();
  session.child.kill = () => false;
  await printer.fechar();
  await rejected;
  await assert.rejects(() => printer.capacidades(), error => {
    assert.ok(expectedError('IMPRESSORA_FECHADA')(error));
    assert.equal(error.falhaLimpeza, true);
    return true;
  });
});
