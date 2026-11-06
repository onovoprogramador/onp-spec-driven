---
name: onp-spec-driven
description: Desenvolvimento spec-anchored para Claude Code. Use ao especificar, pesquisar, planejar, implementar ou auditar features deste projeto; produz PRD, ADR, TDD e specs vinculados para novas especificações grandes, execução paralela com recursos nativos, controle de cota e provas executáveis. Não use para uma conversa genérica sem trabalho no projeto.
license: MIT
metadata:
  author: Vitor Manoel — O Novo Programador
  version: 4.0.0
  agent: claude
---

# onp-spec-driven — Claude Code

Especificação auditável contra código: pesquisar → especificar → projetar →
planejar → executar → verificar → aprender. Fale em português simples; use os
códigos de rastreio junto do nome legível (história US-xxx, critério AC-xxx,
tarefa T-xxx, suposição ASM-xxx, pergunta Q-xxx, princípio P-xxx).

## Comece pelo ambiente real

Leia [harness.md](references/harness.md) ao iniciar a sessão. Descubra as
ferramentas, permissões, modelos, limite de uso, agendamento e notificações
**expostos nesta sessão e versão**. Nome conhecido não prova disponibilidade.
Prefira plano/tarefas, agentes, perguntas, pesquisa, revisão e notificações
nativos. Não crie painel HTML, servidor de acompanhamento, janela própria ou
chamadas extras de IA só para narrar progresso. Mantenha a lista/plano nativo
atualizado quando o estado mudar; comunique decisões, impedimentos e conclusão.
`resumo` é uma consulta textual opcional, sem publicação periódica obrigatória.

O motor está em `scripts/onp-spec.mjs`, relativo a esta SKILL.md. Execute a
partir da raiz do projeto com Node.js ≥ 18, em macOS, Linux ou Windows:

```text
node <dir-desta-skill>/scripts/onp-spec.mjs <comando>
```

Abaixo, `onp-spec` abrevia essa invocação. Não assuma `/tmp`, Bash, comandos
Unix nem instalação global. Se faltar Node, rotule qualquer auditoria manual
como **PROVA FRACA (auditoria manual)**; ela não substitui o gate mecânico.
Para headless, use o CLI autenticado do harness atual, com capacidades
confirmadas. Sem ele, execute pelos agentes nativos disponíveis.

## Preserve o que já existe

Leia [preservacao.md](references/preservacao.md) antes de instalar, atualizar ou
revisar um artefato. A atualização preserva arquivos e contratos existentes:
não migre specs, não complete TDDs antigos, não acrescente links em originais
nem remova painéis antigos. O padrão documental completo vale para **novos**
artefatos, sem exigências retroativas. Uma revisão solicitada vira proposta
em versão separada; preserve o original. Documentos anteriores continuam como
entradas de leitura para avaliar o impacto do trabalho novo. A implementação
já autorizada pode continuar sem uma migração documental automática.

## Contrato de execução

1. Todo critério de aceite tem teste observável com `@spec:AC-xxx` no título.
   Quem decide PASS é o test runner. Teste pulado (skip/todo) não é prova.
2. A feature só fecha quando `onp-spec verify <feature>` produz prova atual e
   `onp-spec audit --ci` sai com código 0. Apresente a saída e seu significado.
3. Nunca enfraqueça, pule ou apague um teste para passar. Corrija implementação
   e causas reais; falhas repetidas sem progresso exigem diagnóstico, não
   remoção de requisitos, alteração de princípios ou declaração de sucesso.
4. Spec sempre tem Suposições e Perguntas em aberto. Registre lacunas com
   status honesto; sem itens, escreva “Nenhuma.”. Confirme decisões de produto
   com o usuário; não invente respostas. Constituição, PRDs e ADRs vigentes
   limitam a implementação.
5. Antes de interferir em domínio anterior ou contrariar PRD/ADR, avise o
   cliente e obtenha decisão explícita pela ferramenta nativa de perguntas.
   A tarefa dependente fica bloqueada; trabalho independente pode continuar.
6. Preserve autorização e preferências já dadas. Confirme paralelismo,
   modelos e esforço somente quando a escolha ainda não estiver autorizada;
   não aumente custo nem troque provedor silenciosamente.

## 1. Pesquisar e especificar

- Consulte `onp-spec licoes list` (filtre `--escopo <dominio>` se pertinente)
  e a constituição. Leia os documentos dos domínios atingidos, mesmo que
  pertençam a outra feature; não carregue o repositório inteiro sem necessidade.
- Para novo pedido de produto, faça research proporcional: comportamento
  dos concorrentes em fontes primárias atuais, contexto do cliente, alternativa
  recomendada e custos. Registre fonte/data, dados observados, hipóteses e
  incerteza. Nunca trate popularidade ou uma amostra conveniente como prova.
  Use [governanca.md](references/governanca.md) para análise quantitativa e
  perguntas que possam mudar o produto. Sugira alternativas, mas só altere
  objetivos/regras após a decisão do cliente.
- `onp-spec new <feature>` cria spec/tarefas. Para feature **grande**
  (múltiplos componentes/domínios, migração, contrato público ou decisão
  arquitetural significativa), use `onp-spec new <feature> --grande`.
  Use `--cliente "<palavras literais do cliente>"` quando disponível;
  preserve pedido original e fonte no PRD, separando interpretação da IA.
- Uma nova especificação grande exige `prd.md`, `adr.md`, `design.md` (TDD), `research.md`, `spec.md`
  e `tasks.md`, com links recíprocos e rastreabilidade. Templates são ponto
  de partida: complete conteúdo antes de implementar. Não marque template
  vazio como documento aprovado.
- Spec descreve histórias e critérios Dado/Quando/Então verificáveis;
  `onp-spec scaffold <feature>` cria testes que inicialmente falham.
  Formato: [escrevendo-specs.md](references/escrevendo-specs.md).

## 2. Projetar e revisar impacto

**Todo `design.md` criado deve ser um TDD completo**, inclusive fora de
features grandes. Siga o template e [governanca.md](references/governanca.md):
contexto, objetivos/não objetivos, requisitos e restrições, arquitetura,
componentes/interfaces/dados, decisões/alternativas, segurança, falhas,
performance/capacidade, observabilidade, testes, migração/rollout/rollback,
riscos, dependências, perguntas e rastreabilidade. Use “não aplicável” com
motivo para seções sem pertinência. A referência de estrutura é a skill
`technical-design-doc-creator` da Tech Leads Club, sem exigir sua instalação.

Antes do plano e **antes de cada tarefa que altera comportamento**, compare
arquivos, APIs, dados e regras com a constituição e PRDs/ADRs/specs dos domínios
envolvidos. Faça revisão semântica: o motor valida registros, links e frescor,
mas não entende sozinho todas as contradições em prosa.

Havendo impacto em domínio anterior, conflito ou dúvida relevante, mostre
regra citada, mudança concreta, consequência e opções (preservar, adaptar ou
substituir a decisão). Pergunte pela ferramenta nativa; sem ferramenta,
pergunte no chat e aguarde. Em headless, grave impedimento e devolva ao
orquestrador interativo. Ausência do usuário, timer vencido ou “Always Proceed”
não autoriza violar contratos. Registre resposta literal, origem, data e
escopo. Se a decisão exigir rever documento existente, proponha uma versão
separada e preserve o original; vincule apenas os artefatos novos. Mudanças
na proposta nova invalidam sua revisão anterior e exigem nova avaliação.

`onp-spec impacto <feature>` mostra pendências. Após a revisão, use
`impacto <feature> --revisao <arquivo.json>`; para uma resposta já recebida,
`impacto <feature> --decisao <arquivo.json>`. Os formatos estão em
[governanca.md](references/governanca.md); nunca crie resposta pelo cliente.

## 3. Planejar tarefas e custo

Em `tasks.md`, cada T-xxx traz `Refs:` e `Arquivos:` (caminhos separados por
vírgula). Status: `[pendente]`, `[em-andamento]`, `[concluida]`. `Modelo:` e
`Esforço:` são opcionais e precisam ser compatíveis com o harness real.

```text
onp-spec harness --agents claude
onp-spec plano <feature> --agents claude
onp-spec plano <feature> --agents claude --paralelizar T-001,T-003
onp-spec plano <feature> --agents claude --sequencial
onp-spec tarefa <feature> <T-xxx> --modelo <id-disponivel>
```

Apresente recomendação de faixas independentes e escolha de custo, aproveitando
qualquer autorização existente. Quando faltar, use a pergunta nativa para
escolher todas/algumas/nenhuma e modelos/esforços entre os **disponíveis na
conta atual**. Não mantenha catálogo fixo de nomes/versionamentos, não
transfira modelo de outro harness e não substitua modelo solicitado em silêncio.
Valide o catálogo de novo antes do headless; indisponibilidade exige escolha
ou confirmação apropriada. Catálogo público não garante acesso da conta.

O plano novo gera Markdown, JSON e `executar-tarefas.mjs`; o acompanhamento usa
o harness. Se já houver qualquer artefato de plano, a nova versão fica em
`execucoes/<runId>/` dentro da feature, preservando todos os arquivos antigos.
Não exija regeneração de planos existentes só para atualizar a skill. Uma
revisão solicitada de escopo exige um plano separado para a nova execução;
o executor nativo recusa fontes desatualizadas. Mudar apenas status não muda
o escopo. Use agentes/worktrees nativos quando suportarem o isolamento exigido;
o executor Node é a rota portável para os CLIs. Não gere painel próprio.

## 4. Executar com reserva de créditos

Antes de despachar tarefas e durante execução, consulte a fonte nativa de
cota/limite do harness ou ponte documentada para essa fonte. Distinga saldo,
janela de rate limit, contexto e gasto em tokens: um não prova o outro.

- **Restam 5% ou menos em qualquer janela aplicável:** pare novos despachos,
  interrompa cooperativamente trabalho ativo quando o harness permitir e
  preserve sessão, progresso parcial, worktree, identificador e checkpoint.
  A reserva de 5% não é autorização para continuar inferência.
- Use o reset informado pelo harness para armar timer nativo. Sem timer
  nativo, use a espera durável do executor Node, sem painel nem chamadas de
  modelo para esperar. Nunca assuma que um relógio vencido restaura a cota:
  **consulte novamente e só retome com limite liberado**. Sem horário,
  consultas com backoff limitado; falha de rede não equivale a saldo positivo.
- Se o limite acabar durante a noite, mantenha o checkpoint em espera e
  retome a mesma execução após liberação comprovada; nunca refaça tarefas
  concluídas nem apague worktrees para tentar de novo. Erro de autenticação,
  pagamento ou modelo inválido requer resolução, não loop de inferência.
- Sem telemetria suficiente, informe “cota desconhecida”; não invente um
  percentual. Providencie a ponte nativa suportada ou aguarde. Sem leitura
  inicial recente, headless bloqueia com `QUOTA_UNAVAILABLE` antes de
  inferência; após limite confirmado, permanece em espera. Não prometa
  proteção exata de 5% quando o fornecedor não expõe esse dado. Respeite os
  limites/permissões do provedor, sem trocar contas ou contornar restrições.
- Confirme que o processo/timer responsável está vivo e registre o próximo
  despertar. Não prometa retomada após desligamento do computador/cliente sem
  scheduler persistente disponível. Após reiniciar, retome pelo checkpoint.

```text
onp-spec executar <feature>
onp-spec executar <feature> --run <id-da-execucao>
node <caminho-do-executar-tarefas.mjs-informado-pelo-plano>
onp-spec executar <feature> --listar
onp-spec executar <feature> --faixa <id>
onp-spec executar <feature> --seq <T-xxx>
onp-spec executar <feature> --gate
```

Mantenha tarefas nativas sincronizadas por eventos, sem tabelas repetidas a
cada minuto. Use notificações nativas **quando estiverem habilitadas** para
tarefa concluída e para bloqueio que precisa de atenção; respeite preferência
já configurada. Não ative notificações, instale plugin ou crie alerta externo
sem necessidade/autorização. Se não há API exposta, a conclusão normal do
harness e mensagem no chat são o fallback explícito.

## 5. Verificar, aprender e encerrar

Implemente com commits rastreáveis por tarefa. `onp-spec tarefa <feature>
<T-xxx> <status>` atualiza o registro mecânico. Só conclua com prova atual:

```text
onp-spec verify <feature>
onp-spec audit --ci
```

Apresente resultado, arquivos relevantes, testes e qualquer pendência.
Registre apenas lições ancoradas em sinais reais: `onp-spec licoes sugerir`,
seguido de `licoes add --sinal <CODIGO> --feature <f> --fonte <AC-xxx>
--texto "<regra>"` quando houver lastro. Sem falha real, nenhuma lição.
Detalhes: [licoes.md](references/licoes.md).

**Ao final de cada sessão**, inclusive encerramento com falha, liste somente
os worktrees usados por suas execuções paralelas e pergunte pela ferramenta
nativa: “Quer limpar os worktrees desta execução?” (manter; limpar os seguros).
Sem worktrees, informe que não há o que limpar. Sem resposta, preserve tudo.
Em execução noturna, deixe a pergunta pendente para a sessão interativa;
nunca bloqueie a retomada por cota esperando uma decisão de limpeza.

```text
onp-spec worktrees <feature>
onp-spec worktrees <feature> --run <id-da-execucao>
# Somente após resposta autorizando os candidatos apresentados:
onp-spec worktrees <feature> --run <id-da-execucao> --limpar --confirmar
```

A listagem consulta os planos arquivados no Git e continua disponível quando
há novas versões de plano, preservando as anteriores. Identifique os `runId` usados nesta
sessão; havendo várias execuções, a limpeza exige escolher `--run` pela
pergunta nativa. Não inclua automaticamente execuções de outras sessões.

Mesmo autorizado, não remova worktree com processo ativo, alterações não
salvas ou commits ainda não integrados. Não use `--force`, limpeza global nem
exclusão de branches para contornar a proteção. Relate o que foi removido e
o que foi preservado. Para a execução inteira: [fluxo.md](references/fluxo.md).
Constituição: [constituicao.md](references/constituicao.md).
