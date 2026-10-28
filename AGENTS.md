# ACBr Printer Node

Pacote independente de impressão, TypeScript + Free Pascal/Lazarus, sem Delphi ou ACBr Pro. A integração com cosmemilton-acbr-node é opcional por XML; não modificar o emissor fiscal nem o Integrador.

- Backends separados para ACBrPosPrinter (texto/ESC-POS), FortesReport/spooler e DANFE a partir de XML.
- Modelo POS inicial 0 (ppTexto). Modelo 8 (ppEscPosStar) disponível para validação posterior; não inferir a emulação pelo nome da impressora.
- Não imprimir nem abrir gaveta/cortar papel em testes automatizados. Não transmitir notas à SEFAZ. Testes de hardware devem ser explícitos.
- Retorno ENVIADO significa entrega ao transporte, sem confirmação física. Falha após início deve preservar resultadoIncerto; não repetir automaticamente.
- Destinos UNC e nomes de filas são recursos do Windows onde o worker executa. Nunca converter silenciosamente UNC em caminho Linux.
- Dependências fixadas e avisos de licença preservados. Testar ESM/CJS do pacote instalado externamente e protocolo/motores das plataformas disponíveis.
- Não publicar npm nem criar repositório remoto sem solicitação do usuário.
