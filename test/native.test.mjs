import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { criarImpressora } from '../dist/index.js';
import { syntheticXml } from './fixtures/synthetic-nfe.mjs';

const enabled = process.env.ACBR_PRINTER_NATIVE_TEST === '1';
const runtimeDirectory = process.env.ACBR_PRINTER_RUNTIME || resolve('runtime', `${process.platform}-${process.arch}`);

test('real ACBr type zero produces plain receipt bytes without accessing printer', { skip: !enabled }, async () => {
  const printer = criarImpressora({ runtimeDirectory });
  try {
    const result = await printer.gerarEscpos('TESTE SINTETICO - SEM VALOR FISCAL\nTipo 0: somente texto.\n\n');
    assert.equal(result.sucesso, true, JSON.stringify(result));
    assert.ok(['PREPARADO', 'GERADO'].includes(result.estado));
    assert.equal(result.envioIniciado, false);
    assert.ok(Buffer.isBuffer(result.dados));
    assert.match(result.dados.toString('latin1'), /TESTE SINTETICO/);
    assert.equal(result.dados.includes(0x1b), false, 'Type 0 must not introduce ESC commands.');
    assert.equal(result.dados.includes(0x1d), false, 'Type 0 must not introduce GS commands.');
  } finally { await printer.fechar(); }
});

test('real ACBr type eight translates tags only into an in-memory job', { skip: !enabled }, async () => {
  const printer = criarImpressora({ runtimeDirectory, tipo: 8, interpretarTags: true });
  try {
    const result = await printer.gerarEscpos('<n>TESTE SOMENTE EM ARQUIVO</n>\n');
    assert.equal(result.sucesso, true, JSON.stringify(result));
    assert.ok(['PREPARADO', 'GERADO'].includes(result.estado));
    assert.equal(result.envioIniciado, false);
    assert.ok(result.dados.length > 0);
    assert.equal(result.dados.toString('latin1').includes('<n>'), false);
    assert.ok(result.dados.includes(0x1b), 'Star profile should emit ESC commands for bold.');
  } finally { await printer.fechar(); }
});

test('real ACBr type eight emits a cut command only with explicit opt-in, without touching a printer',
  { skip: !enabled }, async () => {
    const cutCommand = Buffer.from([0x1d, 0x56, 0x00]); // ACBr EscPosStar inherits Epson GS V 0.
    const content = 'TESTE DE CORTE APENAS EM ARQUIVO\n\n\n</corte_total>';
    for (const cortarPapel of [undefined, false, true]) {
      const options = { runtimeDirectory, tipo: 8, interpretarTags: true };
      if (cortarPapel !== undefined) options.cortarPapel = cortarPapel;
      const printer = criarImpressora(options);
      try {
        const result = await printer.gerarEscpos(content);
        assert.equal(result.sucesso, true, JSON.stringify(result));
        assert.equal(result.envioIniciado, false);
        assert.ok(['PREPARADO', 'GERADO'].includes(result.estado));
        assert.equal(result.dados.includes(cutCommand), cortarPapel === true,
          'The cutter command must remain disabled by default and respond to explicit opt-in.');
        assert.equal(result.dados.toString('latin1').includes('</corte_total>'), false);
      } finally { await printer.fechar(); }
    }
  });

test('real Fortes DANFE renders synthetic 55 and 65 XML to PDF without print transport',
  { skip: !enabled || process.env.ACBR_PRINTER_PDF_TEST !== '1' }, async () => {
    const printer = criarImpressora({ runtimeDirectory });
    try {
      for (const model of [55, 65]) {
        const result = await printer.danfePdf(syntheticXml(model), { larguraPapel: 80 });
        assert.equal(result.sucesso, true, JSON.stringify(result));
        assert.equal(result.estado, 'GERADO');
        assert.equal(result.envioIniciado, false);
        assert.ok(Buffer.isBuffer(result.pdf));
        assert.equal(result.pdf.subarray(0, 5).toString(), '%PDF-');
        assert.ok(result.pdf.length > 1000);
      }
    } finally { await printer.fechar(); }
  });

export { syntheticXml };
