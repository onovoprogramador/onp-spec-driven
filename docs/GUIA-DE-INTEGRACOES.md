> **Guia técnico de integrações.** Este documento preserva a documentação técnica anterior, incluindo os identificadores, diretórios e capacidades de cada harness. Os comandos partem da raiz do projeto. A atualização não migra nem reescreve specs ou documentos existentes. Para a apresentação do produto, consulte o [README principal](../README.md).

# onp-spec-driven

**A especificação continua verificável enquanto o código evolui.** A skill
pesquisa, documenta, planeja e implementa features com rastreabilidade entre
pedido, decisão, requisito, tarefa e teste. O test runner produz a prova;
`audit --ci` verifica o alinhamento.

## O que muda nesta atualização

- **Cinco harnesses:** Claude Code, Codex, Cursor, Antigravity e OpenCode.
  Cada variante usa ferramentas, perguntas, agentes e notificações nativos
  disponíveis na sessão. Novas execuções usam esse acompanhamento; arquivos
  HTML antigos permanecem preservados.
- **Menos custo de acompanhamento:** atualizações por eventos no plano/tarefas
  do harness; sem chamadas extras de IA a cada minuto para produzir resumos.
- **Execução portável:** executor Node.js para macOS, Linux e Windows, com
  isolamento por worktree, estado persistido e retomada da mesma execução.
- **Reserva de 5%:** consulta de cota real, pausa, timer e nova consulta antes
  de retomar. Sem dados do fornecedor, o estado é desconhecido; a skill não
  inventa saldo nem promete proteção que não consegue observar.
- **Documentação completa para novas features grandes:** PRD nas palavras do cliente,
  ADR, TDD em `design.md`, research, spec e tarefas, com links entre si.
- **Decisão antes de impacto:** interferência em domínio anterior ou conflito
  com PRD/ADR exige alerta e pergunta nativa; decisões ficam registradas.
- **Compatibilidade:** instalação e geração de novos planos preservam artefatos
  existentes. Specs antigas não recebem exigências documentais retroativas.
- **Encerramento com controle:** a skill pergunta se deve limpar os worktrees
  usados na sessão. Trabalho ativo, sujo ou não integrado é preservado.

## Instalação por projeto

Na raiz do projeto, escolha seu harness:

| Harness | Comando | Diretório instalado |
|---|---|---|
| Claude Code | `npx @onovoprogramador/onp-spec init --agents claude` | `.claude/skills/onp-spec-driven/` |
| Codex | `npx @onovoprogramador/onp-spec init --agents codex` | `.agents/skills/onp-spec-driven/` |
| Cursor | `npx @onovoprogramador/onp-spec init --agents cursor` | `.cursor/skills/onp-spec-driven/` |
| Antigravity | `npx @onovoprogramador/onp-spec init --agents antigravity` | `.agents/skills/onp-spec-driven/` |
| OpenCode | `npx @onovoprogramador/onp-spec init --agents opencode` | `.opencode/skills/onp-spec-driven/` |

`init` cria os arquivos ausentes da estrutura `.spec/` e instala a skill com
o motor embarcado, preservando arquivos e customizações existentes.
A partir daí, não depende de npm ou CLI global: basta Node.js ≥ 18. Abra uma
nova conversa e peça “especifica a feature X” ou “audita esta implementação”.
A skill também pode ser invocada explicitamente pelo mecanismo do harness.

Se a instalação do mesmo harness já existe e difere da nova, `init` mantém a
anterior e instala ao lado em `onp-spec-driven-<harness>-v<versao>`, com o nome
da skill correspondente à pasta (por exemplo `onp-spec-driven-codex-v4-0-0`).
Invoque explicitamente a versão pretendida;
não há mescla automática de arquivos. Codex e Antigravity compartilham
`.agents/skills/`: com outro harness ocupando o destino, o instalador informa
o conflito. `--nova-versao` permite um destino separado. Cursor e OpenCode
podem ler diretórios compatíveis; confira `metadata.agent` e o nome invocado.

### Instalação manual e global

Para uma instalação manual nova, copie a pasta correspondente da coluna
“origem” para um **destino vazio** no projeto ou no diretório global abaixo.
O nome da pasta deve corresponder ao `name` do `SKILL.md`; a variante distribuída
usa `onp-spec-driven`. Copie o conteúdo inteiro, incluindo `scripts/`. Se já
houver uma instalação, prefira `init` para criar a versão separada; não copie
por cima dela. O gerenciador de arquivos serve em qualquer sistema.

| Harness | Origem no repositório | Diretório global de destino |
|---|---|---|
| Claude Code | `skills/onp-spec-driven/` | `~/.claude/skills/onp-spec-driven/` |
| Codex | `skills/onp-spec-driven-codex/` | `~/.agents/skills/onp-spec-driven/` |
| Cursor | `skills/onp-spec-driven-cursor/` | `~/.cursor/skills/onp-spec-driven/` |
| Antigravity | `skills/onp-spec-driven-antigravity/` | `~/.gemini/config/skills/onp-spec-driven/` |
| OpenCode | `skills/onp-spec-driven-opencode/` | `~/.config/opencode/skills/onp-spec-driven/` |

`~` representa sua pasta de usuário. Se o harness usa um diretório de
configuração personalizado, use o local indicado por ele. A configuração e os
documentos `.spec/` continuam sendo de cada projeto.

## Preservação do trabalho existente

Atualizar a skill não migra specs, PRDs, ADRs, designs, research, constituição,
configuração, planos ou scripts existentes. O padrão completo vale para novos
artefatos; não há exigência retroativa de TDD/PRD/ADR nem de novos links em
documentos antigos. A implementação já autorizada continua com seus contratos.

Quando você pedir uma revisão, o agente prepara uma proposta em versão
separada, mostra o que muda e preserva o original. Documentos e domínios
anteriores continuam sendo referências de leitura para avaliar o impacto de
trabalho novo. Os links novos apontam para os originais sem alterá-los.

## Uso

Você pode pedir diretamente:

> “Pesquise como os concorrentes resolvem isso e proponha uma solução.”
>
> “Crie o PRD com minhas palavras, registre as decisões e desenhe o TDD.”
>
> “Execute as tarefas independentes em paralelo usando meu harness.”
>
> “Se atingir a reserva de créditos durante a noite, aguarde o limite voltar.”
>
> “Confira se essa mudança afeta alguma regra de uma feature anterior.”

O agente usa os comandos abaixo; eles também estão disponíveis pelo pacote
standalone ou pelo motor da skill:

```text
node <dir-da-skill>/scripts/onp-spec.mjs new minha-feature --grande --cliente "Pedido original do cliente"
node <dir-da-skill>/scripts/onp-spec.mjs harness --agents opencode
node <dir-da-skill>/scripts/onp-spec.mjs plano minha-feature --agents opencode
node <dir-da-skill>/scripts/onp-spec.mjs executar minha-feature
node <dir-da-skill>/scripts/onp-spec.mjs verify minha-feature
node <dir-da-skill>/scripts/onp-spec.mjs audit --ci
```

Para novas especificações grandes, o conjunto em `.spec/features/<feature>/` inclui:

| Arquivo | Papel |
|---|---|
| `prd.md` | Pedido literal, problema, objetivos, restrições e métricas do cliente |
| `adr.md` | Decisões arquiteturais, alternativas, consequências e autorização |
| `design.md` | TDD completo: arquitetura, contratos, dados, segurança, performance, testes e rollout |
| `research.md` | Concorrentes, fontes, dados, hipóteses, análise e recomendação |
| `spec.md` | Histórias e critérios de aceite observáveis |
| `tasks.md` | Tarefas com requisitos, arquivos e dependências |

Criar os arquivos não equivale a aprová-los. O agente preenche os templates,
revisa impactos e consulta o cliente quando necessário. Todo `design.md` novo
segue a estrutura completa, mesmo para uma mudança menor; designs existentes
permanecem no formato original. O padrão é
inspirado na skill da Tech Leads Club solicitada como
`technical-design-doc-creator`, atualmente
[create-technical-design-doc](https://github.com/tech-leads-club/agent-skills/blob/main/packages/skills-catalog/skills/%28creation%29/create-technical-design-doc/SKILL.md).

Research diferencia observação, hipótese e estimativa. Sem dados suficientes,
o resultado é inconclusivo e propõe coleta; não fabrica amostras, retorno
financeiro ou significância estatística. Mudança de escopo continua sendo uma
decisão do cliente.

Para registrar a revisão semântica e a decisão já recebida do cliente:

```text
onp-spec impacto minha-feature
onp-spec impacto minha-feature --revisao revisao.json
onp-spec impacto minha-feature --decisao resposta.json
```

A revisão informa `summary`, `reviewer` e `conflicts` (cada um com `id`,
`summary`, `rule`). A decisão informa `conflictId`, `choice`
(`prosseguir`/`ajustar`/`cancelar`), `answer` literal e `source` da resposta.
O motor não cria aprovação: sem decisão válida, a tarefa continua pendente.

## Harness, modelos e créditos

O comando `harness --agents <id>` consulta capacidades, modelos e cota usando
as fontes disponíveis. Modelos escolhidos para headless precisam existir no
harness/conta atuais; não há uma lista fixa de modelos presumidos. Preferências
e autorizações já dadas são respeitadas; uma troca que aumenta custo exige
nova escolha quando ainda não autorizada.

| Harness | Headless | Fonte de modelos | Cota quando exposta |
|---|---|---|---|
| Claude Code | `claude -p` | Inicialização nativa de controle/SDK | Statusline oficial e `/usage` |
| Codex | `codex exec` | App-server `model/list` | `account/rateLimits/read` |
| Cursor | `agent -p` | `--list-models` | Ponte para fonte oficial do cliente/provedor |
| Antigravity | `agy -p` | `agy models` | `/usage` e quota buckets da statusline |
| OpenCode | `opencode run` | `opencode models --refresh` | Fonte oficial do provedor conectado |

Capacidades dependem de versão, plano e autenticação. O motor não acessa
endpoints privados de billing nem lê credenciais para adivinhar saldo. Consulte
as referências por harness dentro de cada skill para fontes e limitações.

Com **5% ou menos restantes**, a execução suspende despachos e preserva seu
estado. Usa o reset informado ou backoff para consultar novamente, retomando
somente após evidência de liberação. Tokens de contexto não são créditos.
Falha de autenticação/pagamento não vira retry infinito.

Para continuar à noite, o processo ou scheduler nativo precisa permanecer
operante. Desligar a máquina interrompe timers locais; o checkpoint permite
retomada posterior. Um timer vencido sozinho não prova que a cota voltou.
Se a primeira consulta não fornece percentual recente, o executor bloqueia o
despacho com `QUOTA_UNAVAILABLE`, sem inferência. Claude Code, Cursor,
Antigravity e OpenCode precisam de uma ponte para dados nativos do
cliente/provedor (`paralelo.quotaCommand`); Codex consulta o app-server.
Após um limite confirmado, falha de telemetria mantém a execução em espera
até nova leitura comprovar liberação.

### Contrato das pontes nativas

Em `onpspec.config.json`, as pontes são vetores de argumentos, sem interpretação
por shell. Elas devem consultar a fonte oficial já acessível na instalação:

```json
{
  "paralelo": {
    "quotaCommand": ["node", "tools/read-native-quota.mjs"],
    "notifications": {
      "enabled": true,
      "command": ["node", "tools/notify-native-harness.mjs"]
    }
  }
}
```

Os caminhos são exemplos de adaptadores da instalação, não scripts incluídos
nem consultas simuladas. A ponte de cota recebe no stdin um JSON com `action`,
`harness`, `model` e, quando conhecido, `accountId`. Deve devolver um objeto
com `harness`, `observedAt` (instante real da consulta em ISO 8601) e `windows`.
Cada janela contém `id`, `remainingPercent` entre 0 e 100, `resetAt` quando
informado pelo provedor e `blocked` quando explicitamente bloqueada. Percentual
ou reset desconhecido usa `null`; não renove o timestamp de um dado antigo.
Os campos nativos documentados de Codex/Claude/Antigravity também são normalizados.

`modelsCommand`, quando necessário, segue o mesmo contrato de stdin e retorna
`models` com `id`, `isDefault` e esforços suportados. `notifications.command`
recebe eventos `task.completed`/`execution.completed`, com `harness`, `runId`,
`feature` e, conforme o evento, `task`/`success`; só é chamado quando habilitado.
Conecte à notificação do harness, preservando as preferências existentes.
O diagnóstico `harness --agents <id>` permite conferir a integração antes de
iniciar qualquer implementação.

## Paralelismo, acompanhamento e limpeza

O plano reúne arquivos disjuntos em faixas isoladas. `--paralelizar T-001,T-003`
seleciona tarefas; `--sequencial` mantém a ordem. O agente apresenta a
recomendação e usa sua autorização existente ou pergunta pelo recurso nativo.

Acompanhe no plano/lista de tarefas do harness. Notificações de conclusão usam
as preferências já habilitadas. Para consulta pontual, `resumo <feature>` e
`resumo <feature> --tabela` continuam disponíveis, sem painel HTML nem modelo
extra narrando o progresso.

O primeiro plano nativo usa os caminhos históricos da feature somente quando
nenhum artefato de plano existe. Havendo Markdown, JSON, script ou HTML anterior,
o plano novo fica em `.spec/features/<feature>/execucoes/<runId>/`. Os arquivos
anteriores são preservados, inclusive scripts e HTML. Uma atualização da skill
não exige regenerar planos legados.

Se uma revisão de escopo for solicitada, crie uma versão separada do plano para
esse trabalho. O executor nativo recusa fontes desatualizadas e confere se
commits de faixas concluídas continuam integrados antes de retomar.

`executar <feature>` seleciona o plano nativo mais recente; `--run <id>` fixa
uma execução. Também é possível usar `node <caminho-do-executor-gerado>` com o
caminho exibido por `plano`; o wrapper gerado fixa seu `runId`. Scripts legados
permanecem disponíveis nos caminhos originais e mantêm seu comportamento;
as garantias novas de cota/checkpoint são do executor nativo desta versão.
Para inspecionar/retomar um alvo,
use `--listar`, `--faixa <id>`, `--seq <T-xxx>` ou `--gate`. Não apague estado e
worktrees para resolver uma espera de cota.

Ao fim da sessão, `worktrees <feature>` lista as execuções arquivadas com seus
`runId`, mesmo quando existe uma versão mais nova do plano. A skill identifica as
execuções usadas na sessão e pergunta se você quer limpá-las. Use
`worktrees <feature> --run <id> --limpar --confirmar` somente após essa decisão.
Com várias execuções, `--run` é obrigatório; a listagem pode ser filtrada pelo
mesmo argumento. A limpeza preserva worktree ativo, alterações locais
e commits não integrados; sem resposta, tudo fica preservado.

## Prova e desenvolvimento

Cada história, critério e tarefa tem código rastreável. O teste anotado
`@spec:AC-xxx` precisa passar em `verify`; skip/todo não conta. O audit também
verifica princípios da constituição, perguntas, suposições e drift. A revisão
semântica dos contratos complementa o gate mecânico.

Para desenvolver o motor e regenerar as cinco skills:

```text
node tools/build-skill.mjs
npm test
```

As [medições de performance](../benchmark/PERFORMANCE.md) incluem método, dados brutos
e limites. A matriz de CI cobre Linux/macOS/Windows e Node 18/20/22; sua
configuração não substitui os resultados dos jobs.

O [benchmark](../benchmark/RESULTS.md) documenta um conjunto limitado de cenários
mecânicos; seus resultados não estabelecem superioridade geral nem substituem
medidas no produto do cliente. Há um [exemplo executável](../examples/inscricao-turma)
e detalhes em [ARQUITETURA.md](../ARQUITETURA.md).

Node.js ≥ 18 e Git para worktrees; headless exige o CLI do harness autenticado
na plataforma suportada por ele. O motor não tem dependências de produção.

MIT © Vitor Manoel — O Novo Programador
