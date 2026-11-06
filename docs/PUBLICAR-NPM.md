# Publicação do ONP Spec no npm

Pacote: `@onovoprogramador/onp-spec` · versão desta entrega: `0.10.0`.
Autoria: **Vitor Manoel — O Novo Programador**.

Em 6 de novembro de 2026, a consulta ao registry retornou `latest: 0.9.0` e
nenhuma publicação de `0.10.0`. Confira novamente antes de publicar: uma versão
já publicada não pode ser substituída. Esta preparação não publica nada.

## 1. Preparar e revisar

Use a raiz deste repositório, com Node.js 18 ou superior. O projeto não possui
dependências de instalação. Os comandos abaixo verificam a versão local e
geram o pacote para inspeção, sem enviar arquivos ao npm:

```sh
npm pkg get name version author
npm run release:check
npm pack --dry-run
```

`release:check` verifica a apresentação pública, reconstrói as cinco skills,
executa a suíte completa e inspeciona a lista final de arquivos. Exige que
README e metadados mantenham a autoria e a marca do projeto; os identificadores
técnicos das integrações continuam no código para preservar compatibilidade.
`prepack` reconstrói o motor antes de empacotar. `prepublishOnly` repete o gate
antes da publicação a partir deste checkout. Não use `--ignore-scripts` para
publicar: ele desativa esses hooks.

Revise e registre as alterações no Git e disponibilize a documentação no
repositório antes de divulgar os links da versão. O arquivo
[ATUALIZACOES-0.10.0.svg](ATUALIZACOES-0.10.0.svg) é o resumo visual pronto para
compartilhar; há também uma [versão textual](ATUALIZACOES-0.10.0.md).

## 2. Entrar na conta autorizada

```sh
npm login --auth-type=web --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

Conclua a autenticação no navegador com uma conta que tenha permissão para
publicar no pacote e no escopo `@onovoprogramador`. Atenda ao pedido de segundo
fator quando o npm solicitar. Não coloque credenciais em arquivos do projeto.

Na consulta inicial desta preparação, `npm whoami` retornou `ENEEDAUTH`.
Antes de publicar, confirme que a consulta identifica uma conta autorizada;
aquele resultado inicial não descreve o estado atual da autenticação.

## 3. Publicar a versão preparada

Confirme que a versão continua disponível:

```sh
npm view @onovoprogramador/onp-spec versions --json --registry=https://registry.npmjs.org/
```

Quando estiver pronto para tornar `0.10.0` pública, execute **na raiz do
repositório**:

```sh
npm publish --access public --registry=https://registry.npmjs.org/
```

Este é o comando que efetivamente publica e atualiza a tag `latest`. Se
`0.10.0` já existir, escolha outra versão e atualize seus artefatos antes de
repetir; não tente sobrescrever a versão publicada.

Confirme a publicação e o executável distribuído:

```sh
npm view @onovoprogramador/onp-spec version dist-tags --json --registry=https://registry.npmjs.org/
npx --yes @onovoprogramador/onp-spec@0.10.0 version
```

## Automação futura

A CI atual valida o projeto, mas não publica. Para automatizar, prefira o
Trusted Publishing com OIDC: ele requer configuração do pacote no npm,
workflow correspondente e permissão `id-token: write`, além de Node.js
22.14.0 ou superior e npm 11.5.1 ou superior. Essa automação não foi criada
nem ativada nesta preparação; o caminho acima usa autenticação interativa.

## Fontes oficiais

- [Publicar um pacote público com escopo](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).
- [Comando npm publish e versões imutáveis](https://docs.npmjs.com/cli/v11/commands/npm-publish/).
- [Ordem dos hooks de publicação](https://docs.npmjs.com/cli/v11/using-npm/scripts/).
- [Autenticação para publicação](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/).
- [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

## Verificação desta preparação

```text
VERIFICATION REPORT
-------------------
Claim: Pacote 0.10.0 preparado e publicação simulada, sem envio ao registry
Command: npm publish --dry-run --access public --registry=https://registry.npmjs.org/; npx --yes node@18 tools/test.mjs; npm pack --json --pack-destination <diretório temporário>; git diff --check
Executed: 2026-11-06, após a preparação dos hooks e da apresentação pública
Exit code: 0
Output summary: Node 22.14.0: tests 347; pass 347; fail 0. Node 18.20.8: tests 347; pass 347; fail 0. Pacote com 267 arquivos; CLI extraída retorna 0.10.0; README e metadados públicos conferidos.
Warnings: npm informou ausência de login durante o dry-run; autenticação necessária para publicar
Errors: none
Verdict: PASS para preparação local; publicação pendente
```

O SVG conserva o checkpoint funcional anterior de 343 testes, identificado por
data e horário. Os quatro testes adicionais acima verificam a preparação de
publicação. A validação local não substitui a matriz remota de sistemas
operacionais. Até o checkpoint acima, nenhum login, commit, push, tag ou
publicação havia sido realizado nesta preparação.
