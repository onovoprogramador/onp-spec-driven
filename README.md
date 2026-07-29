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
usa). Instalar é colocar uma pasta no lugar certo. Escolha o seu agente:

### Claude Code

Na **raiz do seu projeto**:

```bash
npx @onovoprogramador/onp-spec init --agents claude
```

Pronto: isso cria a estrutura `.spec/` do projeto **e** instala a skill em
`.claude/skills/onp-spec-driven/`. Abra uma conversa nova no Claude Code e a
skill já está ativa.

### Antigravity

Na **raiz do seu projeto**:

```bash
npx @onovoprogramador/onp-spec init --agents antigravity
```

Isso cria a estrutura `.spec/` **e** instala a skill em
`.agents/skills/onp-spec-driven/` (o diretório de skills do workspace do
Antigravity). Abra uma conversa nova e pronto.

### Sem npm/npx (instalação manual)

Baixe o repositório e copie a pasta da skill do seu agente:

```bash
git clone --depth 1 https://github.com/onovoprogramador/onp-spec-driven.git /tmp/onp-spec

# Claude Code (neste projeto)
mkdir -p .claude/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven .claude/skills/onp-spec-driven

# Antigravity (neste workspace)
mkdir -p .agents/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-antigravity .agents/skills/onp-spec-driven
```

Quer a skill disponível em **todos** os seus projetos? Copie para o diretório
global do agente em vez do projeto: `~/.claude/skills/` (Claude Code) ou
`~/.gemini/config/skills/` (Antigravity).

> **Importante:** cada agente tem a SUA skill — a do Claude Code executa o
> plano com sessões headless paralelas do próprio Claude; a do Antigravity usa
> os agentes paralelos nativos dele. Não misture as pastas (a skill sabe se
> defender, mas por que arriscar?).

## Como usar — você fala, o agente prova

Você **não precisa aprender comando nenhum**. Os comandos `onp-spec …` que
aparecem pelo repositório são internos da skill: o agente os executa por você
e cola a prova na conversa. Seu trabalho é conversar:

> *"Especifica a feature de inscrição de alunos."*
>
> *"Boa. Divide em tarefas e gera o plano de execução paralela."*
>
> *"Executa o plano."*
>
> *"Audita o que foi feito contra a spec e me mostra a prova."*

O que você recebe de volta, sempre em português simples:

- **Especificação legível** em `.spec/features/<feature>/` — histórias de
  usuário e critérios de aceite escritos para gente (o detalhe técnico vai
  entre parênteses), mais as **suposições** e **perguntas em aberto** que o
  agente é obrigado a confessar.
- **Plano de execução visual** — tarefas que não se tocam rodam **em
  paralelo**, cada uma em sua janela limpa (git worktree + branch próprios).
  O agente sempre te avisa: *"X dessas tarefas podem rodar em paralelo —
  quer que eu execute?"* No Claude Code, o plano vem com o botão
  **"Executar todas as tarefas em janelas limpas e paralelas"**; no
  Antigravity, com um prompt pronto por faixa para os agentes paralelos.
- **Acompanhamento ao vivo, sem comandos** — peça *"abre o painel"* e o
  agente sobe um painel local no navegador (zero instalação): cada faixa em
  tempo real, o log de cada janela rolando, as provas e o veredito do gate.
  No Claude Code, o botão do painel dispara a execução de verdade, com um
  clique.
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
