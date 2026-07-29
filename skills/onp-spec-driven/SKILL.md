---
name: onp-spec-driven
description: Desenvolvimento spec-anchored — a especificação continua verdadeira porque é auditada mecanicamente contra o código. Fluxo Especificar → Projetar → Tarefas → Plano → Executar → Auditar → Aprender, com rastreabilidade história→critério de aceite→tarefa→teste, definição de pronto executável (cada critério de aceite vira teste anotado), suposições e perguntas como cidadãs de primeira classe, constituição de princípios verificáveis (preset LGPD/educação), lições aprendidas com lastro mecânico (o motor recusa lição sem sinal real de audit/verify; promoção por recorrência entre features) e plano de execução PARALELA (tarefas de arquivos disjuntos viram faixas em git worktrees, executadas por claude headless com modelo e esforço por tarefa — inclui script pronto e artefato visual com botão). Motor mecânico EMBARCADO na skill (zero instalação — roda com o node do ambiente). Use ao planejar features, implementar com verificação, ou auditar uma implementação contra a spec. Gatilhos "especificar feature", "nova feature", "implementar", "auditar spec", "verificar", "plano de execução", "executar em paralelo", "o que não tem teste", "lições aprendidas". NÃO use para technical design docs (use technical-design-doc-creator) nem análise de decomposição de arquitetura.
license: MIT
metadata:
  author: Vitor Manoel — O Novo Programador
  version: 3.3.0
  agent: claude
---

# onp-spec-driven — a especificação que continua verdadeira

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

## Interação — use o harness a favor do usuário

Esta skill roda dentro do Claude Code. Use os recursos nativos para deixar o
fluxo visível e interativo, sem virar burocracia:

- **Explique o que fez e onde está**: depois de CADA ação, diga em português
  simples (1) o que foi feito, (2) o caminho de cada arquivo criado ou
  alterado, (3) qual é o próximo passo. O usuário nunca deveria precisar
  perguntar "cadê o arquivo?" nem "e agora?".
- **Lista de tarefas nativa (TodoWrite)**: ao iniciar uma feature, crie um
  todo por fase ("Especificar entrega-dever", "Escrever testes", "Implementar",
  "Auditar"...). Em features grandes, um todo por tarefa (T-xxx) na fase
  Executar. Mantenha o status atualizado a cada passo — é assim que o usuário
  acompanha onde você está sem precisar perguntar.
- **Perguntas interativas (AskUserQuestion)**: quando surgir uma pergunta em
  aberto ou uma suposição que precisa de confirmação e o usuário estiver
  presente, pergunte na hora com opções concretas — e registre a resposta na
  especificação (status `respondida`/`confirmada`). Não acumule perguntas em
  silêncio nem decida sozinho o que é do dono do produto.
- **Traduza a saída do motor**: depois de cada comando, resuma em 1–3 frases
  de português simples o que a máquina disse e qual o próximo passo. Cole a
  saída bruta também (a prova é ela), mas nunca a entregue sozinha.
- **Respeite o usuário avançado**: se o usuário demonstra conhecer o fluxo
  (usa os códigos, pede comandos diretos), corte as explicações didáticas e
  vá direto ao ponto. A tradução encurta; o rigor (verify + audit) nunca.

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
`plano <feature> [--agents claude]` · `painel <feature> [--porta N] [--sem-abrir]` ·
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
6. **Nunca enfraqueça, pule ou apague um teste para passar.** Se o audit
   falhar 3 vezes seguidas no mesmo problema, PARE e apresente os achados ao
   usuário — não itere para sempre nem contorne o gate.

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

## Passo a passo

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
  honesto (`aberta`). Usuário presente? Pergunte na hora (AskUserQuestion) e
  registre a resposta.
- Rode `onp-spec audit` e leia os problemas apontados (critério incompleto,
  história sem critério, seção ausente...) — eles dizem o que falta.
- Detalhes de escrita: [escrevendo-specs.md](references/escrevendo-specs.md).

### 2. Projetar (features grandes)

Crie `design.md` com arquitetura e componentes. Cada decisão não-óbvia vira ou
uma suposição (você assumiu) ou uma pergunta em aberto (precisa do dono do
produto).

### 3. Tarefas

- Em `tasks.md`, quebre em **tarefas (T-xxx)**. Cada tarefa tem `Refs:` (as
  histórias/critérios que atende — códigos são globais, pode referenciar
  critério de outra feature) e `Arquivos:` (separados por VÍRGULA; espaços em
  caminhos são permitidos). Campos opcionais por tarefa: `Modelo:` e
  `Esforço:` (baixo|medio|alto|xalto|max) — o plano de execução usa os dois.
- Status entre colchetes: `[pendente]`, `[em-andamento]`, `[concluida]`
  (acentos e maiúsculas são tolerados; token desconhecido é erro).
- **Fechou o tasks.md? Anuncie o paralelismo.** Rode `onp-spec plano <feature>`
  e conte ao usuário, sem ele pedir: *"X destas Y tarefas podem rodar EM
  PARALELO, em N faixas — quer que eu execute? Dá para acompanhar tudo ao
  vivo no navegador."* Nunca deixe o paralelismo como segredo do motor.

### 4. Plano de execução (2+ tarefas pendentes)

- `onp-spec plano <feature>` agrupa tarefas de **arquivos disjuntos** em
  **faixas paralelas** — 1 faixa = 1 git worktree + 1 branch + 1 janela de
  contexto limpa — e gera três artefatos em `.spec/features/<feature>/`:
  - `plano-execucao.md` — faixas, ondas, gestão de branches/commits e gate;
  - `executar-tarefas.sh` — executor headless: roda `claude -p` por faixa,
    em paralelo, com `--model` e `--effort` já definidos por tarefa, mescla
    as branches de volta, marca as tarefas e fecha com verify + audit;
  - `plano-execucao.html` — visual do plano com o botão **"Executar todas as
    tarefas em janelas limpas e paralelas"** (copia o comando do script).
- **Apresente o plano ao usuário antes de executar**: resuma as faixas, diga
  onde estão os arquivos e ofereça as rotas — automática
  (`bash .spec/features/<feature>/executar-tarefas.sh` ou o botão do html) ou
  manual (você mesmo implementa faixa a faixa, seguindo branches e commits do
  plano).
- **Acompanhamento ao vivo (ofereça sempre)**: rode `onp-spec painel <feature>`
  em background (Bash com run_in_background) e entregue a URL ao usuário. O
  painel mostra, em tempo real: a árvore projeto → execução → faixa → tarefa,
  e **o que o modelo está fazendo em cada janela headless** — ferramenta
  chamada com o argumento, raciocínio (tokens), saída da ferramenta, e o
  fechamento com turnos, duração e custo. O botão **"Executar todas as
  tarefas em janelas limpas e paralelas"** dispara o script DE VERDADE, e
  cada faixa que falha ganha um botão **"↻ reexecutar"** que roda só ela.
  É assim que o usuário acompanha sem digitar comando nenhum.
- **`onp-spec painel` sem feature** abre a visão global: todas as execuções de
  TODOS os projetos, do ledger único em `~/.onp-spec/painel/ledger.jsonl`.
  Use quando o usuário tem várias frentes rodando ao mesmo tempo.
- **Falhou uma faixa? não reexecute tudo.** `executar-tarefas.sh --faixa <id>`
  refaz só ela (worktree e branch da tentativa anterior são limpos antes),
  `--seq <T-xxx>` refaz uma sequencial, `--gate` roda só o veredito, e
  `--listar` mostra os alvos. O trabalho que já passou fica intacto.
- Mudou tasks.md ou a config (`paralelo` no onpspec.config.json)? **Regenere
  o plano** — nunca edite os artefatos à mão.

### 5. Executar

- Espelhe as tarefas na lista de tarefas nativa e vá atualizando o status —
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
- Falhou? Corrija e re-audite — no máximo **3 iterações**; persistindo, pare e
  escale ao usuário com os problemas ranqueados.
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
- **"O que dá pra fazer em paralelo?"** → `onp-spec plano <feature>`.
- **"Como acompanho a execução ao vivo?"** → `onp-spec painel <feature>` (ou
  `onp-spec painel` para todos os projetos de uma vez).
- **"O que o modelo está fazendo agora?"** → o painel mostra o stream da
  sessão headless: ferramenta, raciocínio, saída, custo.
- **"Só uma faixa falhou, como refaço só ela?"** →
  `bash <baseDir>/executar-tarefas.sh --faixa <id>` (ou o botão ↻ no painel).
- **"Onde estamos?"** → `onp-spec status`.

## Carregamento de contexto

Carregue referências sob demanda (na fase que precisa delas), nunca todas de
uma vez. Nunca carregue especificações de duas features ao mesmo tempo.
Constituição: [constituicao.md](references/constituicao.md).

## Regra de ouro

Se você está prestes a dizer "pronto", rode `onp-spec audit --ci` e cole a
saída. Se não saiu 0, não está pronto. Aqui, "pronto" é uma coisa que a máquina
verifica — não uma frase sua.
