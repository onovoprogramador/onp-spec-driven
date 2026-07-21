# onp-spec-driven

**A spec que continua verdadeira.** Desenvolvimento *spec-anchored*: a
especificação é auditada mecanicamente contra o código — em CI, o tempo todo —
em vez de virar mentira assim que o código evolui.

Zero dependências. Instale com `npm i -g @onovoprogramador/onp-spec` e use o comando `onp-spec`.

```
┌────────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐
│ ESPECIFICAR │→ │ PROJETAR │→ │ TAREFAS │→ │ EXECUTAR │→ │ AUDITAR  │
└────────────┘  └──────────┘  └─────────┘  └──────────┘  └──────────┘
                                                            ↑ o gate mecânico
```

## O problema que toda ferramenta de SDD tem

Spec Kit, Kiro, OpenSpec — todas são **spec-first**: a spec dá clareza,
gera o código, o código evolui e a spec vira ficção. Você fica com uma
documentação que *parece* verdadeira e não é — falsa confiança no comportamento
"documentado".

O ponto ideal é **spec-anchored**: spec e código evoluem juntos porque um teste
automatizado força o alinhamento. Quase nenhuma ferramenta entrega isso. Esta
entrega.

## Os 5 diferenciais

### 1. Uma spec que você audita contra o código

Cada história ganha um ID, cada critério de aceite ganha um ID, cada task
referencia esses IDs, e cada critério aponta o teste que o prova. Aí você
pergunta **mecanicamente**:

```bash
onp-spec audit          # qual requisito NÃO tem teste? que teste não mapeia
                        # pra requisito nenhum? que código é órfão?
```

### 2. Um "pronto" que a máquina verifica

EARS deixa o requisito bonito, mas não o torna executável. Aqui, cada
definição de pronto nasce como um teste (`Dado/Quando/Então` → código de teste
com a tag `@spec:AC-xxx`). O agente **não consegue** declarar vitória
prematura:

```bash
onp-spec verify entrega   # o test runner decide, não a sua palavra
onp-spec audit --ci       # exit 1 se algum critério de aceite não tem prova PASS
```

### 3. Suposições e perguntas como cidadãs de primeira classe

A crítica mais forte à SDD é empurrar você para uma spec "completa" e gerar falsa
confiança. Aqui a IA é **obrigada** a registrar as suposições (o que assumiu,
`ASM-xxx`) e as perguntas em aberto (`Q-xxx`), com status. Uma feature não vira `implementada` com
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

### 5. Lições aprendidas com lastro mecânico

O projeto melhora de feature em feature — sem virar log morto. Todo achado de
audit e toda falha de verify vira um **sinal** registrado pelo motor; a IA
fraseia a regra geral, mas `licoes add` **recusa** qualquer lição que não
cite um sinal real (`LICAO_SEM_LASTRO`). Seletividade é mecânica: lição nasce
`candidata`, só vira `confirmada` (e entra no guia) ao recorrer em **features
distintas**; a que falha quando aplicada vai para quarentena; candidata
estagnada é podada. A listagem tem teto fixo — funciona igual num repo com
centenas de features e dezenas de domínios (`--escopo cobranca/boleto`).

```bash
onp-spec licoes sugerir   # o motor aponta ONDE vale uma lição (recorrência real)
onp-spec licoes add ...   # com lastro; sem sinal registrado, é recusada
onp-spec licoes list      # o guia carregado no início de cada feature
```

## Resultado do benchmark

Specs reais do domínio, com defeitos que de fato adoecem projetos SDD. Mede-se a
**detecção mecânica** (o que o CI pega sozinho). Reproduza com `node benchmark/run.js`.

| Ferramenta | Detecção de defeitos | |
|---|---|---|
| **onp-spec-driven** | **100%** (9/9) | ✅ baseline limpo |
| OpenSpec | 11% (1/9) | só requisito incompleto |
| spec-kit | 0% mecânico | scaffolding; testes opcionais |

Detalhes e matriz completa: [benchmark/RESULTS.md](benchmark/RESULTS.md).

## Início rápido

```bash
# instale uma vez (global) — ou use como dev dependency no projeto
npm install -g @onovoprogramador/onp-spec

# no seu projeto
onp-spec init --preset lgpd-educacao
onp-spec new entrega-dever-casa

# escreva as histórias de usuário e os critérios de aceite (Dado/Quando/Então)
# e registre Suposições/Perguntas, então:
onp-spec scaffold entrega-dever-casa   # cada critério vira um teste que FALHA
# ...implemente até passar...
onp-spec verify entrega-dever-casa     # o runner grava a prova
onp-spec audit --ci                    # exit 0 = alinhado
```

> Sem instalar (roda direto do npm): `npx @onovoprogramador/onp-spec init`.

Exemplo completo e rodável: [examples/inscricao-turma](examples/inscricao-turma).

## Comandos

| Comando | O que faz |
|---|---|
| `init [--preset base\|lgpd-educacao]` | cria `.spec/`, constituição e config |
| `new <feature>` | cria `spec.md` e `tasks.md` com códigos de rastreio contínuos |
| `scaffold <feature>` | gera teste-esqueleto (que falha) para cada critério de aceite |
| `verify <feature>` | roda os testes e grava a prova por critério de aceite |
| `audit [--ci] [--json] [--md]` | o gate: especificação ↔ tarefas ↔ testes ↔ código ↔ constituição |
| `status` | painel de features, critérios provados, suposições/perguntas abertas |
| `assumptions` | lista suposições e perguntas com status |
| `licoes <add\|list\|sugerir\|penalizar\|status>` | lições com lastro: add exige sinal real; promoção por recorrência entre features |

## Catálogo de achados do audit

`AC_SEM_TESTE`, `AC_SEM_PROVA`, `TESTE_ORFAO`, `REF_QUEBRADA`, `US_SEM_AC`,
`AC_INCOMPLETO`, `AC_SEM_TASK`, `ARQUIVO_ORFAO`, `TASK_CONCLUIDA_SEM_PROVA`,
`ASM_ABERTA`, `Q_ABERTA`, `PRINCIPIO_SEM_VERIFICACAO`, `PRINCIPIO_VIOLADO`,
`ID_DUPLICADO`, `VERIFY_OBSOLETO`. Descrição de cada um em
[ARQUITETURA.md](ARQUITETURA.md).

## Para agentes de IA (Claude Code, Cursor) — o caminho principal

A skill em `skills/onp-spec-driven/` é **autossuficiente**: carrega o motor
mecânico embarcado (`scripts/onp-spec.mjs`, zero dependências) e a instalação
inteira é copiar a pasta para `.claude/skills/` do projeto — sem npm, sem npx.
Ela dirige o agente pelo fluxo e o obriga a fechar com o audit em modo CI
limpo. A prova não é a palavra do agente — é o exit code (e teste pulado não
conta como prova).

Quem já usa a CLI: `onp-spec init --agents claude` também instala a skill.
O motor embarcado é gerado de `src/` por `node tools/build-skill.mjs` (o teste
`skill-sync` acusa divergência).

## Requisitos

Node.js ≥ 18. Sem outras dependências.

## Licença

MIT © Vitor Manoel — O Novo Programador
