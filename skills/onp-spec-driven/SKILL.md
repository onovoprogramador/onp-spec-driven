---
name: onp-spec-driven
description: Desenvolvimento spec-anchored — a spec continua verdadeira porque é auditada mecanicamente contra o código. Fluxo Especificar → Projetar → Tarefas → Executar → Auditar → Aprender, com rastreabilidade US→AC→Task→Teste, DoD executável (cada critério de aceite vira teste anotado), suposições e perguntas como cidadãs de primeira classe, constituição de princípios verificáveis (preset LGPD/educação) e lições aprendidas com lastro mecânico (o motor recusa lição sem sinal real de audit/verify; promoção por recorrência entre features). Motor mecânico EMBARCADO na skill (zero instalação — roda com o node do ambiente). Use ao planejar features, implementar com verificação, ou auditar uma implementação contra a spec. Gatilhos "especificar feature", "nova feature", "implementar", "auditar spec", "verificar", "o que não tem teste", "lições aprendidas". NÃO use para technical design docs (use technical-design-doc-creator) nem análise de decomposição de arquitetura.
license: MIT
metadata:
  author: Vitor Manoel — O Novo Programador
  version: 2.1.0
---

# onp-spec-driven — a spec que continua verdadeira

A maioria das ferramentas de SDD é **spec-first**: a spec gera código, o código
evolui, e a spec vira mentira. Esta é **spec-anchored**: a spec é auditada
mecanicamente contra o código, o tempo todo. Você não confia que o agente
obedeceu — **a máquina prova, via exit code**.

```
┌───────────┐   ┌──────────┐   ┌─────────┐   ┌──────────┐   ┌──────────┐
│ ESPECIFICAR│→ │ PROJETAR │ → │ TAREFAS │ → │ EXECUTAR │ → │ AUDITAR  │
└───────────┘   └──────────┘   └─────────┘   └──────────┘   └──────────┘
   sempre        se preciso     se grande      sempre         SEMPRE (gate)
```

## O motor embarcado (zero instalação)

O motor mecânico mora DENTRO desta skill, em `scripts/onp-spec.mjs` — resolvido
**relativo ao diretório desta SKILL.md** (o harness informa o base directory da
skill ao carregá-la; nunca assuma um caminho fixo de instalação). Não existe
nada para instalar: sem npm, sem npx, sem CLI global.

Todos os comandos rodam **a partir da raiz do projeto do usuário**:

```bash
node <dir-desta-skill>/scripts/onp-spec.mjs <comando>
```

Comandos: `init [--preset base|lgpd-educacao]` · `new <feature>` ·
`scaffold <feature> [--force]` · `verify <feature>` ·
`audit [--ci] [--json] [--md <arquivo>]` · `status` · `assumptions` ·
`licoes <add|list|sugerir|penalizar|status>`.

Abaixo, `onp-spec <comando>` é abreviação dessa invocação.

**Degradação graciosa** — se `node` não existir no ambiente: execute a
auditoria manualmente (releia spec/tasks/testes cruzando cada achado do
catálogo abaixo) e rotule o resultado, textualmente, como
**`PROVA FRACA (auditoria manual)`**. Nunca apresente auditoria manual como se
fosse o gate mecânico.

## Contrato de execução — inegociável

1. **Todo critério de aceite (AC) vira um teste anotado** com `@spec:AC-xxx` no
   título. Sem teste anotado, o AC não existe para a máquina.
2. **Quem decide se um AC passou é o test runner**, nunca você. `onp-spec verify`
   roda os testes e grava a prova. Você não pode declarar vitória.
   **Teste pulado (skip/todo) não é prova** — o motor recusa e o audit acusa.
3. **A feature só fecha quando `onp-spec audit --ci` sai com código 0.** Rodar o
   audit e **colar a saída** é o último passo, sempre.
4. **Suposições e perguntas são obrigatórias.** Preencheu lacuna sem confirmar?
   É uma ASM. Faltou informação? É uma Q. A seção ausente também é achado
   (`SECAO_AUSENTE`) — se não houver nenhuma, escreva "Nenhuma." e desconfie.
5. **A constituição manda.** Princípios [DEVE] são verificados; violá-los quebra
   o audit. Nunca conserte o princípio para "fazer passar" — conserte o código.
6. **Nunca enfraqueça, pule ou apague um teste para passar.** Se o audit falhar
   3 vezes seguidas no mesmo achado, PARE e apresente os achados ao usuário —
   não itere para sempre nem contorne o gate.

## Auto-dimensionamento

| Escopo | Especificar | Projetar | Tarefas | Executar |
|---|---|---|---|---|
| Pequeno (≤3 arquivos) | spec enxuta | pular | implícito | implementar + verify + audit |
| Médio (<10 tasks) | spec completa | inline | inline | implementar + verify + audit |
| Grande (multi-componente) | spec + design | design.md | tasks.md | por task + verify + audit |

**Sempre obrigatórios:** Especificar e Auditar.
**Válvula de segurança:** mesmo pulando Tarefas, comece o Executar listando os
passos atômicos. Se aparecerem >5 passos ou dependências entre eles, PARE e
crie `tasks.md` — a fase foi pulada por engano.

## Passo a passo

### 1. Especificar

- **Antes de escrever, carregue o guia aprendido**: `onp-spec licoes list`
  (em projeto grande, filtre: `--escopo <dominio>`). São regras confirmadas
  por falhas reais de features anteriores — aplique-as na spec.
- `onp-spec new <feature>` cria `.spec/features/<feature>/spec.md` e `tasks.md`
  com IDs contínuos (únicos no projeto inteiro).
- Escreva **histórias (US-xxx)** e, para cada uma, **critérios de aceite
  (AC-xxx)** em Dado/Quando/Então. O AC precisa ser observável — algo que um
  teste checa. "Deve ser rápido" não é AC; "responde em < 300ms" é.
- **Registre Suposições (ASM) e Perguntas (Q)** com status honesto (`aberta`).
- Rode `onp-spec audit` e leia os achados (`AC_INCOMPLETO`, `US_SEM_AC`,
  `SECAO_AUSENTE`...) — eles dizem o que falta.
- Detalhes de escrita: [escrevendo-specs.md](references/escrevendo-specs.md).

### 2. Projetar (features grandes)

Crie `design.md` com arquitetura e componentes. Cada decisão não-óbvia vira ou
uma ASM (você assumiu) ou uma Q (precisa do dono do produto).

### 3. Tarefas

- Em `tasks.md`, quebre em **T-xxx**. Cada task tem `Refs:` (US/AC que atende —
  IDs são globais, pode referenciar AC de outra feature) e `Arquivos:`
  (separados por VÍRGULA; espaços em caminhos são permitidos).
- Status entre colchetes: `[pendente]`, `[em-andamento]`, `[concluida]`
  (acentos e maiúsculas são tolerados; token desconhecido é erro).

### 4. Executar

- `onp-spec scaffold <feature>` gera o esqueleto de teste **que falha** para
  cada AC sem teste — e também para cada princípio da constituição com
  `verificação(teste)` ainda sem tag. O DoD nasce executável.
- Implemente até os testes passarem. **1 task = 1 commit atômico** (a mensagem
  cita a task: `T-003: ...`). Marque `[concluida]` só com prova PASS.
- Um teste por AC no mínimo; o teste assere o resultado da spec, não o formato
  do seu código.

### 5. Verificar e Auditar (o gate)

- `onp-spec verify <feature>` — roda os testes, grava a prova por AC em
  `.spec/verification/<feature>.json`. Só PASS conta (skip não é prova).
- `onp-spec audit --ci` — o veredito. Exit 0 = alinhado. Exit 1 = leia cada
  achado e resolva. **Cole a saída final na conversa.**
- Falhou? Corrija e re-audite — no máximo **3 iterações**; persistindo, pare e
  escale ao usuário com os achados ranqueados.
- Fluxo completo com exemplo: [fluxo.md](references/fluxo.md).

### 6. Aprender (fecha o ciclo)

Depois que o audit sai 0: o caminho até aqui ficou registrado sozinho no
histórico de sinais (todo achado de audit e toda falha/skip de verify).

- `onp-spec licoes sugerir` — o motor aponta sinais que recorreram em
  features distintas e ainda não têm lição.
- Registre **no máximo 3 lições** com `onp-spec licoes add --sinal <CODIGO>
  --feature <f> --fonte <AC-xxx> --texto "regra geral em uma frase"
  [--escopo <dominio>]`. O motor RECUSA lição sem sinal real registrado
  (`LICAO_SEM_LASTRO`) — se recusar, a lição não existe; não force.
- **Caminho limpo → nenhuma lição.** Isso é correto, não é omissão.
- Fraseado, promoção, penalização e escala: [licoes.md](references/licoes.md).

## Catálogo de achados do audit

| Achado | O que significa | O que fazer |
|---|---|---|
| AC_SEM_TESTE | requisito sem prova | escreva o teste com `@spec:AC-xxx` no título |
| AC_SEM_PROVA | teste existe, nunca passou (ou foi PULADO) | rode `verify`; skip não é prova |
| TESTE_ORFAO | teste aponta pra AC que sumiu (drift!) | a spec mudou — atualize o teste |
| REF_QUEBRADA | task referencia US/AC inexistente em qualquer spec | corrija a ref |
| TASK_CONCLUIDA_SEM_PROVA | task [concluida] sem AC provado | verifique ou reabra a task |
| TASK_STATUS_INVALIDO | status de task não reconhecido | use pendente/em-andamento/concluida |
| ASM_ABERTA | suposição aberta numa feature "pronta" | confirme/invalide com o usuário |
| SECAO_AUSENTE | spec sem seção Suposições/Perguntas | registre ASM/Q ou escreva "Nenhuma." |
| PRINCIPIO_VIOLADO | quebrou a constituição | conserte o código, não o princípio |
| GLOB_SEM_ARQUIVOS | verificação da constituição não olha nenhum arquivo | corrija o glob |
| NIVEL_INVALIDO | nível de princípio desconhecido | use [DEVE]/[RECOMENDADO]/[PODE] |
| ARQUIVO_ORFAO | código que nenhuma task mapeia | mapeie na task ou questione o código |
| FEATURE_DIVERGENTE | `> feature:` difere do diretório | alinhe os dois |
| PROVA_FRACA | prova só por exit code global | prefira reporter tap/vitest-json/jest-json |
| ID_CURTO / ID_DUPLICADO | ID fora da gramática / repetido | use 3+ dígitos, IDs únicos |

Também: `US_SEM_AC`, `AC_INCOMPLETO`, `AC_SEM_TASK`, `Q_ABERTA`,
`PRINCIPIO_SEM_VERIFICACAO`, `VERIFY_OBSOLETO`, `VERIFICACAO_MALFORMADA`
(inclui regex que excede o tempo limite), `ARQUIVO_INEXISTENTE`,
`STATUS_INVALIDO`, `SPEC_SEM_US`, `AC_FORA_DE_US`.

## Perguntas que o motor responde por você

- **"Qual requisito não tem teste?"** → `onp-spec audit` → `AC_SEM_TESTE`.
- **"Que teste não mapeia pra requisito?"** → `TESTE_ORFAO`.
- **"Que código não atende requisito nenhum?"** → `ARQUIVO_ORFAO`.
- **"O que estamos assumindo?"** → `onp-spec assumptions`.
- **"Onde estamos?"** → `onp-spec status`.

## Carregamento de contexto

Carregue referências sob demanda (na fase que precisa delas), nunca todas de
uma vez. Nunca carregue specs de duas features ao mesmo tempo. Constituição:
[constituicao.md](references/constituicao.md).

## Regra de ouro

Se você está prestes a dizer "pronto", rode `onp-spec audit --ci` e cole a
saída. Se não saiu 0, não está pronto. Aqui, "pronto" é uma coisa que a máquina
verifica — não uma frase sua.
