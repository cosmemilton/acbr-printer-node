import { criarImpressora } from 'cosmemilton-acbr-printer-node';

if (process.argv.slice(2).some(argument => argument !== '--enviar')) {
  throw new Error('Uso: node examples/escpos-texto.mjs [--enviar]');
}
const enviar = process.argv.includes('--enviar');
const texto = 'TESTE NAO FISCAL\nACBr Printer Node\nTipo 0 - texto\n\n\n';
const impressora = criarImpressora({ modo: 'escpos', porta: String.raw`\\localhost\elgin`, tipo: 0 });
try {
  const resultado = enviar ? await impressora.imprimirTexto(texto) : await impressora.gerarEscpos(texto);
  if (!resultado.sucesso) throw new Error(`${resultado.codigo ?? 'ERRO'}: ${resultado.mensagem ?? 'Operação não concluída.'}`);
  if (enviar) console.log({ estado: resultado.estado, envioIniciado: resultado.envioIniciado });
  else console.log({ estado: resultado.estado, bytes: resultado.dados.length, hexadecimal: resultado.dados.toString('hex') });
} finally {
  await impressora.fechar();
}
