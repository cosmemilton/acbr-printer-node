import { criarImpressora } from 'cosmemilton-acbr-printer-node';

if (process.argv.slice(2).some(argument => argument !== '--enviar')) {
  throw new Error('Uso: node examples/spooler.mjs [--enviar]');
}
const impressora = criarImpressora({ modo: 'spooler', impressora: process.env.ACBR_IMPRESSORA ?? 'ELGIN' });
try {
  const resultado = process.argv.includes('--enviar')
    ? await impressora.imprimirTexto('TESTE NAO FISCAL\nACBr Printer Node\nSpooler FortesReport\n')
    : await impressora.listarImpressoras();
  if (!resultado.sucesso) throw new Error(`${resultado.codigo ?? 'ERRO'}: ${resultado.mensagem ?? 'Operação não concluída.'}`);
  console.log(process.argv.includes('--enviar')
    ? { estado: resultado.estado, envioIniciado: resultado.envioIniciado }
    : { impressoras: resultado.impressoras });
} finally {
  await impressora.fechar();
}
