# Fluxo detalhado — do zero ao audit limpo

## Exemplo completo: "entrega de dever de casa"

> `onp-spec <cmd>` abrevia `node <dir-desta-skill>/scripts/onp-spec.mjs <cmd>`,
> sempre a partir da RAIZ do projeto (motor embarcado — nada a instalar).

```bash
# 1. inicializa o projeto (uma vez)
onp-spec init --preset lgpd-educacao

# 2. nova feature
onp-spec new entrega-dever-casa
```

Edite `.spec/features/entrega-dever-casa/spec.md`:

```markdown
# Spec: Entrega de dever de casa

> feature: entrega-dever-casa
> status: em-implementacao

## Histórias

### US-001 — Aluno entrega dentro do prazo

Como aluno, quero enviar meu dever antes do prazo, para que conte como no prazo.

#### AC-001 — Entrega antes do prazo é "no prazo"

- **Dado** um aluno autenticado com uma tarefa aberta
- **Quando** ele envia o arquivo antes do horário-limite
- **Então** a entrega é registrada com status "no prazo"

#### AC-002 — Entrega após o prazo é "atrasada"

- **Dado** um aluno autenticado com uma tarefa aberta
- **Quando** ele envia depois do horário-limite
- **Então** a entrega é registrada com status "atrasada"

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-001 | Trabalho não pode ser reenviado após correção | aberta | — |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-001 | Qual fuso horário define o prazo? | aberta | — |
```

```bash
# 3. DoD vira teste executável
onp-spec scaffold entrega-dever-casa
# → cria test/entrega-dever-casa.spec.test.js com testes que FALHAM
#   (inclui esqueletos p/ princípios da constituição com verificação(teste))
```

Agora implemente a lógica e preencha os testes. Rode:

```bash
# 4. o runner prova (ou não) — teste PULADO não conta como prova
onp-spec verify entrega-dever-casa

# 5. o gate — cole a saída; exit 0 ou não está pronto
onp-spec audit --ci
```

## A tabela de status

Rode `onp-spec status` a qualquer momento:

```
feature                        status             ACs teste  prova  ASM?  Q?
────────────────────────────────────────────────────────────────────────────
entrega-dever-casa             em-implementacao     2     2      1     1   1
```

Lê-se: 2 ACs, ambos com teste anotado, mas só 1 provado até agora; 1 suposição e
1 pergunta ainda abertas. A feature **não pode** ir para `implementada` com a
ASM-001 aberta — o audit vai bloquear com `ASM_ABERTA`.

## Integração com CI

No seu pipeline (GitHub Actions, GitLab CI):

No CI você pode usar o mesmo motor embarcado (commitado junto com a skill) ou
o pacote npm `@onovoprogramador/onp-spec` (modo CI):

```yaml
- run: node .claude/skills/onp-spec-driven/scripts/onp-spec.mjs verify entrega-dever-casa
- run: node .claude/skills/onp-spec-driven/scripts/onp-spec.mjs audit --ci
```

## Por que isso mata o vibecoding

O agente de IA não consegue dizer "implementei tudo" e passar batido: se um AC
não tem teste, o audit acusa; se o teste nunca passou, o audit acusa; se o agente
renomeou um requisito e esqueceu o teste, o audit acusa `TESTE_ORFAO`; se o
agente PULOU o teste (skip/todo), o verify recusa a prova e o audit acusa
`AC_SEM_PROVA`. A prova
não é a palavra do agente — é o exit code.
