# Publicação revisada no npm

O workflow `Stage reviewed npm release` executa na branch `release`. Ele usa somente o token cadastrado em **Settings → Secrets and variables → Actions → NPM_TOKEN**, sem registrar seu valor.

O manifesto `releases/0.1.2.json` fixa nome, versão, commit de origem, tamanho e SHA256 do tarball já testado. A automação recupera esses bytes da GitHub Release ou de uma referência Git temporária e confere novamente o conteúdo, os dois runtimes, fontes e licenças. Não recompila nem reempacota a release durante o envio.

O pacote auditado fica disponível nos assets da GitHub Release `v0.1.2`. A branch temporária `npm-reviewed-0.1.2` pode ser removida depois de conferir o download dos assets; seus arquivos não são incorporados à branch principal.

O envio usa exclusivamente `npm stage publish`. O script consulta versões públicas e stagings existentes antes de submeter; se a mesma versão já estiver publicada ou pendente, confere sua integridade e não repete o envio. Depois de enviar, baixa o staging e compara seus bytes com o tarball revisado. Não há fallback de publicação direta.

A etapa final é do mantenedor: abrir [as configurações da conta npm](https://www.npmjs.com/settings/miltoncosme/packages), selecionar **Staged Packages**, revisar `cosmemilton-acbr-printer-node@0.1.2` e aprovar com 2FA. A existência da GitHub Release não significa que a versão já esteja publicada no npm.

O resumo da execução e o artifact `npm-publication-result-0.1.2` informam o estado e o identificador do staging. Se o envio ficar sem confirmação, consulte o estado no npm antes de tentar novamente. Falhas não provocam uma nova submissão automática.

Referência: [staged publishing do npm](https://docs.npmjs.com/cli/v11/commands/npm-stage/).
