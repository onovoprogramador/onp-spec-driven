# Escrevendo especificações auditáveis

## Um critério de aceite precisa ser observável

O motor de auditoria não entende prosa — ele entende testes. Então cada
critério de aceite precisa descrever algo que um teste consegue checar.

| Ruim (não testável) | Bom (observável) |
|---|---|
| O sistema deve ser rápido | **Então** a resposta chega em menos de 300ms |
| A senha deve ser segura | **Então** senhas com menos de 8 caracteres são rejeitadas |
| O aluno vê suas notas | **Então** a resposta contém só as notas do aluno autenticado |

## Dado / Quando / Então — os três são obrigatórios

O audit acusa "critério de aceite incompleto" (`AC_INCOMPLETO`) se faltar
qualquer cláusula. O parser tolera indentação, marcador `-` ou `*` e
maiúsculas/minúsculas no keyword (e arquivos salvos em NFD no macOS) — mas o
formato canônico é `- **Dado** ...`. Use `E` para continuar a última:

```markdown
#### AC-003 — Aviso de atraso

- **Dado** um aluno com tarefa vencida
- **Quando** ele abre a tarefa
- **Então** vê um aviso de atraso
- **E** o botão de envio fica desabilitado
```

## Suposições vs. perguntas em aberto

- **Suposição (ASM-xxx)**: você preencheu uma lacuna com um palpite razoável e
  **seguiu em frente**. Ex.: "assumo que o prazo é sempre no fim do dia".
  Status: `aberta` → `confirmada` (o dono do produto validou) ou `invalidada`.
- **Pergunta em aberto (Q-xxx)**: você **parou** porque falta informação.
  Ex.: "qual fuso?". Status: `aberta` → `respondida`.

Regra dura: uma feature não vira `implementada`/`auditada` com suposição
`aberta`. Isso força a conversa "olha, assumi X — é isso mesmo?" antes de
considerar pronto. Se o usuário estiver na conversa, pergunte na hora
(AskUserQuestion) em vez de deixar a suposição envelhecer.

Regra mais dura ainda: a AUSÊNCIA das seções `## Suposições` e
`## Perguntas em aberto` também é problema (`SECAO_AUSENTE` — erro com a spec
madura). Não tem nenhuma? Escreva "Nenhuma." explicitamente — e desconfie:
quase toda feature esconde uma suposição.

## Códigos de rastreio são globais e únicos

`US-xxx` (história de usuário), `AC-xxx` (critério de aceite), `ASM-xxx`
(suposição), `Q-xxx` (pergunta), `T-xxx` (tarefa) e `P-xxx` (princípio) são
únicos no projeto inteiro. `onp-spec new` continua a numeração
automaticamente. Se você duplicar, o audit acusa código duplicado
(`ID_DUPLICADO`).

## O ciclo de vida do status da especificação

```
rascunho → pronta → em-implementacao → implementada → auditada
```

- `rascunho`: escrevendo.
- `pronta`: especificação revisada, suposições e perguntas tratadas, pronta
  para implementar.
- `em-implementacao`: código em andamento. Perguntas abertas viram aviso.
- `implementada`: código pronto. Suposições abertas viram **erro**.
- `auditada`: `audit --ci` saiu 0 com prova de todos os critérios de aceite.

## Tarefas: formato dos campos

- `Refs:` — códigos separados por vírgula/espaço. Códigos são GLOBAIS: uma
  tarefa pode referenciar critério de aceite de outra feature.
- `Arquivos:` — caminhos separados por VÍRGULA (espaços dentro do caminho são
  válidos): `Arquivos: src/meu modulo.js, src/outro.js`.
- Status: `[pendente]` / `[em-andamento]` / `[concluida]` — acentos e
  maiúsculas tolerados (`[Concluída]` conta); token fora da lista é "status de
  tarefa inválido" (`TASK_STATUS_INVALIDO`, erro), nunca ignorado em silêncio.
