# Arquitetura de impressão

`cosmemilton-acbr-printer-node` é um pacote separado do emissor `cosmemilton-acbr-node`. A separação mantém impressoras, spooler, renderer gráfico e seus requisitos opcionais para quem só precisa emitir documentos fiscais. A aplicação pode usar os dois pacotes, mas nenhum deles exige que o outro esteja instalado.

## Fachada e backends

`criarImpressora` oferece três caminhos no mesmo contrato Node:

1. ACBrPosPrinter gera bytes em `gerarEscpos` ou os envia em `imprimirTexto` com `modo: 'escpos'`.
2. FortesReport monta um relatório gráfico de texto e o envia pelo spooler em `imprimirTexto` com `modo: 'spooler'`.
3. O adaptador DANFE carrega XML existente. O modelo 55 usa o renderer NF-e/Fortes; modelo 65 pode usar NFC-e/Fortes ou DANFE ESC/POS conforme o destino. `danfePdf` retorna PDF em memória.

O tipo da linguagem POS é distinto do transporte. `0` é `ppTexto`; `8` é `ppEscPosStar`. O compartilhamento Windows `\\localhost\elgin` pode usar a emulação 8 informada pelo usuário, independentemente do nome da fila. O spooler gráfico recebe o nome instalado, como `ELGIN`.

## Processo nativo

O cliente TypeScript inicia um worker Free Pascal/Lazarus por operação. Não há FFI, addon C++ ou vínculo ao ABI de uma versão do Node. O executável recebe uma requisição JSONL em stdin; texto e XML não são colocados nos argumentos do processo.

```text
Aplicação Node
  → criarImpressora / validação / fila por destino
  → worker Free Pascal via pipes JSONL
      → ACBrPosPrinter
      → FortesReport e spooler
      → XML local + renderer DANFE/PDF
  ← resultado JSONL / Buffer de bytes ou PDF
```

O worker retorna versão de protocolo 1, ID da operação, revisão ACBr, sucesso/estado e indicador de envio. Antes de uma operação física, emite o marcador `envioIniciado`. O cliente valida identidade, tipos, tamanho e framing da resposta; bytes e PDF atravessam o protocolo em Base64 e são expostos também como `Buffer`.

O runtime é resolvido por `runtimeDirectory`, pacote de runtime específico da plataforma, ou diretório distribuído `runtime/<plataforma>-x64` do próprio pacote. O manifesto registra plataforma, arquitetura, revisão 48590, executável e hashes SHA-256. Arquivos divergentes ou caminhos que escapam do runtime são recusados.

## Concorrência e falhas

Dentro do processo Node, instâncias que apontam para o mesmo destino compartilham uma fila serial. Destinos diferentes podem operar separadamente. `limiteFila` impede crescimento ilimitado dos trabalhos pendentes da instância; `AbortSignal`, timeout e `fechar()` cancelam somente operações/processos de propriedade da instância.

Uma fila instalada e um compartilhamento local podem ter nomes diferentes; a aplicação deve usar identificadores consistentes quando diferentes nomes representam a mesma impressora. O cliente normaliza aliases locais Windows conhecidos, mas não descobre equivalências arbitrárias entre drivers/compartilhamentos. A fila JavaScript também não funciona como bloqueio global entre processos Node independentes.

`ENVIADO` descreve o retorno do componente após submissão/envio. Não garante impressão física. Timeout, cancelamento ou interrupção após envio iniciado/possível podem ter resultado incerto. A biblioteca não repete automaticamente o trabalho, evitando duplicação silenciosa de cupons.

## Integração fiscal opcional

O adaptador recebe XML UTF-8, bytes ou um objeto com `xmlBase64`. Somente esse campo do resultado fiscal é usado. Certificado, CSC, configuração de emitente e estado de comunicação fiscal não são entradas de impressão.

Não é feita chamada à SEFAZ, assinatura, autorização ou alteração do XML para conseguir imprimir. Renderização não substitui a situação fiscal do documento. A aplicação permanece responsável por selecionar o XML que deseja apresentar e por decidir quando imprimir.

## Plataformas e variantes

Windows x64 usa o widgetset Win32 e as filas visíveis à conta executora. Destinos UNC Windows exigem que Node e o worker executem no Windows; o cliente rejeita esses destinos em operações físicas no Linux/WSL.

Linux x64 completo usa GTK2, fontes, bibliotecas gráficas e display. Xvfb oferece display virtual para renderização/testes sem tela. A variante `--pos-only --widgetset nogui` elimina Fortes/DANFE e atende apenas geração/envio POS. `capacidades()` descreve os recursos realmente compilados.

As fontes ACBr e Fortes ficam fixadas; uma atualização é uma operação explícita de manutenção. O build distribui fontes correspondentes, avisos e informação de reconstrução. Nenhum compilador comercial é necessário.
