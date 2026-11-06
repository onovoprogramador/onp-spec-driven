# Arquitetura — onp-spec-driven

> Documento interno de design. Atualizado conforme o projeto evolui.
> Compatibilidade e prova: `npm test`; fontes dos harnesses nas referências das skills.

## Tese

A onp-spec-driven mantém ligações auditáveis entre requisitos, tarefas, testes
e implementação. Pesquisa e comparação de concorrentes precisam de fontes
atuais e escopo explícito; o benchmark local mede apenas seus cenários.

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
- **A skill é o artefato principal**, autossuficiente, em CINCO variantes com
  o MESMO motor e a MESMA versão (`skills/onp-spec-driven/` para Claude Code,
  `skills/onp-spec-driven-codex/` para Codex, `skills/onp-spec-driven-cursor/`
  para Cursor, `skills/onp-spec-driven-antigravity/` para Antigravity e
  `skills/onp-spec-driven-opencode/` para OpenCode;
  marcador `agent:` no frontmatter evita instalar a errada):
  - `SKILL.md` + `references/` — contrato do agente: fluxo
    Especificar → Projetar → Tarefas → Executar → **Auditar**, loop de correção
    com diagnóstico de falhas repetidas, commits rastreáveis e gate com prova atual.
  - `scripts/` — **motor mecânico embarcado** (gerado de `src/` por
    `node tools/build-skill.mjs`; `test/skill-sync.test.js` acusa drift).
    Instalar = copiar a pasta para `.claude/skills/` (Claude Code),
    `.cursor/skills/` (Cursor — Agent Skills nativas desde o Cursor 2.4; o
    `name:` do frontmatter TEM que ser igual ao nome da pasta) ou
    `.agents/skills/` (Codex e Antigravity — compartilham o diretório, por
    isso o marcador), ou `.opencode/skills/` para OpenCode. Sem npm, sem npx.
- A **CLI npm** (`bin/onp-spec.js` → `src/`) continua existindo como modo CI
  (`@onovoprogramador/onp-spec`); consome o MESMO `src/`.
- Design da refatoração skill-first: `docs/TDD-skill-harness.md`; achados que a
  motivaram: `docs/ACHADOS-teste-exaustivo.md`.

## Preservação e compatibilidade

Instalação e atualização preservam arquivos existentes do usuário, inclusive
customizações da skill. Uma instalação diferente do mesmo harness usa uma
pasta/nome versionados ao lado; não há mescla automática. Não se exige converter
specs, adicionar PRD/ADR/TDD ou regenerar planos antigos para adotar a atualização.
Revisões solicitadas de documentos existentes são propostas em versões separadas,
preservando os originais. Os domínios anteriores são entradas de leitura para
revisar o impacto do trabalho novo, sem inclusão automática de links neles.

Os novos contratos documentais dependem de marcação explícita na criação de
artefatos novos; a presença isolada de um `design.md` antigo não ativa uma
migração nem novas exigências retroativas. A execução autorizada e os registros
operacionais de estado/prova continuam distintos de uma migração documental.

## Formato dos artefatos novos (.spec/)

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
    ├── prd.md               # grande: pedido literal, metas e restrições
    ├── adr.md               # grande: decisões e consequências
    ├── design.md            # grande: TDD completo; completo também se criado à parte
    ├── research.md          # grande: fontes, dados, incerteza e recomendação
    ├── governance.json      # revisão de impacto, decisões e frescor
    └── execucoes/<runId>/    # novos planos quando há artefatos anteriores
        ├── plano.json
        ├── plano-execucao.md
        └── executar-tarefas.mjs
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

## Governança (src/core/governance.js)

`new <feature> --grande` cria uma feature nova com PRD, ADR, design/TDD,
research, spec e tasks ligados entre si. Documentos existentes permanecem
intactos, sem novos links ou requisitos retroativos. A versão literal do pedido do cliente fica separada da
interpretação do agente. O template de TDD cobre arquitetura, interfaces,
dados, riscos, segurança, capacidade, testes, observabilidade e implantação.

O agente revisa semanticamente contratos e domínios antes de tarefas que
alteram comportamento. Para os novos artefatos sujeitos ao contrato, o motor
exige registro de revisão, detecta referências faltantes e invalida
decisões/revisões quando suas entradas mudam. Impacto em
domínio anterior ou conflito com PRD/ADR vira pergunta nativa ao cliente antes
da execução dependente. Ausência de conflito mecânico não prova compatibilidade
semântica. Research identifica fonte/data, amostra, viés e incerteza; falta de
dados é inconclusão, não licença para inventar estatística.

## Plano e execução (src/core/plano.js + src/core/executor.js)

`plano <feature>` agrupa tarefas por conflito de arquivos em faixas; cada faixa
tem branch/worktree próprios. `maxParalelas` limita concorrência. O modo
`--paralelizar` seleciona tarefas; `--sequencial` mantém a ordem. Modelos e
esforços vêm de escolha autorizada e são validados no harness atual, sem
substituição silenciosa nem catálogo fixo.

Artefatos: `plano-execucao.md`, `plano.json` e `executar-tarefas.mjs`. O primeiro
plano nativo usa a raiz da feature apenas se nenhum artefato de plano existe.
Se já há Markdown, JSON, script ou HTML, a nova versão fica em
`execucoes/<runId>/`; os arquivos anteriores não são reescritos nem apagados.
O executor
Node usa os CLIs nativos e argumentos estruturados; não depende de Bash para
funcionar em macOS, Linux e Windows. Um wrapper `.sh` de compatibilidade não
é a implementação. Scripts legados permanecem disponíveis sem regeneração
obrigatória. Não há geração de painel HTML, e HTML antigo é preservado.
Plano/tarefas, perguntas,
agentes, revisão e notificações ficam nas ferramentas nativas expostas.

`executar <feature>` seleciona o plano nativo mais recente; `--run <id>`
seleciona a execução exata e o wrapper gerado fixa esse identificador.
`--faixa`, `--seq`, `--gate` e `--listar` permitem operar alvos específicos. Checkpoints preservam tarefas concluídas,
sessões e worktrees. Uma espera por cota não apaga estado nem reexecuta sucesso.
O gate atual (verify + audit) continua obrigatório para conclusão.

## Harness e cota (src/core/harness.js + src/core/quota.js)

Os adaptadores consultam capacidades reais de Claude Code, Codex, Cursor,
Antigravity e OpenCode. Fontes de modelos: inicialização Claude, app-server
Codex, listagem do Cursor, `agy models` e `opencode models`. Os comandos são
resolvidos na plataforma instalada; nomes fixos de versões não são defaults.
Notificações usam APIs/configuração do harness quando habilitadas.

Cota é observada na fonte nativa documentada ou ponte para ela. Janela de
contexto, tokens consumidos e preço não estabelecem saldo da conta. Em <=5%
restantes de janela aplicável, suspenda novos despachos e preserve o trabalho;
use reset informado/backoff e nova consulta antes de retomar. Cota desconhecida
é explícita, sem saldo fabricado ou endpoints privados. Timers de sessão só
funcionam enquanto o processo está vivo; checkpoint permite retomada após
reinício, mas não liga um computador desligado.

## Worktrees e encerramento

`worktrees <feature>` consulta planos arquivados no diretório Git comum
(`src/core/execution-history.js`), valida identidade/hash e lista worktrees
com `runId`, sem depender do `plano.json` atual. `--run <id>` filtra a execução. Ao final da sessão a
skill pergunta pelo mecanismo nativo se deve limpá-los. Após autorização,
`--run <id> --limpar --confirmar` remove somente candidatos seguros; alterações locais,
commits não integrados e execuções ativas são preservados. Não há `--force`
automático nem limpeza global. Em espera noturna de cota, mantenha os worktrees.

## Ledger global (src/core/ledger.js)

Estado de execução NÃO mora no repositório do usuário: mora num **arquivo
único, global**, `~/.onp-spec/painel/ledger.jsonl` (raiz configurável por
`ONP_SPEC_HOME`, o que também isola os testes; o segmento `painel/` no
caminho é herança histórica). Cada linha é um evento (`plano`, `inicio`,
`faixa`, `tarefa`, `gate`, `fim`, `resumo`) carimbado com `runId`,
`projeto`, `projetoDir` e `feature` — então um mesmo ledger cobre quantos
projetos existirem, e `montarArvore()` reconstrói projeto → execução → faixa →
tarefa a partir dele. `podarLedger()` permanece disponível por compatibilidade
para manutenção explícita: mantém as 30 execuções mais recentes e remove
streams anteriores. Instalar a skill e gerar planos não chamam essa poda;
o histórico existente é preservado. Linha corrompida é ignorada, nunca derruba
a leitura.

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

## Resumo textual (src/core/resumo.js)

`resumo [feature]` e `--tabela` são consultas determinísticas para inspeção
pontual. O acompanhamento normal atualiza o plano/tarefas nativos por eventos.
Não há tabela periódica obrigatória, servidor/painel ou chamada de modelo a
cada minuto. Registros de resumo antigos continuam legíveis por compatibilidade;
texto de IA velho não substitui estado mecânico atual.

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
