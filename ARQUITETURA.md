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
| TLC Spec Driven v3.1 | Disciplina de agente: Verifier independente (author ≠ verifier), evidence-or-zero, lessons | Zero ferramenta mecânica; tudo depende do agente obedecer; nada roda em CI |

## Os 4 diferenciais (critérios de aceite do produto)

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

## Stack

- Node.js >= 18, ESM puro, **zero dependências** (vantagem sobre OpenSpec/spec-kit: `npx onp-spec` e pronto).
- Testes da própria lib: `node:test` nativo.
- Duas camadas:
  - **CLI mecânica** (`bin/onp-spec.js` → `src/`): parse, audit, verify, scaffold, init, new, status.
  - **Camada de agente** (`skills/onp-spec-driven/`): SKILL.md que dirige Claude Code/Cursor pelo fluxo
    Especificar → Projetar → Tarefas → Executar → **Auditar** (o agente é obrigado a fechar com audit exit 0).

## Formato dos artefatos (.spec/)

```
.spec/
├── constituicao.md          # P-xxx versionados com verificação executável
├── verification/            # resultados de verify por feature (JSON, máquina)
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
| AC_SEM_PROVA | Teste existe mas nunca passou em verify (ou verify obsoleto) | ERRO em --ci, AVISO fora |
| TESTE_ORFAO | Teste anotado com AC inexistente (drift!) | ERRO |
| REF_QUEBRADA | Task referencia US/AC inexistente | ERRO |
| US_SEM_AC | História sem critério de aceite | ERRO |
| AC_INCOMPLETO | AC sem Dado/Quando/Então completos | ERRO |
| AC_SEM_TASK | Nenhuma task cobre o AC | AVISO |
| ARQUIVO_ORFAO | Arquivo de src não mapeado por nenhuma task (globs configuráveis) | AVISO |
| TASK_CONCLUIDA_SEM_PROVA | Task [concluida] com AC sem PASS | ERRO |
| ASM_ABERTA | Suposição aberta com feature implementada/auditada | ERRO |
| Q_ABERTA | Pergunta aberta em implementação | AVISO |
| PRINCIPIO_SEM_VERIFICACAO | P [DEVE] sem verificação executável | ERRO |
| PRINCIPIO_VIOLADO | Padrão proibido encontrado / tag de teste ausente | ERRO |
| ID_DUPLICADO | Dois elementos com o mesmo ID | ERRO |
| VERIFY_OBSOLETO | Código alterado depois do último verify | AVISO |

## verify — adaptadores de resultado de teste

`onpspec.config.json` → `{ "testCommand": "...", "reporter": "tap" | "vitest-json" | "jest-json" | "exitcode" }`.
Verify roda o comando, extrai resultado POR TESTE, casa títulos com `@spec:AC-xxx` e grava
`.spec/verification/<feature>.json` com {ac, status, teste, timestamp, gitRev}. Audit consome isso.

## Benchmark (pasta benchmark/)

Specs reais do domínio ONP (inscrição de turma, entrega de dever, notas de alunos).
Para cada ferramenta (spec-kit, OpenSpec, TLC=artefatos md, onp-spec-driven), o harness:
1. Materializa a MESMA spec real no formato da ferramenta.
2. Semeia defeitos reais (remove teste, requisito sem cobertura, suposição silenciosa, violação de privacidade, drift de ID).
3. Roda o validador nativo da ferramenta e conta quantos defeitos ela detecta mecanicamente.
4. Emite RESULTS.md com taxa de detecção + matriz de capacidades + tempo de setup.
