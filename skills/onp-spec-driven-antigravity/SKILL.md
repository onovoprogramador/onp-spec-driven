---
name: onp-spec-driven
description: Desenvolvimento spec-anchored nativo para Antigravity. A especificação continua verdadeira porque é auditada mecanicamente contra o código. Fluxo Especificar → Projetar → Tarefas → Executar → Auditar → Aprender. Integração total com Artifacts do Antigravity (task.md, implementation_plan.md, walkthrough.md) e Slash Commands (/goal, /grill-me). Motor mecânico EMBARCADO na skill (zero instalação — roda com o node do ambiente). Use ao planejar features, implementar com verificação, ou auditar uma implementação contra a spec.
license: MIT
metadata:
  author: Vitor Manoel — O Novo Programador
  version: 3.0.0
---

# onp-spec-driven — a especificação que continua verdadeira (Antigravity Edition)

A maioria das ferramentas de SDD é **spec-first**: a especificação gera código,
o código evolui, e a especificação vira mentira. Esta é **spec-anchored**: a
especificação é auditada mecanicamente contra o código, o tempo todo. Você não
confia que o agente obedeceu — **a máquina prova, via exit code**.

```
┌───────────┐   ┌──────────┐   ┌─────────┐   ┌──────────┐   ┌──────────┐
│ ESPECIFICAR│→ │ PROJETAR │ → │ TAREFAS │ → │ EXECUTAR │ → │ AUDITAR  │
└───────────┘   └──────────┘   └─────────┘   └──────────┘   └──────────┘
   sempre        se preciso     se grande      sempre         SEMPRE (gate)
```

## Vocabulário — fale sempre em português simples

Os arquivos usam **códigos de rastreio** curtos (é o que liga especificação,
tarefas e testes na máquina). Mas com o usuário você fala **sempre o nome por
extenso** — o código vai entre parênteses quando precisar dele:

| Código | Nome que você usa com o usuário |
|---|---|
| US-xxx | **história de usuário** — quem precisa, o que precisa e por quê |
| AC-xxx | **critério de aceite** — resultado observável que um teste checa |
| T-xxx | **tarefa** — passo de implementação |
| ASM-xxx | **suposição** — lacuna preenchida com palpite, ainda sem confirmação |
| Q-xxx | **pergunta em aberto** — decisão que falta o dono do produto tomar |
| P-xxx | **princípio** (da constituição) — restrição inegociável do projeto |
| DoD | **definição de pronto** — o conjunto de critérios de aceite com prova |

Exemplo: diga "o critério de aceite AC-003 (aviso de atraso) ainda não tem
teste", nunca "o AC-003 falta @spec tag". Nunca exija que o usuário conheça
as siglas para entender o que você disse.

## Interação — Use todo o potencial do Antigravity

Esta skill roda nativamente dentro do Antigravity. Use os recursos nativos (Artifacts e Slash Commands) para deixar o fluxo visual e perfeitamente gerenciável:

- **Lista de Tarefas (Artifact `task.md`)**: ao iniciar a execução, crie e atualize o Artifact `<appDataDir>/brain/<conversation-id>/task.md`. Quebre em passos (as tarefas T-xxx) e atualize os status `[ ]`, `[/]`, `[x]`. O usuário acompanha visualmente.
- **Projeto e Decisões (Artifact `implementation_plan.md`)**: na fase Projetar, crie o artifact `implementation_plan.md` e coloque `request_feedback = true`. Mapeie as Perguntas em Aberto (Q-xxx) e Suposições (ASM-xxx) no plano, para forçar a revisão do usuário antes da execução. Recomendação: avise o usuário que ele pode usar `/grill-me` se preferir responder a essas perguntas em modo de entrevista.
- **Validação e Resumo (Artifact `walkthrough.md`)**: após o `verify` e `audit` estarem 100% corretos, atualize o artifact `walkthrough.md` sumarizando os achados, as lições aprendidas (se houver), e a garantia mecânica provada pelo exit code.
- **Slash Commands**: Recomende ao usuário o uso dos comandos nativos para potencializar o fluxo:
  - `/goal`: Ao executar features completas, use isso para instruir você a não parar de codar, rodar `verify` e rodar `audit --ci` iterativamente até a spec estar 100% alinhada (código 0).
  - `/grill-me`: Excelente para sessões interativas de esclarecimento de requisitos e design (Q-xxx).
  - `/schedule`: Pode ser usado para tarefas agendadas em background ou monitoramento de testes longos.
  - `/learn`: Após passar por problemas difíceis ou corrigir falhas mecânicas específicas da arquitetura do projeto, recomende `/learn` para o agente salvar esse comportamento para o futuro.

## O motor embarcado (zero instalação)

O motor mecânico mora DENTRO desta skill, em `scripts/onp-spec.mjs` — resolvido
**relativo ao diretório desta SKILL.md** (nunca assuma um caminho fixo de instalação).

Todos os comandos rodam **a partir da raiz do projeto do usuário**:

```bash
node <dir-desta-skill>/scripts/onp-spec.mjs <comando>
```

Comandos: `init [--preset base|lgpd-educacao]` · `new <feature>` ·
`scaffold <feature> [--force]` · `verify <feature>` ·
`audit [--ci] [--json] [--md <arquivo>]` · `status` · `assumptions` ·
`licoes <add|list|sugerir|penalizar|status>`.

Abaixo, `onp-spec <comando>` é abreviação dessa invocação.

## Contrato de execução — inegociável

1. **Todo critério de aceite vira um teste anotado** com `@spec:AC-xxx` no
   título. Sem teste anotado, o critério não existe para a máquina.
2. **Quem decide se um critério de aceite passou é o test runner**, nunca
   você. `onp-spec verify` roda os testes e grava a prova. Você não pode
   declarar vitória.
3. **A feature só fecha quando `onp-spec audit --ci` sai com código 0.** Rodar
   o audit e **atualizar o walkthrough.md** é o último passo.
4. **Suposições e perguntas em aberto são obrigatórias.** A seção ausente também é problema (`SECAO_AUSENTE`).
5. **A constituição manda.** Princípios [DEVE] são verificados; violá-los
   quebra o audit. Nunca conserte o princípio para "fazer passar" — conserte o
   código.
6. **Se estiver no modo `/goal`, não desista até passar.** Se não estiver em `/goal` e falhar repetidas vezes, pare e peça feedback via `implementation_plan.md`.

## Passo a passo no Antigravity

### 1. Especificar

- **Antes de escrever, carregue o guia aprendido**: `onp-spec licoes list`.
- `onp-spec new <feature>` cria `.spec/features/<feature>/spec.md` e `tasks.md`
  com códigos de rastreio contínuos.
- Escreva a especificação real no projeto, incluindo US-xxx, AC-xxx, ASM-xxx e Q-xxx.
- Rode `onp-spec audit` para checar sintaxe e seções ausentes.

### 2. Projetar (features grandes)

Crie/Atualize o **Artifact `implementation_plan.md`** descrevendo a arquitetura. Destaque perguntas em aberto (Q-xxx) para o dono do produto resolver e suposições críticas. Peça aprovação definindo `request_feedback = true`.

### 3. Tarefas

- **Âncora mecânica:** Escreva as tarefas no arquivo do projeto (`.spec/features/<feature>/tasks.md`) com `Refs:` (códigos globais) e `Arquivos:`. Isso é obrigatório para a auditoria funcionar.
- **Visualização:** Em seguida, crie o **Artifact `task.md`** refletindo as mesmas tarefas (T-xxx) para tracking interativo no painel do Antigravity.

### 4. Executar

- Vá marcando `[/]` e `[x]` no **Artifact `task.md`** enquanto codifica. Não se esqueça de manter o `tasks.md` no `.spec/...` atualizado se houver mudanças estruturais nas tarefas.
- `onp-spec scaffold <feature>` gera testes que falham.
- Implemente o código. 1 tarefa concluída = prova gravada.

### 5. Verificar e Auditar (o gate)

- `onp-spec verify <feature>` grava a prova.
- `onp-spec audit --ci`. Exit 0 = alinhado.
- Falhou? Em modo `/goal`, repita a execução e conserte o código ou o teste.

### 6. Aprender e Sumarizar

Depois que o audit sai 0:
- Use `onp-spec licoes sugerir` para buscar padrões repetidos.
- Registre lições (se aplicável) com lastro.
- Apresente tudo no **Artifact `walkthrough.md`** para encantar o usuário com os resultados finais perfeitamente rastreáveis e verificados!

## Catálogo de problemas que o audit aponta

O audit imprime o código entre parênteses (ex: `AC_SEM_TESTE`). Quando isso ocorrer, traduza e diga qual arquivo alterar para corrigir. Problemas comuns:
- `AC_SEM_TESTE` / `AC_SEM_PROVA`: Faltam testes ou não estão passando.
- `TESTE_ORFAO` / `ARQUIVO_ORFAO`: Drift! O código/teste existe mas não mapeia na spec.
- `TASK_CONCLUIDA_SEM_PROVA`: Tarefa dada como pronta mas sem teste provado pelo `verify`.

## Dica Pro
Sempre verifique `onp-spec status` e `onp-spec assumptions` e garanta que não haja dívidas ocultas. A máquina sempre vigiará o processo!
