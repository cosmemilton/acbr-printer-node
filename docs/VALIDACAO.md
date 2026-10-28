# Estado da validação — 0.1.0

Este arquivo registra testes do novo pacote de impressão. Não representa homologação fiscal ou confirmação de saída física. O emissor existente não foi alterado.

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

O tipo `8` foi exercitado apenas na geração de bytes em arquivo/memória. Não houve teste físico de comandos avançados, corte ou gaveta. O envio gráfico pelo spooler e a impressão física de DANFE ainda precisam de validação no equipamento; a renderização dos dois modelos em PDF já foi testada.

## Distribuição

Não houve publicação npm, alteração de serviço ou transmissão à SEFAZ nesta etapa. A instalação deve usar os tarballs locais auditados. A disponibilidade efetiva de recursos deve ser consultada em `capacidades()`, principalmente quando o runtime foi compilado com `--pos-only`.
