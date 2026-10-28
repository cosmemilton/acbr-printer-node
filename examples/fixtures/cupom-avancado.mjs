export const QR_CODE = 'ACBR-TESTE-TIPO8';
export const CODE128 = 'ACBR123456';
export const EAN13 = '7891234567895';
export const cupomAvancado = [
  '</zera></fn></ce><n>TESTE ESPECIALIZADO</n>',
  'ACBr Printer Node - tipo 8',
  'TESTE NAO FISCAL',
  '</ae>------------------------------------------------',
  '01. NEGRITO / NORMAL',
  'Texto normal',
  '<n>Texto em NEGRITO</n>',
  'Texto normal novamente',
  '',
  '02. FORMATOS DE FONTE',
  '<s>Texto sublinhado</s>',
  '<e>EXPANDIDO</e>',
  '<a>ALTURA DUPLA</a>',
  '<e><a>GRANDE</a></e>',
  '<c>Fonte condensada: 1234567890 ABCDEFGHIJKLMNOPQRSTUVWXYZ</c>',
  '<in>TEXTO INVERTIDO</in>',
  '</fn>',
  '03. ALINHAMENTO',
  '</ae>ESQUERDA',
  '</ce>CENTRO',
  '</ad>DIREITA',
  '</ae>',
  '04. ACENTOS',
  'Ação, café, açúcar, ç, ã, ê.',
  '',
  '</ce>05. QR CODE',
  '<qrcode_tipo>2</qrcode_tipo>',
  '<qrcode_largura>5</qrcode_largura>',
  '<qrcode_error>1</qrcode_error>',
  `<qrcode>${QR_CODE}</qrcode>`,
  'Leitura esperada:',
  QR_CODE,
  '',
  '06. CODE 128',
  '<barra_mostrar>1</barra_mostrar>',
  '<barra_largura>2</barra_largura>',
  '<barra_altura>70</barra_altura>',
  `<code128>${CODE128}</code128>`,
  `Leitura: ${CODE128}`,
  '',
  '07. EAN-13',
  '<ean13>789123456789</ean13>',
  `Leitura: ${EAN13}`,
  '',
  '</fn></ae>------------------------------------------------',
  '</ce>08. FIM - CORTE TOTAL',
  'O papel deve cortar abaixo desta mensagem.',
  '</ae>', '',
  '</corte_total>',
].join('\n');

export function verificarCupomAvancado(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('O motor não retornou bytes do cupom.');
  const commands = {
    negrito: '1b2108', sublinhado: '1b2180', expandido: '1b2120', alturaDupla: '1b2110',
    fonteGrande: '1b2130', condensado: '1b2101', invertido: '1d4201',
    esquerda: '1b6100', centro: '1b6101', direita: '1b6102',
    qrcode: '1d286b', code128: '1d6b49', ean13: '1d6b43', corteTotal: '1d5600',
  };
  for (const [name, hex] of Object.entries(commands)) {
    if (!bytes.includes(Buffer.from(hex, 'hex'))) throw new Error(`O ACBr não gerou o comando ${name}; impressão não enviada.`);
  }
  for (const tag of ['<n>', '<qrcode>', '<code128>', '<ean13>', '</corte_total>']) {
    if (bytes.includes(Buffer.from(tag))) throw new Error('Tag não interpretada: ' + tag);
  }
  const cut = Buffer.from('1d5600', 'hex');
  let count = 0, position = bytes.indexOf(cut);
  while (position !== -1) { count++; position = bytes.indexOf(cut, position + cut.length); }
  if (count !== 1) throw new Error('O teste deve gerar exatamente um corte de papel.');
  return { bytes: bytes.length, comandos: Object.keys(commands), corteTotal: count, qrCode: QR_CODE, code128: CODE128, ean13: EAN13 };
}
