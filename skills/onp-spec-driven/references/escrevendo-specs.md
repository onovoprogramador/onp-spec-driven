# Escrevendo specs auditáveis

## Um AC precisa ser observável

O motor de auditoria não entende prosa — ele entende testes. Então cada AC
precisa descrever algo que um teste consegue checar.

| Ruim (não testável) | Bom (observável) |
|---|---|
| O sistema deve ser rápido | **Então** a resposta chega em menos de 300ms |
| A senha deve ser segura | **Então** senhas com menos de 8 caracteres são rejeitadas |
| O aluno vê suas notas | **Então** a resposta contém só as notas do aluno autenticado |

## Dado / Quando / Então — os três são obrigatórios

O audit acusa `AC_INCOMPLETO` se faltar qualquer cláusula. O parser tolera
indentação, marcador `-` ou `*` e maiúsculas/minúsculas no keyword (e arquivos
salvos em NFD no macOS) — mas o formato canônico é `- **Dado** ...`. Use `E`
para continuar a última:

```markdown
#### AC-003 — Aviso de atraso

- **Dado** um aluno com tarefa vencida
- **Quando** ele abre a tarefa
- **Então** vê um aviso de atraso
- **E** o botão de envio fica desabilitado
```

## Suposições vs. Perguntas

- **Suposição (ASM)**: você preencheu uma lacuna com um palpite razoável e
  **seguiu em frente**. Ex.: "assumo que o prazo é sempre no fim do dia".
  Status: `aberta` → `confirmada` (o dono do produto validou) ou `invalidada`.
- **Pergunta (Q)**: você **parou** porque falta informação. Ex.: "qual fuso?".
  Status: `aberta` → `respondida`.

Regra dura: uma feature não vira `implementada`/`auditada` com ASM `aberta`. Isso
força a conversa "olha, assumi X — é isso mesmo?" antes de considerar pronto.

Regra mais dura ainda: a AUSÊNCIA das seções `## Suposições` e
`## Perguntas em aberto` também é achado (`SECAO_AUSENTE` — erro com a spec
madura). Não tem nenhuma? Escreva "Nenhuma." explicitamente — e desconfie:
quase toda feature esconde uma suposição.

## IDs são globais e únicos

`US-xxx`, `AC-xxx`, `ASM-xxx`, `Q-xxx`, `T-xxx`, `P-xxx` são únicos no projeto
inteiro. `onp-spec new` continua a numeração automaticamente. Se você duplicar,
o audit acusa `ID_DUPLICADO`.

## O ciclo de vida do status da spec

```
rascunho → pronta → em-implementacao → implementada → auditada
```

- `rascunho`: escrevendo.
- `pronta`: spec revisada, ASMs e Qs tratadas, pronta para implementar.
- `em-implementacao`: código em andamento. Qs abertas viram aviso.
- `implementada`: código pronto. ASMs abertas viram **erro**.
- `auditada`: `audit --ci` saiu 0 com prova de todos os ACs.

## Tasks: formato dos campos

- `Refs:` — IDs separados por vírgula/espaço. IDs são GLOBAIS: uma task pode
  referenciar AC de outra feature.
- `Arquivos:` — caminhos separados por VÍRGULA (espaços dentro do caminho são
  válidos): `Arquivos: src/meu modulo.js, src/outro.js`.
- Status: `[pendente]` / `[em-andamento]` / `[concluida]` — acentos e
  maiúsculas tolerados (`[Concluída]` conta); token fora da lista é
  `TASK_STATUS_INVALIDO` (erro), nunca ignorado em silêncio.
