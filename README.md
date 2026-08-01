# onp-spec-driven

**A especificação que continua verdadeira.** Você descreve a feature, o agente
de IA especifica, planeja, executa em paralelo e **prova** que fez — com
auditoria mecânica, não com promessa. Se a spec e o código desalinham, a
máquina acusa.

```
┌───────────┐  ┌────────┐  ┌───────┐  ┌───────┐  ┌────────┐  ┌───────┐
│ESPECIFICAR│→ │PROJETAR│→ │TAREFAS│→ │ PLANO │→ │EXECUTAR│→ │AUDITAR│
└───────────┘  └────────┘  └───────┘  └───────┘  └────────┘  └───────┘
                                          ↑ paralelismo         ↑ o gate mecânico
```

## Instalação (2 minutos)

A skill é **autossuficiente**: o motor mecânico já vem embarcado dentro dela
(zero dependências — só precisa de Node.js ≥ 18 no ambiente, que seu agente já
usa). Instalar é colocar uma pasta no lugar certo — e o comando abaixo faz
isso por você. Escolha o seu agente:

### Claude Code

Na **raiz do seu projeto**, rode:

```bash
npx @onovoprogramador/onp-spec init --agents claude
```

O comando faz duas coisas:

1. cria a estrutura `.spec/` do projeto (constituição de princípios + arquivo
   de configuração — ambos editáveis, com defaults prontos);
2. instala a skill em `.claude/skills/onp-spec-driven/` — o diretório de
   skills que o Claude Code lê neste projeto.

**Para ativar:** abra uma conversa nova no Claude Code. A skill entra sozinha
quando o pedido casa com ela ("especifica a feature X", "audita contra a
spec"...).

### Codex

Na **raiz do seu projeto**, rode:

```bash
npx @onovoprogramador/onp-spec init --agents codex
```

O comando faz duas coisas:

1. cria a estrutura `.spec/` do projeto;
2. instala a skill em `.agents/skills/onp-spec-driven/` — o diretório de
   skills que o Codex lê no repositório.

**Para ativar:** abra uma conversa nova. A skill entra sozinha quando o
pedido casa com ela, ou invoque explicitamente com `$onp-spec-driven`.

> **Seus tokens, sua escolha:** antes de executar qualquer plano, o agente
> mostra o **modelo e o esforço de cada tarefa** e pergunta se estão dentro
> da sua licença. Você responde na conversa: manter, economizar em tudo,
> ajustar uma tarefa específica ou propor o modelo que quiser — o agente
> ajusta o plano por você. Sem a sua confirmação, nada roda.

### Cursor

Na **raiz do seu projeto**, rode:

```bash
npx @onovoprogramador/onp-spec init --agents cursor
```

O comando faz duas coisas:

1. cria a estrutura `.spec/` do projeto;
2. instala a skill em `.cursor/skills/onp-spec-driven/` — o Cursor suporta
   Agent Skills nativamente desde o 2.4, no editor e no CLI.

**Para ativar:** abra uma conversa nova. A skill entra sozinha quando o
pedido casa com ela, ou invoque explicitamente digitando `/onp-spec-driven`
no chat do Agent.

**Para a execução paralela automática**, o executor usa o CLI do Cursor em
modo headless. Se ainda não o tem, instale e faça login:

```bash
curl https://cursor.com/install -fsS | bash
agent login
```

Sem o CLI, o plano continua funcionando na rota manual: os prompts de cada
faixa vêm prontos para você colar nos agentes paralelos da Agents Window.

> **Seus tokens, sua escolha:** no Cursor, modelos `claude-*`/`gpt-*` são
> cobrados por uso e o `composer` (modelo da casa) tem uso incluído nos
> planos pagos. Antes de executar qualquer plano, o agente mostra o
> **modelo de cada tarefa** e pergunta se está dentro do seu plano — você
> responde na conversa (manter, trocar tudo pelo `composer`, ajustar uma
> tarefa ou propor outro modelo) e o agente ajusta por você. Sem a sua
> confirmação, nada roda.

### Antigravity

Na **raiz do seu projeto**, rode:

```bash
npx @onovoprogramador/onp-spec init --agents antigravity
```

O comando faz duas coisas:

1. cria a estrutura `.spec/` do projeto;
2. instala a skill em `.agents/skills/onp-spec-driven/` — o diretório de
   skills do workspace do Antigravity.

**Para ativar:** abra uma conversa nova e pronto — a execução paralela usa
os agentes nativos do Antigravity, sem depender de CLI nenhum.

### Sem npm/npx (instalação manual, por projeto)

Baixe o repositório uma vez e copie a pasta da skill do seu agente para
dentro do projeto. A pasta de destino se chama **sempre** `onp-spec-driven`:

```bash
git clone --depth 1 https://github.com/onovoprogramador/onp-spec-driven.git /tmp/onp-spec

# Claude Code (neste projeto)
mkdir -p .claude/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven .claude/skills/onp-spec-driven

# Codex (neste projeto)
mkdir -p .agents/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-codex .agents/skills/onp-spec-driven

# Cursor (neste projeto)
mkdir -p .cursor/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-cursor .cursor/skills/onp-spec-driven

# Antigravity (neste workspace)
mkdir -p .agents/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-antigravity .agents/skills/onp-spec-driven
```

### Instalação global — a skill em todos os seus projetos

Prefere instalar **uma vez só**, para todos os projetos? Copie a skill para o
diretório global do seu agente (em vez do diretório do projeto). A regra é a
mesma: **a pasta de destino se chama `onp-spec-driven`** — o Cursor, por
exemplo, exige que o nome da pasta seja igual ao nome interno da skill, e
copiar como `onp-spec-driven-cursor` a deixaria inválida.

```bash
git clone --depth 1 https://github.com/onovoprogramador/onp-spec-driven.git /tmp/onp-spec

# Claude Code (global)
mkdir -p ~/.claude/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven ~/.claude/skills/onp-spec-driven

# Codex (global)
mkdir -p ~/.agents/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-codex ~/.agents/skills/onp-spec-driven

# Cursor (global)
mkdir -p ~/.cursor/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-cursor ~/.cursor/skills/onp-spec-driven

# Antigravity (global)
mkdir -p ~/.gemini/config/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-antigravity ~/.gemini/config/skills/onp-spec-driven
```

Com a skill global, a estrutura `.spec/` continua sendo por projeto — mas
você não precisa rodar nada: na primeira conversa, peça *"inicializa o
onp-spec aqui"* e o agente cria tudo (o motor embarcado da skill cuida
disso).

> **Importante:** cada agente tem a SUA skill — a do Claude Code executa o
> plano com sessões headless paralelas do próprio Claude; a do Codex, com
> sessões headless `codex exec`; a do Cursor, com sessões headless do CLI do
> Cursor (`agent -p`); a do Antigravity usa os agentes paralelos nativos
> dele. **Codex e Antigravity leem o mesmo diretório** (`.agents/skills/`),
> então instale ali a skill do agente que você usa neste projeto — o `init`
> se recusa a sobrescrever a skill de um agente pela do outro. **Atenção com
> o Cursor:** além do diretório próprio (`.cursor/skills/`), o Cursor também
> lê `.agents/skills/` nativamente e `.claude/skills/`/`.codex/skills/` por
> compatibilidade — num projeto que já tem a skill de OUTRO agente
> instalada, o Cursor enxergaria duas skills com o mesmo nome e poderia
> carregar a errada. Use a skill de UM agente por projeto (o `init
> --agents cursor` avisa se encontrar outra variante instalada).

## Como usar — você fala, o agente prova

Você **não precisa aprender comando nenhum**. Os comandos `onp-spec …` que
aparecem pelo repositório são internos da skill: o agente os executa por você
e cola a prova na conversa. Seu trabalho é conversar:

> *"Especifica a feature de inscrição de alunos."*
>
> *"Boa. Divide em tarefas e gera o plano de execução."*
>
> *"Pode rodar em paralelo. Me atualiza a cada minuto."*
>
> *"A faixa 2 falhou — reexecuta só ela."*
>
> *"Audita o que foi feito contra a spec e me mostra a prova."*

O que você recebe de volta, sempre em português simples:

- **Especificação legível** em `.spec/features/<feature>/` — histórias de
  usuário e critérios de aceite escritos para gente (o detalhe técnico vai
  entre parênteses), mais as **suposições** e **perguntas em aberto** que o
  agente é obrigado a confessar.
- **Plano de execução com paralelismo opcional** — tarefas que não se tocam
  PODEM rodar **em paralelo**, cada uma em sua janela limpa (git worktree +
  branch próprios). Mas quem decide é você: o agente apresenta o plano como
  **recomendação** (*"X dessas tarefas podem rodar em paralelo"*) e
  **pergunta QUAIS você quer paralelizar** — todas, só algumas (as
  escolhidas em paralelo, o resto uma após a outra ao final) ou nenhuma
  (tudo na ordem, na árvore principal) — sempre com a mesma disciplina de
  commits e o mesmo gate.
- **Você sempre sabe o que está rolando** — antes de executar, o agente avisa
  que as alterações vão rodar **em background**; enquanto rodam, a cada 1
  minuto ele posta no chat a **tabela de andamento** (qual tarefa está
  rodando, qual não está, o que concluiu/falhou) e o **resumo geral de
  andamento**: um parágrafo em português (escrito por IA, com fallback do
  motor). Ao final, você recebe o resumo completo da execução.
- **Falhou uma faixa? refaça só ela** — peça *"reexecuta só a faixa 2"* e o
  agente repete apenas aquela faixa, do zero e numa janela limpa, sem tocar
  no que já passou.
- **Gestão de commits e branches feita** — 1 tarefa = 1 commit rastreável,
  merges organizados, árvore limpa no final.
- **A prova** — ao final, a auditoria mecânica: cada critério de aceite tem um
  teste que passou, ou a feature **não está pronta**. O veredito é um exit
  code, não uma frase do agente.

## Por que "spec-anchored" (e não spec-first)

Spec Kit, Kiro, OpenSpec — todas são **spec-first**: a spec gera o código, o
código evolui, e a spec vira ficção bem formatada. Aqui é **spec-anchored**:
spec e código evoluem juntos porque um gate mecânico força o alinhamento, o
tempo todo. A diferença aparece no dia em que alguém pergunta "isso aqui ainda
funciona como está escrito?" — e a resposta é um comando, não uma reunião.

## O que a skill garante

1. **Rastreabilidade de ponta a ponta** — cada história, critério de aceite e
   tarefa tem um código; cada critério aponta o teste que o prova. "Qual
   requisito não tem teste?" é uma pergunta que a máquina responde.
2. **"Pronto" é veredito da máquina** — o agente não consegue declarar vitória:
   quem decide é o test runner, e **teste pulado não conta como prova**.
3. **Suposições e perguntas obrigatórias** — o que o agente assumiu sem
   confirmar fica registrado com status; feature não fecha com suposição em
   aberto. Você aponta na tela: *"ele assumiu que não pode reenviar — é isso
   mesmo?"*
4. **Constituição do projeto** — regras inegociáveis (preset pronto de
   LGPD/educação: "nota de aluno nunca exposta a outro aluno", "dado pessoal
   nunca em log") com verificação executável, rastreada até arquivo e linha.
5. **Lições com lastro** — o projeto aprende de feature em feature, mas só
   entra lição ancorada em falha real registrada; opinião solta é recusada.
6. **Execução paralela planejada** — tarefas de arquivos disjuntos rodam ao
   mesmo tempo, em janelas de contexto limpas, com branches e commits
   organizados pelo plano — e o gate final fecha tudo.

## Funciona de verdade?

Benchmark com specs reais do domínio e defeitos que de fato adoecem projetos
de SDD, medindo **detecção mecânica** (o que o CI pega sozinho):

| Ferramenta | Detecção de defeitos | |
|---|---|---|
| **onp-spec-driven** | **100%** (9/9) | ✅ baseline limpo |
| OpenSpec | 11% (1/9) | só requisito incompleto |
| spec-kit | 0% mecânico | scaffolding; testes opcionais |

Detalhes e matriz completa: [benchmark/RESULTS.md](benchmark/RESULTS.md).
Exemplo completo e rodável: [examples/inscricao-turma](examples/inscricao-turma).

## Para os curiosos

O motor que a skill embarca também existe como CLI standalone
(`npm i -g @onovoprogramador/onp-spec`) e roda em CI — o mesmo audit que trava
o agente trava o pipeline. Arquitetura, catálogo completo de achados e formato
dos arquivos: [ARQUITETURA.md](ARQUITETURA.md). O guia que o agente segue está
na própria skill: [skills/onp-spec-driven/SKILL.md](skills/onp-spec-driven/SKILL.md).

## Requisitos

Node.js ≥ 18. Sem outras dependências — nem para você, nem para o agente.

## Licença

MIT © Vitor Manoel — O Novo Programador
