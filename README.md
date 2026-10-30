# cosmemilton-acbr-printer-node

Impressão no Node.js com ACBrPosPrinter, FortesReport e os renderizadores DANFE do ACBr, compilados com Free Pascal/Lazarus. Pacote independente de `cosmemilton-acbr-node`: pode ser usado sozinho ou receber o XML produzido pelo emissor. Não usa Delphi nem binários ACBr Pro e não é um produto oficial do Projeto ACBr.

Versão local: **0.1.2**. Esta documentação descreve o código local; não afirma disponibilidade no registry npm. O estado dos testes está em [docs/VALIDACAO.md](docs/VALIDACAO.md).

## Um pacote, três formas de impressão

| Necessidade | Entrada | Destino e motor |
| --- | --- | --- |
| Texto/cupom POS | `gerarEscpos` ou `imprimirTexto` | ACBrPosPrinter; no Windows, por exemplo `\\localhost\elgin` |
| Texto gráfico pelo spooler | `imprimirTexto` com `modo: 'spooler'` | FortesReport e uma fila instalada, por exemplo `ELGIN` |
| DANFE NF-e/NFC-e | `danfePdf` ou `imprimirDanfe` | XML local; Fortes para PDF/spooler e ACBr DANFE ESC/POS para NFC-e |

A mesma fachada seleciona o backend pela operação e configuração. O pacote fiscal não recebe uma dependência de impressão. Para DANFE, o motor lê o modelo 55/65 do XML; a saída ESC/POS destina-se à NFC-e, enquanto o renderer Fortes atende NF-e/A4 e NFC-e/bobina.

## Instalação local

Requer Node.js **22.12 ou superior**, x64, em Windows ou Linux. Instale o tarball auditado que contenha o runtime da sua plataforma:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund \
  /caminho/cosmemilton-acbr-printer-node-0.1.2.tgz
```

O consumidor usa o executável já compilado. Free Pascal, Lazarus e as fontes são necessários para reconstruí-lo, não para carregar a API Node. Um runtime próprio pode ser informado por `runtimeDirectory`.

## Primeiro teste: tipo 0, sem enviar papel

```js
import { criarImpressora } from 'cosmemilton-acbr-printer-node';

const impressora = criarImpressora({
  modo: 'escpos',
  porta: String.raw`\\localhost\elgin`,
  tipo: 0,
});

try {
  const resultado = await impressora.gerarEscpos(
    'TESTE NAO FISCAL\nACBr Printer Node\nTipo 0 - texto\n\n\n',
  );
  if (!resultado.sucesso) throw new Error(resultado.mensagem ?? resultado.codigo);
  console.log(resultado.dados); // Buffer; esta operação não acessa a impressora.
} finally {
  await impressora.fechar();
}
```

`String.raw` preserva as duas barras iniciais do endereço UNC. Sem ele, a string JavaScript equivalente é `'\\\\localhost\\elgin'`. Esse endereço aponta para o Windows em que o processo é executado. Para usá-lo, execute **Node.js e o runtime no Windows**, na conta com acesso ao compartilhamento. O `localhost` do Ubuntu/WSL não identifica automaticamente o spooler do Windows.

Para enviar o texto, chame explicitamente `imprimirTexto(texto)`. O exemplo abaixo gera bytes por padrão e só envia quando recebe `--enviar`:

```sh
node examples/escpos-texto.mjs
node examples/escpos-texto.mjs --enviar
```

`tipo: 0` é `ppTexto`, o padrão inicial. `tipo: 8` é `ppEscPosStar`, a emulação informada para a impressora do usuário; o tipo não é deduzido da marca ou do nome da fila. Tags são opt-in com `interpretarTags: true`. As tags de corte exigem também `cortarPapel: true`; o padrão continua sem corte. A gaveta não é acionada implicitamente.

### Teste especializado do tipo 8

```sh
node examples/escpos-avancado.mjs
node examples/escpos-avancado.mjs --enviar
```

O primeiro comando gera o cupom apenas em memória e confere os bytes reais de negrito, sublinhado, tamanho expandido/duplo, condensado, invertido, alinhamentos, QR Code, Code128, EAN13 e um único corte total. O segundo faz essa mesma conferência antes de enviar um único cupom para `\\localhost\elgin`. O corte é explícito, após avanço de cinco linhas. O exemplo não abre gaveta nem emite beep.

Confira no papel e com um leitor: o QR Code deve retornar `ACBR-TESTE-TIPO8`, o Code128 `ACBR123456` e o EAN13 `7891234567895`. A geração dos bytes e o retorno `ENVIADO` não substituem essa conferência física.

## Spooler Windows

```js
const impressora = criarImpressora({ modo: 'spooler', impressora: 'ELGIN' });
try {
  console.log((await impressora.listarImpressoras()).impressoras);
  // Envio explícito pelo FortesReport:
  // const envio = await impressora.imprimirTexto('TESTE NAO FISCAL\n');
} finally {
  await impressora.fechar();
}
```

O spooler usa o **nome da fila**, não a porta UNC. As filas disponíveis pertencem ao usuário que executa o processo; uma aplicação como serviço pode enxergar filas diferentes. `listarImpressoras()` é uma consulta. O exemplo [examples/spooler.mjs](examples/spooler.mjs) só envia com `--enviar`.

## PDF e DANFE de XML existente

```js
import { readFile, writeFile } from 'node:fs/promises';
import { criarImpressora } from 'cosmemilton-acbr-printer-node';

const impressora = criarImpressora({ modo: 'spooler', impressora: 'ELGIN' });
try {
  const xml = await readFile('./nota.xml');
  const resultado = await impressora.danfePdf(xml, {
    larguraPapel: 80,
  });
  if (!resultado.sucesso || !resultado.pdf) throw new Error(resultado.mensagem ?? resultado.codigo);
  await writeFile('./danfe.pdf', resultado.pdf);
  // Para enviar ao spooler: await impressora.imprimirDanfe(xml, { copias: 1 });
} finally {
  await impressora.fechar();
}
```

As entradas aceitas são XML em `string` UTF-8, `Uint8Array`/`Buffer` ou um objeto com `xmlBase64`. O resultado do emissor pode ser passado estruturalmente:

```js
const pdf = await impressora.danfePdf(resultadoFiscalComXmlBase64);
```

Somente `xmlBase64` é consumido; os demais metadados não viram configuração do motor. Não é necessário instalar `cosmemilton-acbr-node`, enviar certificado/CSC ou consultar a SEFAZ para imprimir um XML salvo. Renderizar um XML também não confirma autorização fiscal.

```sh
node examples/danfe.mjs ./nota.xml --saida ./danfe.pdf
node examples/danfe.mjs ./nota.xml --saida ./danfe.pdf --enviar
node examples/integracao-emissor.mjs ./resultado-fiscal.json ./danfe.pdf
```

## API e limites

| Opção | Padrão | Valores |
| --- | --- | --- |
| `modo` | `'escpos'` | `'escpos'` ou `'spooler'` |
| `porta` | omitida | Destino POS; obrigatório apenas no envio POS |
| `impressora` | omitida | Fila do spooler; obrigatória apenas no envio por spooler |
| `tipo` | `0` | `0` ou `8` |
| `colunas` | `48` | Inteiro de 1 a 200 |
| `linhasEntreCupons` | `0` | Inteiro de 0 a 100 |
| `interpretarTags` | `false` | Booleano |
| `cortarPapel` | `false` | Booleano; habilita tags de corte no ACBrPosPrinter |
| `timeoutMs` | `30000` | Inteiro de 1 a 120000 |
| `limiteFila` | `32` | Inteiro de 0 a 1000 |
| `serial` | 9600/8/sem paridade/1/sem fluxo | Parâmetros opcionais do transporte serial POS |
| `layout` | 80 mm, margens 3 mm, escala 100% | Cupom de texto gráfico pelo Fortes/spooler |
| `runtimeDirectory` | runtime distribuído | Diretório de runtime com manifesto válido |

### Serial e layout do cupom gráfico — 0.1.2

`serial` aceita `velocidade` (inteiro 300–115200, padrão 9600), `bitsDados`
(5/6/7/8, padrão 8), `paridade` (`nenhuma`, `impar`, `par`, `marca`, `espaco`),
`bitsParada` (1/1.5/2, padrão 1) e `controleFluxo` (`nenhum`, `xon-xoff`,
`rts-cts`, `dtr-dsr`). São propriedades reais do dispositivo serial ACBr;
não transformam uma fila USB ou UNC em porta serial.

`layout` aceita `larguraPapel` (40–300 mm, padrão 80), `margemEsquerda`,
`margemDireita`, `margemSuperior`, `margemInferior` (0–30 mm, padrão 3) e
`escala` (50–200%, padrão 100). As margens horizontais devem deixar pelo menos
10 mm úteis. A escala altera a fonte e o espaçamento efetivamente impressos,
com arredondamento para pixels do renderer, e recalcula a quebra das linhas.
Esse layout atende exclusivamente `imprimirTexto` no modo `spooler`: não é
zoom de preview e não altera o DANFE nem os bytes ESC/POS. Para DANFE,
continuam valendo as opções explícitas da operação.

O tipo 8 continua `EscPosStar`; a apresentação amigável pode ser
**POS Star/Elgin**. A confirmação física registrada refere-se à Elgin i9 do
usuário, sem deduzir compatibilidade de toda impressora pela marca.

Configurações que usam os parâmetros novos exigem runtime 0.1.2 com os
recursos `serial`/`layout-spooler` no manifesto. Runtime antigo é recusado,
evitando campos aceitos mas ignorados. `capacidades()` informa os indicadores
`serialConfiguravel` e `layoutSpoolerConfiguravel`.

Métodos: `capacidades()`, `listarImpressoras()`, `gerarEscpos(texto)`, `imprimirTexto(texto)`, `danfePdf(xml, opcoes)`, `imprimirDanfe(xml, opcoes)` e `fechar()`.

As opções DANFE são `copias` (inteiro de 1 a 99) e `larguraPapel` (40 a 300 milímetros). Texto e XML têm limite de 2 MiB; a resposta JSONL do motor tem limite de 32 MiB. Campos desconhecidos de configuração/opções são rejeitados. `criaProcesso` é uma injeção de testes, não uma configuração necessária em produção.

Todas as operações aceitam `{ signal }` para cancelamento; nas duas operações DANFE esse argumento vem depois das opções do DANFE:

```js
const abort = new AbortController();
const pdf = await impressora.danfePdf(xml, { larguraPapel: 80 }, { signal: abort.signal });
```

As operações retornam `ResultadoImpressao`. Falhas reportadas pelo motor retornam `sucesso: false`, `codigo` e `mensagem`; falhas de validação, runtime e transporte lançam `ErroAcbrImpressora`. `gerarEscpos` acrescenta `dados: Buffer` e `danfePdf` acrescenta `pdf: Buffer`.

`ENVIADO` confirma o retorno do componente após o envio; **não confirma papel fisicamente impresso**. Uma falha/cancelamento após o início ou possível envio pode trazer `resultadoIncerto: true`. A biblioteca nunca repete automaticamente um trabalho. O aplicativo deve conferir o destino antes de decidir por novo envio.

## Reconstrução a partir de um clone limpo

O Git contém o código e os locks de dependências. Os diretórios `runtime`, `.deps`, `.build` e `dist` são gerados localmente; o clone não depende de uma instalação do emissor `cosmemilton-acbr-node`.

Requisitos: Node.js 22.12+, Git, cliente SVN, `tar`, Free Pascal 3.2.2 e Lazarus com LCL/Printer4Lazarus. A compilação é nativa para a plataforma: Linux x64 ou Windows x64. Os compiladores são necessários apenas para reconstrução; o consumidor de um tarball com runtime pronto não os executa.

```sh
git clone https://github.com/cosmemilton/acbr-printer-node.git
cd acbr-printer-node
npm ci --ignore-scripts --no-audit --no-fund
node scripts/prepare-sources.mjs
npm run typecheck
npm run build
npm test
```

`prepare-sources.mjs` é uma operação explícita de desenvolvimento. Exporta do SVN oficial somente as partes ACBr fixadas na revisão **48590** e obtém o FortesReport no commit **888e387faca5a691b246a6b493776b8435be59f3**. Confere os arquivos usados na compilação contra os hashes versionados em `sources/acbr-source.lock.json` e `DEPENDENCIES.lock.json`. Fontes divergentes ou adicionais nos diretórios de compilação causam erro. O script não atualiza os locks nem sobrescreve fontes já preparadas; não há download automático ao instalar o pacote npm.

Para aproveitar snapshots já disponíveis, a verificação continua obrigatória:

```sh
node scripts/prepare-sources.mjs --acbr-source /caminho/acbr-r48590 --fortes-source /caminho/fortesreport-ce
node scripts/prepare-sources.mjs --verify-only
```

Os parâmetros locais também aceitam caminhos Windows entre aspas. O diretório Fortes deve conter `Source`, `Packages` e `LICENSE` do commit fixado. Os fontes copiados para `.deps` ficam independentes dos diretórios de origem.

### Linux x64

No Ubuntu, os pacotes de desenvolvimento incluem Free Pascal, Lazarus/LCL GTK2, unidades de banco de dados usadas pelo ACBr, GTK2 e Xvfb. O caminho padrão do Lazarus é `/usr/lib/lazarus/default`; ajuste-o se sua distribuição instalar em outro local.

```sh
npm run build:native -- --lazarus /usr/lib/lazarus/default --widgetset gtk2
ACBR_PRINTER_NATIVE_TEST=1 ACBR_PRINTER_PDF_TEST=1 xvfb-run -a npm test
xvfb-run -a npm run test:package
```

O runtime completo Fortes/DANFE precisa das bibliotecas GTK2, fontes e um display. Um desktop/WSLg pode fornecer o display; para execução sem tela, use Xvfb. A variante leve abaixo usa `nogui` e não inclui Fortes/DANFE/PDF:

```sh
npm run build:native -- --pos-only --widgetset nogui
```

### Windows x64

Instale a distribuição gratuita Lazarus/FPC x64, Git, SVN e `tar` no Windows. O backend DANFE/PDF também requer `libxml2.dll` x64. A receita gratuita recompila essa DLL a partir do fonte oficial fixado; não requer Delphi, Visual C++ ou o projeto emissor.

No Ubuntu/WSL, acesse o mesmo clone Windows e execute a receita com **Node.js Linux**, MinGW-w64, CMake e Ninja disponíveis:

```sh
cd /mnt/c/projetos/acbr-printer-node
npm run build:libxml2
```

O caminho `/mnt/c/projetos` é apenas um exemplo para um clone em `C:\projetos`. A saída fica em `.deps/windows-libraries/libxml2.dll`, acompanhada de licença e proveniência dos fontes. O build nativo completo verifica essa dependência antes de distribuir o runtime.

Em seguida, no PowerShell, use o widgetset Win32 e informe o compilador FPC instalado, ajustando os caminhos à instalação:

```powershell
npm run build:native -- --lazarus 'C:\lazarus' --fpc 'C:\lazarus\fpc\3.2.2\bin\x86_64-win64\ppcx64.exe' --widgetset win32
$env:ACBR_PRINTER_NATIVE_TEST = '1'
$env:ACBR_PRINTER_PDF_TEST = '1'
npm test
npm run test:package
```

Também é possível informar uma DLL x64 já disponível com `--libxml2 'C:\dependencias\libxml2.dll'` no comando `build:native`; mantenha a licença adjacente `libxml2.dll.LICENSE`. O script não procura DLLs silenciosamente no projeto fiscal. A variante `--pos-only` não precisa dessa biblioteca, pois não inclui DANFE/PDF.

O motor usa o spooler da conta executora. Os testes acima geram bytes e PDFs sintéticos, sem enviar trabalhos à impressora. Para o envio físico, use os exemplos com `--enviar` somente quando desejar imprimir.

Os caminhos do compilador e dependências também podem ser consultados em `node scripts/build-native.mjs --help`. `capacidades()` informa os recursos realmente compilados; a API não anuncia um renderer ausente como disponível.

O teste de pacote instala um tarball local auditado em consumidor temporário **fora do repositório**, com scripts desabilitados e sem buscar dependências na rede. Verifica ESM/CommonJS e, havendo runtime da plataforma, capacidades e geração de bytes sem enviar trabalhos à impressora. Não publica no npm.

Mais detalhes: [arquitetura](docs/ARQUITETURA.md), [validação](docs/VALIDACAO.md) e [worker nativo](native/BUILD-NOTES.md).

## Licenças e fontes

O código deste projeto é LGPL-2.1-or-later. As fontes públicas ACBr e seus avisos originais são preservados. O snapshot oficial FortesReport inclui `LICENSE` Apache-2.0 e unidades com cabeçalhos históricos LGPL; os arquivos e avisos correspondentes acompanham o runtime. Veja [LICENSE](LICENSE), [NOTICE](NOTICE) e `runtime/<plataforma>/licenses` e `sources`.

Referências: [ACBr público](https://projetoacbr.com.br/fontes/), [SVN oficial ACBr](https://svn.code.sf.net/p/acbr/code/trunk2/) e [snapshot FortesReport](https://github.com/fortesinformatica/fortesreport-ce/tree/888e387faca5a691b246a6b493776b8435be59f3).
