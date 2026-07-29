---
name: onp-spec-driven
description: Desenvolvimento spec-anchored nativo para Antigravity — a especificação continua verdadeira porque é auditada mecanicamente contra o código. Fluxo Especificar → Projetar → Tarefas → Plano → Executar → Auditar → Aprender, com rastreabilidade história→critério de aceite→tarefa→teste, definição de pronto executável (cada critério de aceite vira teste anotado), suposições e perguntas como cidadãs de primeira classe, constituição verificável (preset LGPD/educação), lições aprendidas com lastro mecânico e plano de execução PARALELA (faixas em git worktrees executadas pelos agentes paralelos nativos do Antigravity). Integração com Artifacts (task.md, implementation_plan.md, walkthrough.md) e Slash Commands (/goal, /grill-me, /schedule, /learn). Motor mecânico EMBARCADO na skill (zero instalação — roda com o node do ambiente). Use ao planejar features, implementar com verificação, ou auditar uma implementação contra a spec. Gatilhos "especificar feature", "nova feature", "implementar", "auditar spec", "verificar", "plano de execução", "executar em paralelo", "o que não tem teste", "lições aprendidas".
license: MIT
metadata:
  author: Vitor Manoel — O Novo Programador
  version: 3.2.0
  agent: antigravity
---

# onp-spec-driven — a especificação que continua verdadeira (Antigravity)

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

## Interação — use todo o potencial do Antigravity

Esta skill roda nativamente dentro do Antigravity. Use os recursos nativos
(Artifacts e Slash Commands) para deixar o fluxo visível e interativo, sem
virar burocracia:

- **Explique o que fez e onde está**: depois de CADA ação, diga em português
  simples (1) o que foi feito, (2) o caminho de cada arquivo criado ou
  alterado, (3) qual é o próximo passo. O usuário nunca deveria precisar
  perguntar "cadê o arquivo?" nem "e agora?".
- **Lista de tarefas (Artifact de tasks)**: ao iniciar a execução, crie e
  mantenha o Artifact de lista de tarefas do Antigravity (task.md) com um item
  por tarefa (T-xxx), atualizando `[ ]`, `[/]`, `[x]` a cada passo — o usuário
  acompanha visualmente. Deixe o Antigravity resolver onde o artifact mora;
  nunca assuma um caminho interno fixo.
- **Projeto e decisões (Artifact `implementation_plan.md`)**: na fase Projetar
  e no Plano de execução, escreva o plano nesse artifact com
  `request_feedback = true`. Mapeie as perguntas em aberto (Q-xxx) e as
  suposições (ASM-xxx) para forçar a revisão do usuário ANTES da execução.
  Avise que ele pode usar `/grill-me` para responder em modo entrevista.
- **Validação e resumo (Artifact `walkthrough.md`)**: quando `verify` e
  `audit --ci` saírem limpos, atualize o walkthrough com os resultados, as
  lições registradas e a prova mecânica (a saída do audit).
- **Slash Commands** — recomende no momento certo:
  - `/goal`: para fechar uma feature inteira — itere implementação + `verify`
    + `audit --ci` até exit 0. Persistir é implementar de verdade; as regras
    do contrato (abaixo) continuam valendo dentro do `/goal`.
  - `/grill-me`: sessão de entrevista para esclarecer requisitos e design
    (resolve Q-xxx e confirma ASM-xxx).
  - `/schedule`: monitorar suítes de teste longas ou tarefas em background.
  - `/learn`: depois de resolver um problema difícil e específico do projeto,
    sugira `/learn` para o Antigravity guardar o comportamento — além das
    lições mecânicas do `onp-spec licoes`.
- **Traduza a saída do motor**: depois de cada comando, resuma em 1–3 frases
  de português simples o que a máquina disse e qual o próximo passo. Cole a
  saída bruta também (a prova é ela), mas nunca a entregue sozinha.
- **Respeite o usuário avançado**: se o usuário demonstra conhecer o fluxo
  (usa os códigos, pede comandos diretos), corte as explicações didáticas e
  vá direto ao ponto. A tradução encurta; o rigor (verify + audit) nunca.

## O motor embarcado (zero instalação)

O motor mecânico mora DENTRO desta skill, em `scripts/onp-spec.mjs` — resolvido
**relativo ao diretório desta SKILL.md** (nunca assuma um caminho fixo de
instalação). Não existe nada para instalar: sem npm, sem npx, sem CLI global.

Todos os comandos rodam **a partir da raiz do projeto do usuário**:

```bash
node <dir-desta-skill>/scripts/onp-spec.mjs <comando>
```

Comandos: `init [--preset base|lgpd-educacao]` · `new <feature>` ·
`plano <feature> [--agents antigravity]` · `painel <feature> [--porta N] [--sem-abrir]` ·
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
   o audit e **colar a saída** é o último passo, sempre — o walkthrough.md
   resume, mas a prova é a saída bruta.
4. **Suposições e perguntas em aberto são obrigatórias.** Preencheu lacuna sem
   confirmar? É uma suposição. Faltou informação? É uma pergunta em aberto. A
   seção ausente também é problema (`SECAO_AUSENTE`) — se não houver nenhuma,
   escreva "Nenhuma." e desconfie.
5. **A constituição manda.** Princípios [DEVE] são verificados; violá-los
   quebra o audit. Nunca conserte o princípio para "fazer passar" — conserte o
   código.
6. **Nunca enfraqueça, pule ou apague um teste para passar.** Isso vale
   TAMBÉM dentro do `/goal`: "não desista até o exit 0" significa iterar a
   IMPLEMENTAÇÃO, jamais afrouxar o gate. Fora do `/goal`, se o audit falhar
   3 vezes seguidas no mesmo problema, PARE e escale ao usuário via
   `implementation_plan.md` com os achados ranqueados — não itere para sempre
   nem contorne o gate.

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

## Passo a passo no Antigravity

### 1. Especificar

- **Antes de escrever, carregue o guia aprendido**: `onp-spec licoes list`
  (em projeto grande, filtre: `--escopo <dominio>`).
- `onp-spec new <feature>` cria `.spec/features/<feature>/spec.md` e `tasks.md`
  com códigos de rastreio contínuos (únicos no projeto inteiro).
- Escreva as **histórias de usuário (US-xxx)** e os **critérios de aceite
  (AC-xxx)** em Dado/Quando/Então, em linguagem que o dono do produto entende.
- **Registre suposições (ASM-xxx) e perguntas em aberto (Q-xxx)** com status
  honesto (`aberta`). Usuário presente? Sugira `/grill-me` e registre as
  respostas na especificação.
- Rode `onp-spec audit` e leia os problemas apontados.
- Detalhes de escrita: [escrevendo-specs.md](references/escrevendo-specs.md).

### 2. Projetar (features grandes)

Escreva o Artifact `implementation_plan.md` com arquitetura e componentes,
`request_feedback = true`. Cada decisão não-óbvia vira suposição (você
assumiu) ou pergunta em aberto (precisa do dono do produto). Destaque as duas
listas no plano.

### 3. Tarefas

- **Âncora mecânica primeiro:** escreva as tarefas em
  `.spec/features/<feature>/tasks.md` com `Refs:` (histórias/critérios) e
  `Arquivos:` (separados por vírgula) — é isso que o audit e o plano leem.
  Campos opcionais por tarefa: `Modelo:` e `Esforço:` (baixo|medio|alto|xalto|max).
- **Visualização depois:** espelhe as tarefas no Artifact de lista de tarefas
  do Antigravity para o acompanhamento `[ ]`/`[/]`/`[x]`.
- **Fechou o tasks.md? Anuncie o paralelismo.** Rode `onp-spec plano <feature>`
  e conte ao usuário, sem ele pedir: *"X destas Y tarefas podem rodar EM
  PARALELO, em N faixas — quer que eu monte a execução? Dá para acompanhar
  ao vivo no navegador."* Nunca deixe o paralelismo como segredo do motor.

### 4. Plano de execução (2+ tarefas pendentes)

- `onp-spec plano <feature>` (se a detecção errar, force com
  `--agents antigravity`). O motor agrupa tarefas de **arquivos disjuntos**
  em **faixas paralelas** — 1 faixa = 1 git worktree + 1 branch + 1 janela de
  contexto limpa — e grava `.spec/features/<feature>/plano-execucao.md` com:
  os comandos de worktree, **um prompt pronto por faixa**, a ordem de merge,
  a gestão de commits e o gate final.
- Espelhe o resumo (faixas, ondas, branches) no `implementation_plan.md` com
  `request_feedback = true` — o usuário aprova ANTES de executar.
- **Execução paralela usa os agentes nativos do Antigravity**: um agente NOVO
  por faixa (janela limpa), cada um no seu worktree, com o prompt do plano.
  Esta skill NUNCA depende do CLI do Claude — isso é da skill irmã do Claude
  Code.
- **Acompanhamento ao vivo (ofereça sempre)**: rode `onp-spec painel <feature>`
  em background (terminal) e entregue a URL — um painel local no navegador
  refletindo em tempo real o tasks.md, as provas do verify e o gate enquanto
  os agentes das faixas trabalham. No Antigravity o painel é modo
  acompanhamento (quem executa são os agentes nativos, não o botão).
- Feature pequena ou usuário quer simples? Execute as faixas você mesmo, em
  sequência — o plano continua valendo como roteiro de branches e commits.

### 5. Executar

- Vá marcando `[/]` e `[x]` no Artifact de tarefas enquanto o tasks.md
  mecânico é atualizado com `onp-spec tarefa <feature> <T-xxx> <status>`.
- `onp-spec scaffold <feature>` gera o esqueleto de teste **que falha** para
  cada critério de aceite sem teste — a definição de pronto nasce executável.
- Implemente até os testes passarem. **1 tarefa = 1 commit atômico**
  (mensagem: `T-003 <feature>: <título>`). Marque `[concluida]` só com prova.
- Terminou uma faixa? Merge `--no-ff` na branch de trabalho, na ordem do
  plano; conflito interrompe e pede o usuário.

### 6. Verificar e Auditar (o gate)

- `onp-spec verify <feature>` — roda os testes e grava a prova por critério em
  `.spec/verification/<feature>.json`. Só PASS conta (skip não é prova).
- `onp-spec audit --ci` — o veredito. Exit 0 = alinhado. **Cole a saída na
  conversa**, traduza em uma frase, e então atualize o `walkthrough.md`.
- Falhou? Corrija e re-audite — em `/goal`, continue até sair 0 (iterando a
  implementação); fora dele, no máximo 3 iterações no mesmo problema antes de
  escalar ao usuário.
- Fluxo completo com exemplo: [fluxo.md](references/fluxo.md).

### 7. Aprender (fecha o ciclo)

Depois que o audit sai 0: o caminho até aqui ficou registrado sozinho no
histórico de sinais (todo problema de audit e toda falha/skip de verify).

- `onp-spec licoes sugerir` — o motor aponta sinais que recorreram em
  features distintas e ainda não têm lição.
- Registre **no máximo 3 lições** com `onp-spec licoes add --sinal <CODIGO>
  --feature <f> --fonte <AC-xxx> --texto "regra geral em uma frase"`.
  O motor RECUSA lição sem sinal real (`LICAO_SEM_LASTRO`) — não force.
- **Caminho limpo → nenhuma lição.** Isso é correto, não é omissão.
- Feche o Artifact `walkthrough.md` com: o que foi entregue, onde está cada
  arquivo, a saída do audit e as lições registradas.
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
- **"Como acompanho a execução ao vivo?"** → `onp-spec painel <feature>`.
- **"Onde estamos?"** → `onp-spec status`.

## Carregamento de contexto

Carregue referências sob demanda (na fase que precisa delas), nunca todas de
uma vez. Nunca carregue especificações de duas features ao mesmo tempo.
Constituição: [constituicao.md](references/constituicao.md).

## Regra de ouro

Se você está prestes a dizer "pronto", rode `onp-spec audit --ci` e cole a
saída. Se não saiu 0, não está pronto. Aqui, "pronto" é uma coisa que a máquina
verifica — não uma frase sua.
