---
name: onp-spec-driven
description: Desenvolvimento spec-anchored nativo para Codex — a especificação continua verdadeira porque é auditada mecanicamente contra o código. Use ao planejar features, implementar com verificação, ou auditar uma implementação contra a spec. Gatilhos "especificar feature", "nova feature", "implementar", "auditar spec", "verificar", "plano de execução", "executar em paralelo", "o que não tem teste", "lições aprendidas". Fluxo Especificar → Projetar → Tarefas → Plano → Executar → Auditar → Aprender, com rastreabilidade história→critério de aceite→tarefa→teste, definição de pronto executável (cada critério de aceite vira teste anotado), suposições e perguntas como cidadãs de primeira classe, constituição verificável (preset LGPD/educação), lições aprendidas com lastro mecânico e plano de execução com PARALELISMO OPCIONAL: o agente apresenta o plano recomendado e SEMPRE pergunta QUAIS tarefas o usuário quer paralelizar (faixas com git worktrees + sessões headless `codex exec` via --paralelizar, ou uma tarefa após a outra via --sequencial) e SEMPRE confirma os MODELOS e ESFORÇOS por tarefa antes de executar — os tokens e a licença são do usuário; ele trava o custo com --modelo/--esforco no plano ou por tarefa via `onp-spec tarefa`. Avisa que a execução roda em background e, durante ela, posta no chat a cada 1 minuto a tabela de andamento (o que está rodando e o que não está) + resumo geral — com resumo completo ao final. Integração com os recursos nativos do Codex (plano visível, /plan, /goal, /review, invocação explícita com $onp-spec-driven). Motor mecânico EMBARCADO na skill (zero instalação — roda com o node do ambiente).
license: MIT
metadata:
  author: Vitor Manoel — O Novo Programador
  version: 3.6.0
  agent: codex
---

# onp-spec-driven — a especificação que continua verdadeira (Codex)

A maioria das ferramentas de SDD é **spec-first**: a especificação gera código,
o código evolui, e a especificação vira mentira. Esta é **spec-anchored**: a
especificação é auditada mecanicamente contra o código, o tempo todo. Você não
confia que o agente obedeceu — **a máquina prova, via exit code**.

```
┌───────────┐  ┌────────┐  ┌───────┐  ┌───────┐  ┌────────┐  ┌───────┐
│ESPECIFICAR│→ │PROJETAR│→ │TAREFAS│→ │ PLANO │→ │EXECUTAR│→ │AUDITAR│
└───────────┘  └────────┘  └───────┘  └───────┘  └────────┘  └───────┘
   sempre      se preciso   se grande  2+ tarefas   sempre    SEMPRE (gate)
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

## Interação — use o harness do Codex a favor do usuário

Esta skill roda nativamente dentro do Codex (o usuário pode invocá-la
explicitamente com `$onp-spec-driven`, ou você a assume quando o pedido casa
com a descrição). Use os recursos nativos para deixar o fluxo visível e
interativo, sem virar burocracia:

- **Explique o que fez e onde está**: depois de CADA ação, diga em português
  simples (1) o que foi feito, (2) o caminho de cada arquivo criado ou
  alterado, (3) qual é o próximo passo. O usuário nunca deveria precisar
  perguntar "cadê o arquivo?" nem "e agora?".
- **Plano visível (a ferramenta de plano do Codex)**: ao iniciar uma feature,
  crie um item de plano por fase ("Especificar entrega-dever", "Escrever
  testes", "Implementar", "Auditar"...). Em features grandes, um item por
  tarefa (T-xxx) na fase Executar. Mantenha o status atualizado a cada passo —
  é assim que o usuário acompanha onde você está sem precisar perguntar.
- **Perguntas diretas no chat**: quando surgir uma pergunta em aberto ou uma
  suposição que precisa de confirmação e o usuário estiver presente, pergunte
  na hora, com opções concretas e numeradas (inclua a sua recomendação) — e
  registre a resposta na especificação (status `respondida`/`confirmada`).
  Não acumule perguntas em silêncio nem decida sozinho o que é do dono do
  produto.
- **Modos do Codex — recomende no momento certo**:
  - `/plan`: para desenhar a implementação ANTES de tocar no código — útil
    nas fases Projetar e Plano.
  - `/goal`: para fechar uma feature inteira — a meta é `onp-spec audit --ci`
    sair 0; persistir é implementar de verdade, e as regras do contrato
    (abaixo) continuam valendo dentro do `/goal`.
  - `/review`: revisão das mudanças antes do merge — complementa (nunca
    substitui) o gate mecânico.
- **Traduza a saída do motor**: depois de cada comando, resuma em 1–3 frases
  de português simples o que a máquina disse e qual o próximo passo. Cole a
  saída bruta também (a prova é ela), mas nunca a entregue sozinha.
- **Respeite o usuário avançado**: se o usuário demonstra conhecer o fluxo
  (usa os códigos, pede comandos diretos), corte as explicações didáticas e
  vá direto ao ponto. A tradução encurta; o rigor (verify + audit) nunca.

## O motor embarcado (zero instalação)

O motor mecânico mora DENTRO desta skill, em `scripts/onp-spec.mjs` — resolvido
**relativo ao diretório desta SKILL.md** (o Codex informa o diretório da skill
ao carregá-la; nunca assuma um caminho fixo de instalação). Não existe nada
para instalar: sem npm, sem npx, sem CLI global.

Todos os comandos rodam **a partir da raiz do projeto do usuário**:

```bash
node <dir-desta-skill>/scripts/onp-spec.mjs <comando>
```

Comandos: `init [--preset base|lgpd-educacao]` · `new <feature>` ·
`plano <feature> [--agents codex] [--paralelizar T-xxx,T-yyy] [--sequencial]` ·
`resumo [feature] [--tabela] [--gravar --origem ia --texto "..."]` ·
`tarefa <feature> <T-xxx> <status>` ·
`scaffold <feature> [--force]` · `verify <feature>` ·
`audit [--ci] [--json] [--md <arquivo>]` · `status` · `assumptions` ·
`licoes <add|list|sugerir|penalizar|status>`.

Abaixo, `onp-spec <comando>` é abreviação dessa invocação.

**Degradação graciosa** — se `node` não existir no ambiente: execute a
auditoria manualmente (releia especificação/tarefas/testes cruzando cada
problema do catálogo abaixo) e rotule o resultado, textualmente, como
**`PROVA FRACA (auditoria manual)`**. Nunca apresente auditoria manual como se
fosse o gate mecânico.

## Contrato de execução — inegociável

1. **Todo critério de aceite vira um teste anotado** com `@spec:AC-xxx` no
   título. Sem teste anotado, o critério não existe para a máquina.
2. **Quem decide se um critério de aceite passou é o test runner**, nunca
   você. `onp-spec verify` roda os testes e grava a prova. Você não pode
   declarar vitória. **Teste pulado (skip/todo) não é prova** — o motor recusa
   e o audit acusa.
3. **A feature só fecha quando `onp-spec audit --ci` sai com código 0.** Rodar
   o audit e **colar a saída** é o último passo, sempre.
4. **Suposições e perguntas em aberto são obrigatórias.** Preencheu lacuna sem
   confirmar? É uma suposição. Faltou informação? É uma pergunta em aberto. A
   seção ausente também é problema (`SECAO_AUSENTE`) — se não houver nenhuma,
   escreva "Nenhuma." e desconfie.
5. **A constituição manda.** Princípios [DEVE] são verificados; violá-los
   quebra o audit. Nunca conserte o princípio para "fazer passar" — conserte o
   código.
6. **Nunca enfraqueça, pule ou apague um teste para passar.** Isso vale
   TAMBÉM dentro do `/goal`: "não desista até o exit 0" significa iterar a
   IMPLEMENTAÇÃO, jamais afrouxar o gate. Se o audit falhar 3 vezes seguidas
   no mesmo problema, PARE e apresente os achados ao usuário — não itere para
   sempre nem contorne o gate.

## Auto-dimensionamento

| Escopo | Especificar | Projetar | Tarefas | Plano | Executar |
|---|---|---|---|---|---|
| Pequeno (≤3 arquivos) | spec enxuta | pular | implícito | pular | implementar + verify + audit |
| Médio (<10 tarefas) | spec completa | inline | inline | se 2+ tarefas | implementar + verify + audit |
| Grande (multi-componente) | spec + design | design.md | tasks.md | sempre | por faixa + verify + audit |

**Sempre obrigatórios:** Especificar e Auditar.
**Válvula de segurança:** mesmo pulando Tarefas, comece o Executar listando os
passos atômicos. Se aparecerem >5 passos ou dependências entre eles, PARE e
crie `tasks.md` — a fase foi pulada por engano.

## Passo a passo no Codex

### 1. Especificar

- **Antes de escrever, carregue o guia aprendido**: `onp-spec licoes list`
  (em projeto grande, filtre: `--escopo <dominio>`). São regras confirmadas
  por falhas reais de features anteriores — aplique-as na spec.
- `onp-spec new <feature>` cria `.spec/features/<feature>/spec.md` e `tasks.md`
  com códigos de rastreio contínuos (únicos no projeto inteiro).
- Escreva as **histórias de usuário (US-xxx)** e, para cada uma, os
  **critérios de aceite (AC-xxx)** em Dado/Quando/Então. O critério precisa
  ser observável — algo que um teste checa. "Deve ser rápido" não é critério;
  "responde em < 300ms" é.
- **Registre suposições (ASM-xxx) e perguntas em aberto (Q-xxx)** com status
  honesto (`aberta`). Usuário presente? Pergunte na hora, no chat, com
  opções concretas — e registre a resposta.
- Rode `onp-spec audit` e leia os problemas apontados (critério incompleto,
  história sem critério, seção ausente...) — eles dizem o que falta.
- Detalhes de escrita: [escrevendo-specs.md](references/escrevendo-specs.md).

### 2. Projetar (features grandes)

Crie `design.md` com arquitetura e componentes (o `/plan` do Codex ajuda a
desenhar antes de codar). Cada decisão não-óbvia vira ou uma suposição (você
assumiu) ou uma pergunta em aberto (precisa do dono do produto).

### 3. Tarefas

- Em `tasks.md`, quebre em **tarefas (T-xxx)**. Cada tarefa tem `Refs:` (as
  histórias/critérios que atende — códigos são globais, pode referenciar
  critério de outra feature) e `Arquivos:` (separados por VÍRGULA; espaços em
  caminhos são permitidos). Campos opcionais por tarefa: `Modelo:` (um modelo
  do Codex, ex.: `gpt-5.6-terra`) e `Esforço:` (baixo|medio|alto|xalto — o
  plano converte para `model_reasoning_effort`). Modelo e esforço são
  **propostas suas** — quem bate o martelo é o usuário, na confirmação de
  custos da fase Plano; para ajustar sem editar arquivo:
  `onp-spec tarefa <feature> <T-xxx> --modelo <m> --esforco <nível>`.
- Status entre colchetes: `[pendente]`, `[em-andamento]`, `[concluida]`
  (acentos e maiúsculas são tolerados; token desconhecido é erro).
- **Fechou o tasks.md? Anuncie o paralelismo e PERGUNTE QUAIS.** Rode
  `onp-spec plano <feature>` e apresente ao usuário, sem ele pedir, o plano
  como RECOMENDAÇÃO: *"X destas Y tarefas podem rodar EM PARALELO, em N
  faixas — recomendo assim."* Em seguida pergunte no chat: **quais tarefas
  ele quer paralelizar?** Liste as tarefas paralelizáveis como opções — a
  recomendação (todas) marcada "(recomendado)"; mais de 4? agrupe por faixa.
  Inclua a saída "nenhuma — uma após a outra". A escolha é dele — nunca
  execute sem essa resposta, e nunca deixe o paralelismo como segredo do
  motor.

### 4. Plano de execução (2+ tarefas pendentes)

- **QUAIS tarefas paralelizar é escolha do USUÁRIO — pergunte antes de
  executar** (a pergunta da fase Tarefas; se ainda não perguntou, pergunte
  agora). Escolheu todas → use o plano como está. Escolheu um subconjunto →
  regenere com `onp-spec plano <feature> --paralelizar T-xxx,T-yyy` e
  execute esse. Escolheu nenhuma → regenere com `--sequencial`. Sem
  resposta, não execute.
- **MODELO e ESFORÇO são escolha do USUÁRIO — confirme ANTES de executar.**
  Os tokens e a licença são dele (quem tem plano barato torra a cota com
  modelo forte + esforço alto). O `onp-spec plano` já imprime a lista
  "modelos e esforços deste plano" (uma linha por tarefa: modelo · esforço)
  — apresente-a e pergunte, com opções concretas: **(a)** manter como está
  (a recomendação); **(b)** economizar em tudo — regenere com
  `onp-spec plano <feature> --modelo gpt-5.6-luna --esforco baixo` (os dois
  travam TODAS as tarefas e vencem tasks.md e config); **(c)** ajustar por
  tarefa — `onp-spec tarefa <feature> <T-xxx> --modelo <m> --esforco
  <nível>` e regenere o plano; **(d)** o modelo que ELE propuser — use o que
  o usuário pedir, sem discutir. Sem essa confirmação, não execute. Nunca
  aumente modelo/esforço sem o usuário pedir.
- `onp-spec plano <feature>` (se a detecção errar, force com
  `--agents codex`) agrupa tarefas de **arquivos disjuntos** em **faixas
  paralelas** — 1 faixa = 1 git worktree + 1 branch + 1 janela de contexto
  limpa; com `--paralelizar T-xxx,T-yyy`, só as ESCOLHIDAS entram nas faixas
  (as demais rodam uma após a outra, ao final, na árvore principal); com
  `--sequencial`, TODAS as tarefas rodam uma após a outra, na ordem do
  tasks.md. Três artefatos em `.spec/features/<feature>/`:
  - `plano-execucao.md` — faixas/ordem, gestão de branches/commits e gate;
  - `executar-tarefas.sh` — executor headless: roda `codex exec` com
    `--model` e `model_reasoning_effort` já definidos por tarefa, saída
    `--json` (o stream vai para o ledger), sandbox `workspace-write` e
    `--add-dir` para o `.git` compartilhado dos worktrees (por faixa em
    paralelo, ou uma tarefa por vez no modo sequencial), mescla o que houver
    para mesclar, marca as tarefas e fecha com verify + audit;
  - `plano-execucao.html` — visual do plano (somente leitura, sem botão).
- **Apresente o plano ao usuário**: resuma as faixas (ou a ordem, no
  sequencial), diga onde estão os arquivos e ofereça as rotas — automática
  (VOCÊ roda `bash .spec/features/<feature>/executar-tarefas.sh` num
  terminal em segundo plano) ou manual (você mesmo implementa, seguindo
  branches e commits do plano).
- **Antes de executar, AVISE — sempre**: com paralelismo e custos já
  confirmados, diga ao usuário, em uma frase, que as alterações vão rodar em
  **background**, que a cada 1 minuto você posta aqui a **tabela de
  andamento**, e que ao final ele recebe o **resumo completo** da execução.
  Só então rode o script.
- **Tabela + resumo a cada 1 minuto (obrigatórios enquanto roda)**: com o
  script em background, a cada ~1 min poste no chat a **tabela de
  andamento** (`onp-spec resumo <feature> --tabela` — uma linha por tarefa:
  qual está rodando, qual não está, o que concluiu/falhou e a última ação) e
  o **resumo** (`onp-spec resumo <feature>` — o executor grava um resumo
  escrito por IA a cada minuto no ledger; fallback: motor). O mesmo texto
  sai no terminal do script (`📣 resumo`). Espelhe também as tarefas no
  plano visível do Codex. O usuário nunca fica sem saber o que está rolando.
- **Terminou? Entregue o resumo completo**: a tabela final, o que cada
  tarefa fez (commits), o que falhou (se algo falhou) e a saída do gate
  (verify + audit) colada e traduzida em uma frase.
- **Falhou uma faixa? não reexecute tudo.** Leia o log e o stream, entenda a
  causa, e rode `executar-tarefas.sh --faixa <id>` (worktree e branch da
  tentativa anterior são limpos antes); `--seq <T-xxx>` refaz uma tarefa,
  `--gate` roda só o veredito, e `--listar` mostra os alvos. O trabalho que
  já passou fica intacto.
- Mudou tasks.md ou a config (`paralelo` no onpspec.config.json — inclusive
  `sandbox`, se o usuário decidir liberar mais que `workspace-write`)?
  **Regenere o plano** — nunca edite os artefatos à mão.

### 5. Executar

- Espelhe as tarefas no plano visível do Codex e vá atualizando o status —
  o usuário acompanha o progresso em tempo real. No tasks.md mecânico, use
  `onp-spec tarefa <feature> <T-xxx> <status>`.
- `onp-spec scaffold <feature>` gera o esqueleto de teste **que falha** para
  cada critério de aceite sem teste — e também para cada princípio da
  constituição com `verificação(teste)` ainda sem tag. A definição de pronto
  nasce executável.
- Implemente até os testes passarem. **1 tarefa = 1 commit atômico** (a
  mensagem cita a tarefa: `T-003 <feature>: ...`). Marque `[concluida]` só
  com prova PASS.
- Um teste por critério de aceite no mínimo; o teste assere o resultado da
  especificação, não o formato do seu código.

### 6. Verificar e Auditar (o gate)

- `onp-spec verify <feature>` — roda os testes, grava a prova por critério de
  aceite em `.spec/verification/<feature>.json`. Só PASS conta (skip não é
  prova).
- `onp-spec audit --ci` — o veredito. Exit 0 = alinhado. Exit 1 = leia cada
  problema e resolva. **Cole a saída final na conversa** e traduza em uma
  frase o que ela significa.
- Falhou? Corrija e re-audite — em `/goal`, continue até sair 0 (iterando a
  implementação); fora dele, no máximo **3 iterações** no mesmo problema
  antes de parar e escalar ao usuário com os problemas ranqueados.
- Fluxo completo com exemplo: [fluxo.md](references/fluxo.md).

### 7. Aprender (fecha o ciclo)

Depois que o audit sai 0: o caminho até aqui ficou registrado sozinho no
histórico de sinais (todo problema de audit e toda falha/skip de verify).

- `onp-spec licoes sugerir` — o motor aponta sinais que recorreram em
  features distintas e ainda não têm lição.
- Registre **no máximo 3 lições** com `onp-spec licoes add --sinal <CODIGO>
  --feature <f> --fonte <AC-xxx> --texto "regra geral em uma frase"
  [--escopo <dominio>]`. O motor RECUSA lição sem sinal real registrado
  (`LICAO_SEM_LASTRO`) — se recusar, a lição não existe; não force.
- **Caminho limpo → nenhuma lição.** Isso é correto, não é omissão.
- Regra durável de projeto que não depende de sinal (convenção de pasta,
  comando de build)? O lugar dela é o `AGENTS.md` do repositório — sugira ao
  usuário; lição do motor é só o que tem lastro mecânico.
- Fraseado, promoção, penalização e escala: [licoes.md](references/licoes.md).

## Catálogo de problemas que o audit aponta

O audit imprime cada problema com o nome legível na frente e o código estável
entre parênteses (o código serve para CI e para `licoes add --sinal`). Ao
conversar com o usuário, use o nome legível.

| Problema (código) | O que significa | O que fazer |
|---|---|---|
| critério de aceite sem teste (AC_SEM_TESTE) | requisito sem prova | escreva o teste com `@spec:AC-xxx` no título |
| critério de aceite sem prova (AC_SEM_PROVA) | teste existe, nunca passou (ou foi PULADO) | rode `verify`; skip não é prova |
| teste órfão (TESTE_ORFAO) | teste aponta pra critério que sumiu (drift!) | a especificação mudou — atualize o teste |
| referência quebrada (REF_QUEBRADA) | tarefa cita história/critério inexistente | corrija a referência |
| tarefa concluída sem prova (TASK_CONCLUIDA_SEM_PROVA) | tarefa [concluida] sem critério provado | verifique ou reabra a tarefa |
| status de tarefa inválido (TASK_STATUS_INVALIDO) | status não reconhecido | use pendente/em-andamento/concluida |
| suposição em aberto (ASM_ABERTA) | suposição aberta numa feature "pronta" | confirme/invalide com o usuário |
| seção obrigatória ausente (SECAO_AUSENTE) | spec sem seção Suposições/Perguntas | registre-as ou escreva "Nenhuma." |
| princípio violado (PRINCIPIO_VIOLADO) | quebrou a constituição | conserte o código, não o princípio |
| verificação não olha nenhum arquivo (GLOB_SEM_ARQUIVOS) | glob da constituição não casa nada | corrija o glob |
| nível de princípio inválido (NIVEL_INVALIDO) | nível desconhecido | use [DEVE]/[RECOMENDADO]/[PODE] |
| código órfão (ARQUIVO_ORFAO) | código que nenhuma tarefa mapeia | mapeie na tarefa ou questione o código |
| nome da feature divergente (FEATURE_DIVERGENTE) | `> feature:` difere do diretório | alinhe os dois |
| prova fraca (PROVA_FRACA) | prova só por exit code global | prefira reporter tap/vitest-json/jest-json |
| código de rastreio curto/duplicado (ID_CURTO / ID_DUPLICADO) | fora da gramática / repetido | use 3+ dígitos, códigos únicos |

Também: história sem critério (`US_SEM_AC`), critério incompleto
(`AC_INCOMPLETO`), critério sem tarefa (`AC_SEM_TASK`), pergunta em aberto
(`Q_ABERTA`), princípio sem verificação (`PRINCIPIO_SEM_VERIFICACAO`), prova
desatualizada (`VERIFY_OBSOLETO`), verificação malformada
(`VERIFICACAO_MALFORMADA`, inclui regex que excede o tempo limite), arquivo
não existe (`ARQUIVO_INEXISTENTE`), status inválido (`STATUS_INVALIDO`),
especificação sem história (`SPEC_SEM_US`), critério fora de história
(`AC_FORA_DE_US`).

## Perguntas que o motor responde por você

- **"Qual requisito não tem teste?"** → `onp-spec audit` → critério de aceite
  sem teste (`AC_SEM_TESTE`).
- **"Que teste não mapeia pra requisito?"** → teste órfão (`TESTE_ORFAO`).
- **"Que código não atende requisito nenhum?"** → código órfão
  (`ARQUIVO_ORFAO`).
- **"O que estamos assumindo?"** → `onp-spec assumptions`.
- **"O que dá pra fazer em paralelo?"** → `onp-spec plano <feature>` — e
  QUAIS tarefas paralelizar é escolha do usuário, via pergunta no chat.
- **"Dá pra rodar mais barato?"** → `onp-spec plano <feature> --modelo
  gpt-5.6-luna --esforco baixo` (tudo) ou `onp-spec tarefa <feature> <T-xxx>
  --modelo <m> --esforco <nível>` (por tarefa, e regenere o plano) — modelos
  e esforços SEMPRE passam pela confirmação do usuário antes de executar.
- **"O que está rolando agora?"** → `onp-spec resumo <feature> --tabela` (a
  tabela de andamento) + `onp-spec resumo <feature>` (o texto); poste os
  dois no chat a cada ~1 min enquanto houver execução.
- **"Só uma faixa falhou, como refaço só ela?"** →
  `bash <baseDir>/executar-tarefas.sh --faixa <id>`.
- **"Onde estamos?"** → `onp-spec status`.

## Carregamento de contexto

Carregue referências sob demanda (na fase que precisa delas), nunca todas de
uma vez. Nunca carregue especificações de duas features ao mesmo tempo.
Constituição: [constituicao.md](references/constituicao.md).

## Regra de ouro

Se você está prestes a dizer "pronto", rode `onp-spec audit --ci` e cole a
saída. Se não saiu 0, não está pronto. Aqui, "pronto" é uma coisa que a máquina
verifica — não uma frase sua.
