# onp-spec-driven

**A spec que continua verdadeira.** Desenvolvimento *spec-anchored*: a
especificação é auditada mecanicamente contra o código — em CI, o tempo todo —
em vez de virar mentira assim que o código evolui.

Zero dependências. Um comando: `npx onp-spec`.

```
┌────────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐
│ ESPECIFICAR │→ │ PROJETAR │→ │ TAREFAS │→ │ EXECUTAR │→ │ AUDITAR  │
└────────────┘  └──────────┘  └─────────┘  └──────────┘  └──────────┘
                                                            ↑ o gate mecânico
```

## O problema que toda ferramenta de SDD tem

Spec Kit, Kiro, OpenSpec, TLC — todas são **spec-first**: a spec dá clareza,
gera o código, o código evolui e a spec vira ficção. Você fica com uma
documentação que *parece* verdadeira e não é — falsa confiança no comportamento
"documentado".

O ponto ideal é **spec-anchored**: spec e código evoluem juntos porque um teste
automatizado força o alinhamento. Quase nenhuma ferramenta entrega isso. Esta
entrega.

## Os 4 diferenciais

### 1. Uma spec que você audita contra o código

Cada história ganha um ID, cada critério de aceite ganha um ID, cada task
referencia esses IDs, e cada critério aponta o teste que o prova. Aí você
pergunta **mecanicamente**:

```bash
onp-spec audit          # qual requisito NÃO tem teste? que teste não mapeia
                        # pra requisito nenhum? que código é órfão?
```

### 2. Um "pronto" que a máquina verifica

EARS deixa o requisito bonito, mas não o torna executável. Aqui, cada Definition
of Done nasce como um teste (`Dado/Quando/Então` → código de teste com a tag
`@spec:AC-xxx`). O agente **não consegue** declarar vitória prematura:

```bash
onp-spec verify entrega   # o test runner decide, não a sua palavra
onp-spec audit --ci       # exit 1 se algum AC não tem prova PASS
```

### 3. Suposições e perguntas como cidadãs de primeira classe

A crítica mais forte à SDD é empurrar você para uma spec "completa" e gerar falsa
confiança. Aqui a IA é **obrigada** a registrar o que assumiu (`ASM-xxx`) e o que
ficou em aberto (`Q-xxx`), com status. Uma feature não vira `implementada` com
suposição aberta — o audit bloqueia. Você aponta na tela: *"olha, ele assumiu que
trabalho não pode ser reenviado — é isso que a gente quer?"*

### 4. Constituição de educação + privacidade (LGPD)

As outras são propositalmente agnósticas de domínio. Esta traz uma **constituição
versionada** com níveis de obrigação (`[DEVE]`/`[RECOMENDADO]`/`[PODE]`), e todo
`[DEVE]` tem verificação executável — rastreada até **arquivo e linha**:

```bash
onp-spec init --preset lgpd-educacao
```

> P-001 [DEVE] Nota de um aluno nunca é exposta a outro aluno
> P-002 [DEVE] Acesso a nota é registrado (trilha de auditoria)
> P-004 [DEVE] Dados pessoais nunca em log — `verificação(proibido)` via grep

## Resultado do benchmark

Specs reais do domínio, com defeitos que de fato adoecem projetos SDD. Mede-se a
**detecção mecânica** (o que o CI pega sozinho). Reproduza com `node benchmark/run.js`.

| Ferramenta | Detecção de defeitos | |
|---|---|---|
| **onp-spec-driven** | **100%** (9/9) | ✅ baseline limpo |
| OpenSpec | 11% (1/9) | só requisito incompleto |
| spec-kit | 0% mecânico | scaffolding; testes opcionais |
| TLC Spec-Driven | 0% mecânico | Verifier é sub-agente LLM |

Detalhes e matriz completa: [benchmark/RESULTS.md](benchmark/RESULTS.md).

## Início rápido

```bash
# no seu projeto
npx onp-spec init --preset lgpd-educacao
npx onp-spec new entrega-dever-casa

# escreva US/AC (Dado/Quando/Então) e registre Suposições/Perguntas, então:
npx onp-spec scaffold entrega-dever-casa   # DoD vira teste que FALHA
# ...implemente até passar...
npx onp-spec verify entrega-dever-casa     # o runner grava a prova
npx onp-spec audit --ci                    # exit 0 = alinhado
```

Exemplo completo e rodável: [examples/inscricao-turma](examples/inscricao-turma).

## Comandos

| Comando | O que faz |
|---|---|
| `init [--preset base\|lgpd-educacao]` | cria `.spec/`, constituição e config |
| `new <feature>` | cria `spec.md` e `tasks.md` com IDs contínuos |
| `scaffold <feature>` | gera teste-esqueleto (que falha) para cada AC |
| `verify <feature>` | roda os testes e grava a prova por AC |
| `audit [--ci] [--json] [--md]` | o gate: spec ↔ tasks ↔ testes ↔ código ↔ constituição |
| `status` | painel de features, ACs provados, abertas |
| `assumptions` | lista suposições e perguntas com status |

## Catálogo de achados do audit

`AC_SEM_TESTE`, `AC_SEM_PROVA`, `TESTE_ORFAO`, `REF_QUEBRADA`, `US_SEM_AC`,
`AC_INCOMPLETO`, `AC_SEM_TASK`, `ARQUIVO_ORFAO`, `TASK_CONCLUIDA_SEM_PROVA`,
`ASM_ABERTA`, `Q_ABERTA`, `PRINCIPIO_SEM_VERIFICACAO`, `PRINCIPIO_VIOLADO`,
`ID_DUPLICADO`, `VERIFY_OBSOLETO`. Descrição de cada um em
[ARQUITETURA.md](ARQUITETURA.md).

## Para agentes de IA (Claude Code, Cursor)

`onp-spec init --agents claude` instala uma skill em `.claude/skills/` que dirige
o agente pelo fluxo e o obriga a fechar com `onp-spec audit --ci` limpo. A prova
não é a palavra do agente — é o exit code.

## Requisitos

Node.js ≥ 18. Sem outras dependências.

## Licença

MIT © Vitor Manoel — O Novo Programador
