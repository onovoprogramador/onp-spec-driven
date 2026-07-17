# Spec: Inscrição na turma

> feature: inscricao-turma
> status: implementada

## Contexto

Um visitante interessado se inscreve numa turma aberta do curso. O sistema
respeita o limite de vagas e, quando o aluno é menor de idade, exige o
consentimento de um responsável (LGPD art. 14).

## Histórias

### US-001 — Aluno se inscreve em turma aberta

Como visitante interessado, quero me inscrever numa turma com vagas, para que eu
garanta minha vaga no curso.

#### AC-001 — Inscrição em turma com vaga

- **Dado** uma turma aberta com vagas disponíveis
- **Quando** o visitante envia nome, e-mail e telefone válidos
- **Então** a inscrição é registrada e o número de vagas é decrementado

#### AC-002 — Turma lotada recusa inscrição

- **Dado** uma turma sem vagas
- **Quando** o visitante tenta se inscrever
- **Então** a inscrição é recusada com a mensagem "turma lotada"

### US-002 — Menor de idade exige consentimento

Como responsável, quero autorizar a inscrição de um menor, para que o cadastro
tenha base legal.

#### AC-003 — Inscrição de menor sem consentimento é bloqueada

- **Dado** um visitante que informa idade menor de 18
- **Quando** ele tenta concluir a inscrição sem dados do responsável
- **Então** a inscrição é bloqueada pedindo o consentimento do responsável

## Fora de escopo

- Cobrança e pagamento (feature separada).
- Cancelamento de inscrição pelo aluno.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-001 | E-mail é o identificador único do aluno | confirmada | decidido com o produto em 17/07 |
| ASM-002 | Idade é auto-declarada no formulário | confirmada | MVP não valida documento |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-001 | Guardamos o e-mail do responsável separado do e-mail do aluno? | respondida | sim, campo próprio |
