import { readFile, writeFile } from 'node:fs/promises';
import { criarImpressora } from 'cosmemilton-acbr-printer-node';

const [arquivo, saida = './danfe.pdf', ...extras] = process.argv.slice(2);
if (!arquivo || extras.length) throw new Error('Uso: node examples/integracao-emissor.mjs resultado-fiscal.json [danfe.pdf]');

// Consome uma resposta já salva; este exemplo não emite/transmite documento fiscal.
const resultadoFiscal = JSON.parse(await readFile(arquivo, 'utf8'));
if (!resultadoFiscal || typeof resultadoFiscal.xmlBase64 !== 'string') {
  throw new Error('O resultado fiscal salvo deve conter xmlBase64.');
}
const impressora = criarImpressora();
try {
  const resultado = await impressora.danfePdf(resultadoFiscal);
  if (!resultado.sucesso || !resultado.pdf) throw new Error(`${resultado.codigo ?? 'ERRO'}: ${resultado.mensagem ?? 'PDF não gerado.'}`);
  await writeFile(saida, resultado.pdf);
  console.log({ arquivo: saida, bytes: resultado.pdf.length });
} finally {
  await impressora.fechar();
}
