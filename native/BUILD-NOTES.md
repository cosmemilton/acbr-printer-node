# Worker nativo Free Pascal/Lazarus

O worker lê exatamente uma requisição JSONL de stdin, emite no máximo um marcador
`{"tipo":"envioIniciado","id":"..."}` e uma resposta JSONL, e encerra. O Node
deve executar um processo separado por operação e serializar jobs por impressora.
O marcador deve ser consumido mesmo que o processo morra antes da resposta final.

Não há uso de Delphi, ACBrPro, certificado ou chamada fiscal. O adaptador DANFE
carrega um XML local com `NotasFiscais.LoadFromString(XML, False)` e só chama
métodos de impressão/renderização.

## Variantes

- Base: `ACBrPosPrinter`, `Printers`, `Interfaces`, `Forms` e FCL JSON/base64.
- `-dACBR_PRINTER_FORTES`: inclui `RLReport`, `RLPrinters`, `RLTypes`; habilita
  relatório de texto gráfico pelo spooler.
- `-dACBR_PRINTER_NFE`: inclui `ACBrNFe`, `ACBrNFeDANFeESCPOS` e dependências;
  habilita DANFE NFC-e por ESC/POS.
- Ambos os defines: inclui também `ACBrNFeDANFeRLClass` e
  `ACBrDANFCeFortesFr`; habilita PDF e impressão Fortes de modelo 55/A4 e
  modelo 65/bobina. A resposta `capacidades` informa o que realmente foi compilado.

As unidades ACBr devem vir da revisão 48590 fixada pelo projeto. O motor confere
em runtime `Ord(ppTexto)=0` e `Ord(ppEscPosStar)=8`. O tipo não é deduzido pelo
nome do driver: `elgin` pode trabalhar com o perfil 8 informado pelo usuário.

O build precisa dos diretórios Fontes/ACBrComum, Fontes/ACBrSerial,
Fontes/ACBrDFe e dependências transitivas já usadas pelo emissor. Para o DANFE,
adicione ACBrDFe/ACBrNFe e DANFE/NFe/Fortes, DANFE/NFCe/Fortes,
DANFE/NFCe/EscPos, além dos caminhos dos pacotes Lazarus. Fortes deve ser a
versão para Lazarus/FPC, com Printer4Lazarus, LCL e um widgetset adequado.

O widgetset `nogui` serve para testes de geração ESC/POS para arquivo. Renderização
Fortes precisa ser validada com widgetset que implemente canvas/fontes (Win32 no
Windows; por exemplo GTK2/Qt com ambiente gráfico/virtual no Linux). Declarar
`ACBR_PRINTER_FORTES` sozinho não torna o backend gráfico executável em qualquer
widgetset. Build Windows deve usar unidade `Interfaces`/widgetset Win32 e o
spooler do usuário que executa o processo.

## Unidades e comportamento

`larguraPapel` é informada em milímetros. Fortes usa milímetros em PageSetup;
`LarguraBobina` do ACBr usa pixels a 96 dpi, portanto recebe a conversão.
`gerarEscpos` ignora destinos externos: cria exclusivamente arquivo temporário
próprio, retorna bytes em base64 e remove esse arquivo. `danfePdf` usa memória
e devolve o PDF em base64, sem aceitar caminho de entrada/saída.

Texto e XML decodificado aceitam até 2 MiB cada; a linha JSONL tem limite de
8 MiB aplicado durante a leitura, antes de alocar conteúdo sem limite. Stdin e
stdout usam UTF-8 também no Windows. O nome do spooler é comparado sem diferenciar
caixa e normalizado para o nome exato enumerado (`elgin` pode resolver `ELGIN`).

O modo texto não interpreta tags por padrão, não seleciona página de código e
não solicita corte/gaveta. Texto só aceita controles TAB/CR/LF. Mesmo no tipo 8,
corte e gaveta não são disparados implicitamente. A sintaxe de tags é opt-in.

`ENVIADO` só confirma que o componente retornou depois do envio, nunca que o papel
foi fisicamente impresso. Falha depois do marcador é `resultadoIncerto: true` e
não deve provocar repetição automática.

Testes automatizados devem usar somente `capacidades`, `gerarEscpos`, XML/PDF
local e entradas inválidas. Não imprimir e não abrir destinos de produção.
