---
name: onp-spec-driven
description: Desenvolvimento spec-anchored — a spec continua verdadeira porque é auditada mecanicamente contra o código. Fluxo Especificar → Projetar → Tarefas → Executar → Auditar, com rastreabilidade US→AC→Task→Teste, DoD executável (cada critério de aceite vira teste anotado), suposições e perguntas como cidadãs de primeira classe, e constituição de princípios verificáveis (preset LGPD/educação). Use ao planejar features, implementar com verificação, ou auditar uma implementação contra a spec. Gatilhos "especificar feature", "nova feature", "implementar", "auditar spec", "verificar", "o que não tem teste".
license: MIT
metadata:
  author: Vitor Manoel — O Novo Programador
  version: 1.0.0
---

# onp-spec-driven — a spec que continua verdadeira

A maioria das ferramentas de SDD é **spec-first**: a spec gera código, o código
evolui, e a spec vira mentira. Esta é **spec-anchored**: a spec é auditada
mecanicamente contra o código, em CI, o tempo todo. Você não confia que o agente
obedeceu — a ferramenta prova.

```
┌───────────┐   ┌──────────┐   ┌─────────┐   ┌──────────┐   ┌──────────┐
│ ESPECIFICAR│→ │ PROJETAR │ → │ TAREFAS │ → │ EXECUTAR │ → │ AUDITAR  │
└───────────┘   └──────────┘   └─────────┘   └──────────┘   └──────────┘
   sempre        se preciso     se grande      sempre         SEMPRE (gate)
```

## Contrato de execução — inegociável

1. **Todo critério de aceite (AC) vira um teste anotado** com `@spec:AC-xxx` no
   título. Sem teste anotado, o AC não existe para a máquina.
2. **Quem decide se um AC passou é o test runner**, nunca você. `onp-spec verify`
   roda os testes e grava a prova. Você não pode declarar vitória.
3. **A feature só fecha quando `onp-spec audit --ci` sai com código 0.** Esse é o
   gate. Rodar o audit e mostrar a saída limpa é o último passo, sempre.
4. **Suposições e perguntas são obrigatórias.** Se você assumiu algo, registre em
   `## Suposições` (ASM-xxx) com status. Não adivinhe em silêncio.
5. **A constituição manda.** Princípios [DEVE] são verificados; violá-los quebra
   o audit. Nunca contorne um princípio para "fazer passar".

## Auto-dimensionamento

| Escopo | Especificar | Projetar | Tarefas | Executar |
|---|---|---|---|---|
| Pequeno (≤3 arquivos) | spec enxuta | pular | implícito | implementar + verify + audit |
| Médio (<10 tasks) | spec completa | inline | inline | implementar + verify + audit |
| Grande (multi-componente) | spec + design | design.md | tasks.md | por task + verify + audit |

**Sempre obrigatórios:** Especificar e Auditar. O resto se adapta ao tamanho.

## Passo a passo

### 1. Especificar

- `onp-spec new <feature>` cria `.spec/features/<feature>/spec.md` (e tasks.md).
- Escreva **histórias (US-xxx)** e, para cada uma, **critérios de aceite (AC-xxx)**
  no formato Dado/Quando/Então. O AC precisa ser observável — algo que um teste
  consegue checar. "O sistema deve ser rápido" não é AC; "responde em < 300ms" é.
- **Registre suposições e perguntas.** Ao escrever a spec, toda vez que você
  preencheu uma lacuna sem confirmação, isso é uma ASM. Toda vez que faltou
  informação, isso é uma Q. Liste com status honesto (`aberta`).
- Rode `onp-spec audit` e leia os achados. `AC_INCOMPLETO`, `US_SEM_AC`,
  `SPEC_SEM_US` te dizem o que falta.

### 2. Projetar (features grandes)

Crie `design.md` com arquitetura e componentes. Cada decisão não-óbvia vira ou
uma ASM (se você assumiu) ou uma Q (se precisa do dono do produto).

### 3. Tarefas

- Em `tasks.md`, quebre em **T-xxx**. Cada task:
  - `Refs:` os US/AC que ela atende (rastreabilidade — o audit checa que existem).
  - `Arquivos:` os arquivos que cria/altera (o audit acha código órfão).
- `onp-spec audit` acusa `AC_SEM_TASK` (AC que ninguém vai construir) e
  `REF_QUEBRADA` (task que aponta pra AC inexistente).

### 4. Executar

- `onp-spec scaffold <feature>` gera o esqueleto de teste **que falha** para cada
  AC — o DoD nasce executável. Preencha cada teste com o Dado/Quando/Então real.
- Implemente até os testes passarem. Marque a task `[concluida]` só depois.
- **Um teste por AC, no mínimo. O teste assere o resultado da spec, não o
  formato do seu código.** Nunca enfraqueça, pule ou apague um teste para passar.

### 5. Verificar e Auditar (o gate)

- `onp-spec verify <feature>` — roda os testes, grava a prova por AC em
  `.spec/verification/<feature>.json`. Só um AC com prova PASS conta.
- `onp-spec audit --ci` — o veredito mecânico. Exit 0 = spec e código alinhados.
  Exit 1 = tem erro. **Não termine a tarefa com o audit em erro.** Leia cada
  achado e resolva:

| Achado | O que significa | O que fazer |
|---|---|---|
| AC_SEM_TESTE | requisito sem prova | escreva o teste com `@spec:AC-xxx` |
| AC_SEM_PROVA | teste existe, nunca passou | rode `verify` (ou conserte o teste) |
| TESTE_ORFAO | teste aponta pra AC que sumiu (drift!) | a spec mudou — atualize o teste |
| REF_QUEBRADA | task referencia AC inexistente | corrija a ref na task |
| TASK_CONCLUIDA_SEM_PROVA | task [concluida] sem AC provado | verifique ou reabra a task |
| ASM_ABERTA | suposição aberta numa feature "pronta" | confirme/invalide a suposição |
| PRINCIPIO_VIOLADO | quebrou a constituição | conserte o código, não o princípio |
| ARQUIVO_ORFAO | código que nenhuma task mapeia | mapeie na task ou questione o código |

## Perguntas que a ferramenta responde por você

- **"Qual requisito não tem teste?"** → `onp-spec audit` → achados `AC_SEM_TESTE`.
- **"Que teste não mapeia pra requisito nenhum?"** → achados `TESTE_ORFAO`.
- **"Que código não atende requisito nenhum?"** → achados `ARQUIVO_ORFAO`.
- **"O que estamos assumindo?"** → `onp-spec assumptions`.
- **"Onde estamos?"** → `onp-spec status`.

## Referências

- [Fluxo detalhado e exemplos](references/fluxo.md)
- [Escrevendo specs auditáveis](references/escrevendo-specs.md)
- [Constituição e LGPD/educação](references/constituicao.md)

## Regra de ouro

Se você está prestes a dizer "pronto", rode `onp-spec audit --ci` e cole a saída.
Se não saiu 0, não está pronto. Essa é a diferença entre esta ferramenta e as
outras: aqui, "pronto" é uma coisa que a máquina verifica.
