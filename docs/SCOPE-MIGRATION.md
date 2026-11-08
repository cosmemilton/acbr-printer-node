# Migração npm para @cosmemilton

- Pacote: `cosmemilton-acbr-printer-node` → `@cosmemilton/acbr-printer-node`.
- Versão preparada: 0.1.3, mantendo API e licença. Não foi publicada.
- Os imports dos exemplos usam o novo nome; versões antigas continuam disponíveis e inalteradas.
- Os runtimes continuam embarcados em `runtime/`. Nenhum pacote adicional de runtime de impressão está sendo publicado nesta migração.
- Os scripts de auditoria reconhecem nomes antigo e novo e usam a convenção npm de filename `cosmemilton-acbr-printer-node-VERSAO.tgz` para ambos. Não misture tarballs: seus nomes de arquivo coincidem, mas os manifests internos e hashes diferem.
- `releases/*.json`, changelog histórico e workflow `publish.yml` preservam a evidência da publicação antiga. O workflow não publica o novo escopo; a publicação scoped exige tarball e manifesto novos revisados.
- Verifique build, typecheck, testes e `npm run test:package` antes de publicar. O último comando só gera bytes e consulta capacidades, sem imprimir, cortar ou abrir gaveta.

## Validação desta preparação

Build e typecheck passaram. Testes Node: 39 aprovados e 7 casos específicos de plataforma/nativo não executados nessa rodada. A instalação local do tarball em Linux passou em ESM e CommonJS, verificando os hashes dos runtimes Linux e Windows, capacidades e geração em memória dos 13 modelos ACBr. Nenhuma impressão física foi feita. Os scripts de publicação preservam os manifests antigos e aceitam o nome scoped em novos manifests.

O mesmo tarball foi instalado em uma pasta temporária Windows: imports ESM/CJS, capacidades e geração em memória dos 13 modelos passaram. O runner npm direto sobre UNC falhou por limitação de caminho do npm/Windows; o teste consumidor instalado fora do UNC passou sem alterar confiança do Git ou configurações do sistema.

## GitHub Actions

The publication workflow runs only on the release branch (push or manual dispatch).
Migration branches and pull requests run validation only. A preflight now requires the
reviewed manifest name and version to match package.json, preventing the historical
unscoped 0.1.3 bundle from being resubmitted after this migration. Before enabling a
future scoped release, prepare its own reviewed manifest, transport bundle, and unique
release tag/assets. Do not overwrite the existing v0.1.3 release or reuse its hashes.
No token, secret, trusted publisher, or credential permission was changed.
