# Estado da validação

Este arquivo registra testes do novo pacote de impressão. Não representa homologação fiscal ou confirmação de saída física. O emissor existente não foi alterado.

## Serial e layout — 0.1.2, 30/10/2026

- TypeScript estrito e builds ESM/CommonJS aprovados.
- Runtimes completos recompilados: Linux x64/GTK2/Fortes/DANFE e Windows x64/Win32/Fortes/DANFE.
- Suíte Linux com motor real: 39 testes passaram; um teste exclusivo de dependência Windows não se aplica.
- Suíte Windows: 38 testes passaram; o caso UNC exclusivo do Linux não se aplica e o teste de DLL ausente foi executado separadamente, com aprovação.
- Bytes POS0/8, corte somente opt-in, PDFs sintéticos55/65 e configurações serial/layout foram exercitados sem destino físico.
- Novas opções são normalizadas em snapshots independentes, validam faixas/enumerações e recusam runtime antigo sem o recurso exigido no manifesto.
- A escala gráfica mantém a fonte padrão9pt com DPI próprio do renderer e altera fonte/espaçamento efetivos; não modifica DANFE ou bytes POS.
- Nenhuma impressão física, gaveta ou chamada fiscal foi executada nesta revisão.

## Confirmado em 28/10/2026

- Inspeção do emissor existente: TypeScript com worker Free Pascal/Lazarus e integração possível por `xmlBase64`.
- ACBrPosPrinter identifica `ppTexto = 0` e `ppEscPosStar = 8` nas fontes utilizadas.
- A API TypeScript passou em `tsc --noEmit`, usando Node Linux 24.15.0 e as dependências locais de desenvolvimento.
- O transporte do novo cliente usa pipes JSONL, `shell: false` e `windowsHide: true`; texto/XML não entram em argumentos.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| Build ESM/CommonJS e declarações | Passou com TypeScript estrito |
| Suíte automatizada Linux | 20 passaram; inclui o motor real |
| Suíte automatizada Windows | 19 passaram; 1 caso específico de rejeição UNC no Linux não se aplica |
| Worker Linux completo GTK2/Fortes/DANFE | Compilou com Free Pascal 3.2.2 e Lazarus 3.0 |
| Worker Windows x64/Fortes/DANFE | Compilou com Free Pascal 3.2.2 e Lazarus 4.8 |
| Geração tipo 0 e tipo 8 para arquivo/memória | Passou nas duas plataformas, sem destino físico |
| PDF de XML sintético NF-e/NFC-e | Modelos 55 e 65 gerados pelo Fortes nas duas plataformas |
| Instalação offline fora do repositório, ESM e CommonJS | Resultado registrado na auditoria do tarball local |

`npm run test:package` produz um tarball local, registra hashes, instala com scripts desabilitados em consumidor temporário fora do repositório e testa os formatos de módulo. Se o runtime da plataforma estiver presente, também consulta capacidades e gera bytes offline. Linux GTK2 deve executar esse teste com display/Xvfb.

## Impressora do usuário

Destino informado: compartilhamento Windows `\\localhost\elgin`; nome de fila para spooler `ELGIN`/`elgin`, conforme enumeração do sistema. A etapa inicial usa tipo `0` para texto. O tipo `8` fica disponível para a verificação posterior dos comandos avançados.

Nenhum dos exemplos envia um trabalho físico sem `--enviar`. Foi enviado um único cupom não fiscal, tipo `0`, pelo ACBrPosPrinter para `\\localhost\elgin`. O motor retornou `ENVIADO` e o usuário confirmou que o papel saiu legível. A fila foi identificada como `ELGIN`, driver `ELGIN i9(USB)`, porta `USB001`.

Na etapa 0.1.0, o tipo `8` foi exercitado apenas na geração de bytes em arquivo/memória. O teste físico especializado da versão 0.1.1 está registrado abaixo; não houve acionamento de gaveta. O envio gráfico pelo spooler e a impressão física de DANFE ainda precisam de validação no equipamento; a renderização dos dois modelos em PDF já foi testada.

## Distribuição

Esse registro refere-se à preparação inicial de28/10. A disponibilidade de uma versão no npm deve ser conferida no registry; versões novas seguem o fluxo de staged publishing documentado em PUBLISHING.md. Não houve alteração de serviço ou transmissão à SEFAZ nesses testes. A disponibilidade efetiva de recursos deve ser consultada em `capacidades()`, principalmente quando o runtime foi compilado com `--pos-only`.

## Teste especializado — 0.1.1

O tipo `8` recebeu teste físico explícito em `\\localhost\elgin`, com um único cupom não fiscal. Antes do envio, o motor ACBr gerou 877 bytes e a conferência identificou 14 comandos: negrito, sublinhado, expandido, altura dupla, tamanho combinado, condensado, invertido, três alinhamentos, QR Code, Code128, EAN13 e exatamente um corte total. O avanço antes do corte foi configurado em cinco linhas. Não houve abertura de gaveta ou beep.

O envio retornou `sucesso: true`, `ENVIADO`, `envioIniciado: true` e `resultadoIncerto: false`. O usuário confirmou que tudo funcionou e os códigos foram lidos: corte total, estilos e alinhamentos corretos; QR Code `ACBR-TESTE-TIPO8`, Code128 `ACBR123456` e EAN13 `7891234567895`. Essa confirmação física foi recebida em 28/10/2026.

`cortarPapel` é uma nova opção booleana com padrão `false`. Os testes de geração confirmaram que o comando de corte só aparece com habilitação explícita. O exemplo `examples/escpos-avancado.mjs` gera e verifica os comandos por padrão; só imprime com `--enviar`.
