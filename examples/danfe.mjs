import { readFile, writeFile } from 'node:fs/promises';
import { criarImpressora } from 'cosmemilton-acbr-printer-node';

let arquivo, saida = './danfe.pdf', enviar = false;
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--enviar') enviar = true;
  else if (argument === '--saida' && process.argv[index + 1]) saida = process.argv[++index];
  else if (!argument.startsWith('--') && arquivo === undefined) arquivo = argument;
  else throw new Error('Uso: node examples/danfe.mjs nota.xml [--saida danfe.pdf] [--enviar]');
}
if (!arquivo) throw new Error('Informe um XML salvo: node examples/danfe.mjs nota.xml [--saida danfe.pdf] [--enviar]');

const xml = await readFile(arquivo);
const impressora = criarImpressora({ modo: 'spooler', impressora: process.env.ACBR_IMPRESSORA ?? 'ELGIN' });
try {
  const pdf = await impressora.danfePdf(xml, { larguraPapel: 80 });
  if (!pdf.sucesso || !pdf.pdf) throw new Error(`${pdf.codigo ?? 'ERRO'}: ${pdf.mensagem ?? 'PDF não gerado.'}`);
  await writeFile(saida, pdf.pdf);
  console.log({ arquivo: saida, bytes: pdf.pdf.length });
  if (enviar) {
    const resultado = await impressora.imprimirDanfe(xml, { copias: 1, larguraPapel: 80 });
    if (!resultado.sucesso) throw new Error(`${resultado.codigo ?? 'ERRO'}: ${resultado.mensagem ?? 'Envio não concluído.'}`);
    console.log({ estado: resultado.estado, envioIniciado: resultado.envioIniciado });
  }
} finally {
  await impressora.fechar();
}
