import { criarImpressora } from 'cosmemilton-acbr-printer-node';
import { cupomAvancado, verificarCupomAvancado } from './fixtures/cupom-avancado.mjs';

if (process.argv.slice(2).some(argument => argument !== '--enviar')) {
  throw new Error('Uso: node examples/escpos-avancado.mjs [--enviar]');
}
const printer = criarImpressora({ modo: 'escpos', porta: String.raw`\\localhost\elgin`, tipo: 8,
  interpretarTags: true, cortarPapel: true, colunas: 48, linhasEntreCupons: 5 });
try {
  const capabilities = await printer.capacidades();
  if (!capabilities.sucesso || capabilities.capacidades?.cortePapelOptIn !== true) {
    throw new Error('Atualize o runtime para uma versão com corte opt-in; nenhum trabalho foi enviado.');
  }
  const generated = await printer.gerarEscpos(cupomAvancado);
  if (!generated.sucesso) throw new Error(`${generated.codigo}: ${generated.mensagem}`);
  const check = verificarCupomAvancado(generated.dados);
  console.log(JSON.stringify({ geracao: check, envioFisico: false }));
  if (process.argv.includes('--enviar')) {
    const result = await printer.imprimirTexto(cupomAvancado);
    console.log(JSON.stringify({ sucesso: result.sucesso, estado: result.estado,
      envioIniciado: result.envioIniciado, resultadoIncerto: result.resultadoIncerto ?? false,
      codigo: result.codigo, mensagem: result.mensagem }));
    if (!result.sucesso) process.exitCode = 1;
  }
} finally { await printer.fechar(); }
