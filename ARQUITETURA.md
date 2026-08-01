# Arquitetura — onp-spec-driven

> Documento interno de design. Atualizado conforme o projeto evolui.
> Status do build: ver PROGRESS.md

## Tese

Todas as ferramentas de SDD existentes são **spec-first**: a spec gera o código e depois vira mentira.
A onp-spec-driven é **spec-anchored**: a spec é auditável contra o código, mecanicamente, em CI.

| Concorrente | O que faz | O que NÃO faz |
|---|---|---|
| spec-kit (GitHub) | Templates ricos (US priorizadas, given-when-then, FR-xxx), CLI de scaffolding em Python | Testes são OPCIONAIS no template; nenhuma verificação mecânica; constituição é só prompt |
| OpenSpec | Validador estrutural real (zod + parser md): SHALL/MUST presente, cenários existem, deltas bem-formados | Nunca liga requisito → teste → código; não detecta drift |

## Os 5 diferenciais (critérios de aceite do produto)

1. **Spec-anchored com rastreabilidade total**: US-xxx → AC-xxx → T-xxx → teste anotado.
   `onp-spec audit` responde mecanicamente: "qual AC não tem teste?", "que teste aponta pra AC inexistente?",
   "que arquivo de código não mapeia pra nenhuma task?".
2. **DoD executável**: cada AC nasce como Dado/Quando/Então; `onp-spec scaffold` gera o esqueleto de teste
   com a tag `@spec:AC-xxx` no título; `onp-spec verify` roda os testes e cruza resultado com os ACs.
   Agente não consegue declarar vitória: `audit --ci` sai com código ≠ 0 se um AC estiver sem prova PASS.
3. **Suposições e perguntas como cidadãs de primeira classe**: seções obrigatórias `## Suposições` (ASM-xxx)
   e `## Perguntas em aberto` (Q-xxx) com status. Feature não pode chegar a `implementada` com ASM aberta.
4. **Constituição com níveis de obrigação verificáveis**: P-xxx com [DEVE]/[RECOMENDADO]/[PODE],
   cada DEVE com verificação executável (tag de teste `@principle:P-xxx`, padrão proibido/obrigatório via regex+glob).
   Preset LGPD/educação incluso (dados de menores, notas, auditoria de acesso).
5. **Lições aprendidas com lastro mecânico**: a IA fraseia; o motor valida que a lição cita um
   sinal REAL do histórico (achado de audit / falha de verify) e é dono de dedup, promoção por
   recorrência entre features distintas, quarentena por penalidade, poda e renderização.

## Stack

- Node.js >= 18, ESM puro, **zero dependências**.
- Testes da própria lib: `node:test` nativo.
- **A skill é o artefato principal**, autossuficiente, em QUATRO variantes com
  o MESMO motor e a MESMA versão (`skills/onp-spec-driven/` para Claude Code,
  `skills/onp-spec-driven-codex/` para Codex, `skills/onp-spec-driven-cursor/`
  para Cursor, `skills/onp-spec-driven-antigravity/` para Antigravity;
  marcador `agent:` no frontmatter evita instalar a errada):
  - `SKILL.md` + `references/` — contrato do agente: fluxo
    Especificar → Projetar → Tarefas → Executar → **Auditar**, loop de correção
    limitado a 3 iterações, 1 task = 1 commit, gate com saída colada.
  - `scripts/` — **motor mecânico embarcado** (gerado de `src/` por
    `node tools/build-skill.mjs`; `test/skill-sync.test.js` acusa drift).
    Instalar = copiar a pasta para `.claude/skills/` (Claude Code),
    `.cursor/skills/` (Cursor — Agent Skills nativas desde o Cursor 2.4; o
    `name:` do frontmatter TEM que ser igual ao nome da pasta) ou
    `.agents/skills/` (Codex e Antigravity — compartilham o diretório, por
    isso o marcador). Sem npm, sem npx.
- A **CLI npm** (`bin/onp-spec.js` → `src/`) continua existindo como modo CI
  (`@onovoprogramador/onp-spec`); consome o MESMO `src/`.
- Design da refatoração skill-first: `docs/TDD-skill-harness.md`; achados que a
  motivaram: `docs/ACHADOS-teste-exaustivo.md`.

## Formato dos artefatos (.spec/)

```
.spec/
├── constituicao.md          # P-xxx versionados com verificação executável
├── licoes.json              # lições (estado canônico, escrito só pelo motor)
├── LICOES.md                # lições renderizadas (leitura humana/agente)
├── verification/            # resultados de verify por feature (JSON, máquina)
│   └── sinais.json          # histórico de sinais (lastro das lições)
└── features/<nome>/
    ├── spec.md              # US-xxx, AC-xxx (Dado/Quando/Então), ASM-xxx, Q-xxx
    ├── tasks.md             # T-xxx com Refs: e Arquivos:
    └── design.md            # opcional (features grandes)
```

### spec.md (gramática mínima parseável)

```markdown
# Spec: Entrega de dever de casa
> feature: entrega-dever-casa
> status: rascunho | pronta | em-implementacao | implementada | auditada

## Histórias
### US-001 — Aluno entrega dever
Como aluno, quero..., para que...

#### AC-001 — Entrega dentro do prazo
- **Dado** um aluno autenticado com tarefa aberta
- **Quando** ele envia o arquivo antes do prazo
- **Então** a entrega é registrada com status "no prazo"

## Suposições
| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-001 | Trabalho não pode ser reenviado | aberta | — |

## Perguntas em aberto
| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-001 | Fuso horário do prazo? | respondida | America/Sao_Paulo |
```

Status de ASM: `aberta | confirmada | invalidada`. Status de Q: `aberta | respondida`.

### tasks.md

```markdown
## T-001 — Modelo de Entrega [concluida]
- Refs: US-001, AC-001, AC-002
- Arquivos: src/models/entrega.js
```

Status de task: `pendente | em-andamento | concluida`.

### Anotação de testes (funciona em QUALQUER framework)

A tag vai no TÍTULO do teste (aparece em qualquer reporter) e/ou em comentário no arquivo:

```js
test('AC-001: entrega no prazo @spec:AC-001', () => { ... })
// @principle:P-002 em testes de princípio
```

### constituicao.md

```markdown
# Constituição — v1.0.0

## P-001 [DEVE] Nota de aluno nunca exposta a outro aluno
Todo endpoint que retorna nota filtra pelo aluno autenticado.
- verificação(teste): @principle:P-001
- verificação(proibido): `SELECT \* FROM notas` em `src/**/*.js`

## P-010 [PODE] Exclusão de dados a pedido do titular
```

## Motor de auditoria — catálogo de achados

| Código | Achado | Severidade |
|---|---|---|
| AC_SEM_TESTE | AC sem nenhum teste anotado | ERRO |
| AC_SEM_PROVA | Teste existe mas nunca passou em verify (falhou, foi PULADO — skip não é prova — ou verify obsoleto) | ERRO em --ci, AVISO fora |
| TESTE_ORFAO | Teste anotado com AC inexistente (drift!) | ERRO |
| REF_QUEBRADA | Task referencia US/AC inexistente em QUALQUER spec (IDs/refs são globais) | ERRO |
| US_SEM_AC | História sem critério de aceite | ERRO |
| AC_INCOMPLETO | AC sem Dado/Quando/Então completos | ERRO |
| AC_SEM_TASK | Nenhuma task (de qualquer feature) cobre o AC | AVISO |
| ARQUIVO_ORFAO | Arquivo de src não mapeado por nenhuma task (globs configuráveis) | AVISO |
| ARQUIVO_INEXISTENTE | Task mapeia arquivo que não existe | ERRO se [concluida], AVISO senão |
| TASK_CONCLUIDA_SEM_PROVA | Task [concluida] com AC sem PASS | ERRO |
| TASK_SEM_STATUS | Task sem status explícito (assume pendente) | AVISO |
| TASK_STATUS_INVALIDO | Status de task fora de pendente/em-andamento/concluida (acentos/maiúsculas são normalizados antes) | ERRO |
| ASM_ABERTA | Suposição aberta com feature implementada/auditada | ERRO |
| Q_ABERTA | Pergunta aberta em implementação | AVISO |
| SECAO_AUSENTE | Spec sem seção Suposições/Perguntas em aberto | ERRO com status ≥ pronta, AVISO em rascunho |
| PRINCIPIO_SEM_VERIFICACAO | P [DEVE] sem verificação executável | ERRO |
| PRINCIPIO_VIOLADO | Padrão proibido encontrado / tag de teste ausente | ERRO |
| NIVEL_INVALIDO | Nível de princípio fora de DEVE/RECOMENDADO/PODE (tratado como DEVE, nunca ignorado) | ERRO |
| GLOB_SEM_ARQUIVOS | Verificação da constituição com glob que não casa nenhum arquivo (inerte) | AVISO |
| VERIFICACAO_MALFORMADA | Regex inválida, formato errado ou regex que excedeu o tempo limite (5s, subprocesso) | ERRO |
| FEATURE_DIVERGENTE | `> feature:` difere do nome do diretório | AVISO |
| PROVA_FRACA | Prova concedida só pelo exit code global (reporter exitcode) | AVISO |
| ID_DUPLICADO | Dois elementos com o mesmo ID | ERRO |
| ID_CURTO | ID com menos de 3 dígitos em heading (não reconhecido pela gramática) | AVISO |
| VERIFY_OBSOLETO | Código alterado depois do último verify | AVISO |

Regras de prova (verify): diretivas TAP `# SKIP`/`# TODO` e statuses JSON
`skipped`/`pending`/`todo` viram veredito `skip` — nunca prova. Por tag:
`fail` domina `pass`, que domina `skip`. Reporter `exitcode` só concede prova
a AC com teste anotado, e sempre com o aviso PROVA_FRACA.

## verify — adaptadores de resultado de teste

`onpspec.config.json` → `{ "testCommand": "...", "reporter": "tap" | "vitest-json" | "jest-json" | "exitcode" }`.
Verify roda o comando, extrai resultado POR TESTE, casa títulos com `@spec:AC-xxx` e grava
`.spec/verification/<feature>.json` com {ac, status, teste, timestamp, gitRev}. Audit consome isso.

## Plano de execução (src/core/plano.js)

`onp-spec plano <feature>` transforma o tasks.md em faixas de execução:
tarefas com `Arquivos:` **disjuntos** viram faixas PARALELAS (componentes
conexos do grafo de conflito de arquivos — 1 faixa = 1 git worktree + 1
branch `spec/<feature>-faixa-N` + 1 janela de contexto limpa); tarefas que
compartilham arquivo caem na mesma faixa em sequência; tarefa sem `Arquivos:`
roda sozinha ao final na árvore principal. `paralelo.maxParalelas` (config,
default 3) divide as faixas em ondas. `Modelo:`/`Esforço:` por tarefa (ou
defaults `paralelo.model`/`paralelo.esforco`) alimentam o executor.

O cálculo é agnóstico de agente; os artefatos variam (`--agents`, com
auto-detecção: 1º o marcador `agent:` da própria skill embarcada, 2º o
caminho do motor (`.codex`/`.cursor/skills`/`.agents`/`.claude` — um
checkout em `~/.cursor/worktrees/<repo>` NÃO conta como cursor), 3º a skill
instalada no projeto com precedência `.claude` → `.agents` → `.cursor`;
com mais de uma skill instalada, vale essa ordem — na dúvida, use a flag):

- **sempre**: `plano-execucao.md` — faixas/ondas, gestão de branches e
  commits (1 tarefa = 1 commit `T-xxx <feature>: título`; merge `--no-ff` na
  branch de trabalho `spec/<feature>`; gate final verify + audit).
- **claude**: `executar-tarefas.sh` (headless: `claude -p` por tarefa com
  `--model`/`--effort` + `--output-format stream-json --verbose`,
  permission-mode `paralelo.permissionMode` default acceptEdits + allowedTools
  derivada do testCommand; valida ambiente e árvore limpa; auto-commita
  artefatos do plano; mescla, marca `[concluida]` via `onp-spec tarefa`, fecha
  a contabilidade no git e roda o gate) e `plano-execucao.html` (visual,
  somente leitura).

  O script é um **dispatcher**, não um roteiro linear: cada faixa e cada
  sequencial é uma função, então `--faixa <id>` reexecuta só a que falhou
  (limpando worktree e branch da tentativa anterior antes de recriar),
  `--seq <T-xxx>` refaz uma sequencial, `--gate` roda só o veredito e
  `--listar` mostra os alvos. Cada tentativa é contada e vai para o ledger.
  Enquanto roda, um loop em background imprime no terminal, a cada ~1 min, o
  **resumo geral de andamento** (via `claude -p`, modelo `paralelo.resumoModel`
  default haiku; fallback determinístico) e o grava no ledger — no exit, um
  trap (`pkill -P` no loop, senão o `sleep` órfão segura o stdout de quem
  chamou via pipe) registra o resumo final.
- **codex**: MESMOS artefatos e MESMO dispatcher do claude, trocando o CLI:
  cada tarefa roda `codex exec` com `--model` +
  `-c model_reasoning_effort=<nível>` (o nível `max` do tasks.md vira
  `xhigh`, teto do Codex), saída `--json` (JSONL → stream da tarefa no
  ledger), sandbox `paralelo.sandbox` (default `workspace-write`) e
  `--add-dir <repo>` — o `.git` compartilhado dos worktrees mora no repo
  principal e sem isso o sandbox bloquearia o commit. O resumo por minuto usa
  `codex exec --sandbox read-only --ephemeral` com modelo barato
  (`gpt-5.6-luna` quando `paralelo.resumoModel` ainda é um `claude-*`); o
  default de modelo por tarefa vira `gpt-5.6-terra` quando `paralelo.model`
  é um `claude-*` (um `Modelo: claude-*` explícito no tasks.md é trocado com
  aviso; `--modelo claude-*` na flag é ERRO). Nunca depende do CLI do Claude.

  **Custo é escolha do usuário**: o `plano` do codex imprime "modelos e
  esforços deste plano" (linha por tarefa) e a skill obriga o agente a
  CONFIRMAR com o usuário antes de executar. `--modelo <m>`/`--esforco <n>`
  no `plano` travam TODAS as tarefas (vencem tasks.md e config; entram em
  `modeloForcado`/`esforcoForcado` no plano.json e no "regenere com");
  `onp-spec tarefa <feature> <T-xxx> [status] [--modelo <m>] [--esforco <n>]`
  grava `- Modelo:`/`- Esforço:` na seção da tarefa no tasks.md (substitui se
  existir, insere se não) para ajuste por tarefa.
- **cursor**: MESMOS artefatos e MESMO dispatcher do claude, trocando o CLI:
  cada tarefa roda o CLI do Cursor (`agent -p`, com fallback para o nome
  legado `cursor-agent`) com `--model` por tarefa, saída
  `--output-format stream-json` (NDJSON → stream da tarefa no ledger) e
  `--force` — sem `--force` o modo print do Cursor não modifica arquivos; o
  controle fino é do usuário via `permissions.deny` em `.cursor/cli.json`,
  que vence o `--force`. **Não existe flag de esforço no CLI do Cursor**: o
  nível vai embutido no slug do modelo (ex.: `gpt-5.6-terra-high`), então o
  `Esforço:` do tasks.md é informativo nesse plano (o artefato avisa).
  Modelos `claude-*` são slugs VÁLIDOS no Cursor — nada é trocado; só o
  modelo do resumo por minuto vira `composer` (modelo da casa, uso incluído)
  enquanto `paralelo.resumoModel` for o default `claude-haiku-4-5`. O resumo
  por minuto roda `agent -p` SEM `--force` (somente leitura por construção).
  O plano imprime "modelos deste plano" e a skill obriga o agente a
  CONFIRMAR com o usuário antes de executar (claude-*/gpt-* são cobrados por
  uso no plano do Cursor; a rota de economia é `--modelo composer`). Nunca
  depende do CLI do Claude nem do Codex.
- **antigravity**: o md ganha comandos de worktree e um prompt pronto por
  faixa para os agentes paralelos nativos — nunca depende de CLI nenhum.

**Paralelizar é escolha do usuário — inclusive QUAIS tarefas**: o agente
apresenta o plano como recomendação e pergunta antes de executar.
`--paralelizar T-001,T-003` restringe as faixas às tarefas ESCOLHIDAS (o
resto vai para `sequenciais` com `motivoSeq` "fora da seleção do usuário";
id desconhecido ou seleção vazia é erro amigável; a seleção sai em
`paralelizar` no plano.json e no "regenere com" dos artefatos).
`--sequencial` gera o plano com TODAS as tarefas em `sequenciais` (uma após a
outra, na árvore principal, sem worktrees — `modo: "sequencial"` no
plano.json), reaproveitando o mesmo executor, a mesma disciplina de commits e
o mesmo gate.

`onp-spec tarefa <feature> <T-xxx> <status>` é o utilitário mecânico de
atualização de status usado pelo executor (e por humanos).

O plano também sai em `plano.json` (leitura de máquina) e o script emite uma
trilha de eventos (faixa executando/mesclada/conflito, tarefas, gate, fim,
resumo) para o ledger global — é o que alimenta o `onp-spec resumo`.

## Ledger global (src/core/ledger.js)

Estado de execução NÃO mora no repositório do usuário: mora num **arquivo
único, global**, `~/.onp-spec/painel/ledger.jsonl` (raiz configurável por
`ONP_SPEC_HOME`, o que também isola os testes; o segmento `painel/` no
caminho é herança histórica). Cada linha é um evento (`plano`, `inicio`,
`faixa`, `tarefa`, `gate`, `fim`, `resumo`) carimbado com `runId`,
`projeto`, `projetoDir` e `feature` — então um mesmo ledger cobre quantos
projetos existirem, e `montarArvore()` reconstrói projeto → execução → faixa →
tarefa a partir dele. `podarLedger()` mantém as 30 execuções mais recentes e
apaga os streams das antigas. Linha corrompida é ignorada, nunca derruba a
leitura.

Regra de honestidade embutida na árvore: **trabalho novo invalida o veredito
anterior** (`gateDesatualizado`), então uma execução só aparece "concluída"
com audit fresco em 0. O `--sem-gate` registra `fim: 1` de propósito — sem
audit não existe prova.

O stream de cada tarefa é o JSONL cru do CLI headless — `claude -p
--output-format stream-json --verbose` (eventos system/assistant/user/result),
`codex exec --json` (eventos thread.started/turn.*/item.* — itens
agent_message, reasoning, command_execution, file_change, mcp_tool_call,
web_search, todo_list) ou o CLI do Cursor `agent -p --output-format
stream-json` (system/init, assistant e result no MESMO shape do claude;
ferramentas como eventos tool_call started/completed com corpo em
`tool_call.<nome>ToolCall`, sem usage nem thinking em modo print) — em
`~/.onp-spec/painel/streams/<runId>/<faixa>--<T-xxx>.jsonl`.
`resumirStream()` traduz qualquer um dos três para a MESMA linha do tempo
(`inicio`, `ferramenta`, `pensando`, `saida`, `texto`, `fim`) com corte de
tamanho e leitura incremental por cursor de linhas. Observação honesta: em headless o bloco
`thinking` costuma vir redigido (vazio + signature); a contagem de
`system/thinking_tokens` mostra a atividade sem inventar raciocínio.

## Resumo geral de andamento (src/core/resumo.js)

`onp-spec resumo [feature]` é a resposta de "o que está rolando agora?" em
texto — o agente posta esse parágrafo no chat a cada ~1 min enquanto houver
execução; **não existe servidor nem UI web**: o acompanhamento é chat e
terminal, por decisão de produto. `--tabela` (`tabelaAndamento()`) imprime a
**tabela de andamento** em markdown — uma linha por tarefa (onde roda,
status ⏳/▶️/✅/❌ e última ação do stream; células higienizadas de pipes e
quebras), com rodapé de faixas falhadas e gate — pronta para o agente colar
no chat junto com o texto; a execução roda em background e o usuário recebe
o resumo completo ao final.

Duas origens, sempre rotuladas: `ia` (o executor claude/codex grava via
`resumo --gravar --origem ia --texto`; no Antigravity é o próprio agente que
escreve) e `motor` (determinístico: `resumoDeterministico()` narra a árvore
do ledger — concluídas, tarefa em execução com a última ação do stream via
`ultimaAcao()` (tail barato do NDJSON), falhas/conflitos e gate). Regra de
frescor em `montarResumoAtual()`: resumo de IA com mais de 2 min perde para o
do motor — um texto velho afirmando "executando" seria mentira. `--contexto`
imprime o estado mecânico que o modelo narrador consome.

## Camada de lições (src/core/sinais.js + src/core/licoes.js)

O agente entra com o julgamento (frasear a regra geral); o motor é dono de
tudo mecânico. Dois arquivos, ambos escritos só pelo motor:

- `.spec/verification/sinais.json` — **histórico de sinais**: todo achado de
  `audit` e toda falha/skip de `verify` (VERIFY_FALHOU/VERIFY_PULADO) vira uma
  entrada chaveada por `(codigo, feature, ref)` com contagem de ocorrências.
  Chaveado, não append-only: cresce com pontos de falha distintos, não com
  execuções. Compactação automática por janela (`janelaDias`, default 90) e
  teto (`maxSinais`, default 20000, ficam os mais recentes).
- `.spec/licoes.json` (+ `LICOES.md` renderizado) — as lições.

Ciclo de vida de uma lição:

| Transição | Quem decide | Regra |
|---|---|---|
| — → recusada | motor | `LICAO_SEM_LASTRO`: nenhum sinal `(sinal, feature, fonte)` no histórico; texto > 280 chars também é recusado |
| — → candidata | motor | lastro válido; dedup exato-após-normalização (NFD sem acentos, minúsculas, sem pontuação) por `sinal::texto` |
| candidata → confirmada | motor | recorrência em `limiarPromocao` (default 2) features DISTINTAS — só confirmadas entram no guia |
| confirmada → quarentena | motor | `limiarQuarentena` (default 2) penalidades via `licoes penalizar` |
| candidata → podada | motor | estagnada além de `janelaDias` sem corroborar |

`licoes sugerir` inverte o fluxo: agrupa o histórico por código de sinal e
aponta os que recorreram em `limiarPromocao`+ features distintas com poucas
lições associadas — o motor diz ONDE vale uma lição; a IA fraseia.

Escala (validada em test/licoes-escala.test.js): listagem com teto fixo
(`limiteListagem`, default 10 — custo de contexto não cresce com o repo),
escopo hierárquico (`cobranca/boleto` casa filtro `cobranca`), evidências
limitadas a 5 por lição. Limiares configuráveis em `onpspec.config.json`
(chave `licoes`). O comando `licoes` não carrega o projeto — listar o guia é
barato mesmo com centenas de features.

## Benchmark (pasta benchmark/)

Specs reais do domínio ONP (inscrição de turma, entrega de dever, notas de alunos).
Para cada ferramenta (spec-kit, OpenSpec, onp-spec-driven), o harness:
1. Materializa a MESMA spec real no formato da ferramenta.
2. Semeia defeitos reais (remove teste, requisito sem cobertura, suposição silenciosa, violação de privacidade, drift de ID).
3. Roda o validador nativo da ferramenta e conta quantos defeitos ela detecta mecanicamente.
4. Emite RESULTS.md com taxa de detecção + matriz de capacidades + tempo de setup.
