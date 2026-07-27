# Constituição — princípios que a máquina verifica

A constituição (`.spec/constituicao.md`) codifica restrições **inegociáveis** do
projeto. Não é estilo; é lei. E, diferente de outras ferramentas, aqui todo
princípio [DEVE] tem uma **verificação executável** — senão o audit acusa
"princípio sem verificação" (`PRINCIPIO_SEM_VERIFICACAO`).

## Níveis de obrigação

- `[DEVE]` — obrigatório. Precisa de verificação. Violação = erro no audit.
- `[RECOMENDADO]` — forte. Verificação opcional. Violação = aviso.
- `[PODE]` — permitido/explícito. Documenta uma escolha consciente.

## Quatro formas de verificação

```markdown
## P-001 [DEVE] Todo requisito tem prova executável
- verificação(gate): intrínseca ao audit
```
→ satisfeita pelo próprio mecanismo do audit (critério sem teste, critério sem
prova, tarefa concluída sem prova). Só para princípios "meta" sobre o processo
— regras de domínio usam as formas abaixo.

```markdown
## P-001 [DEVE] Nota de aluno nunca exposta a outro aluno
- verificação(teste): @principle:P-001
```
→ exige que exista pelo menos um teste com `@principle:P-001` no título e que ele
passe no verify. Você escreve o teste que prova o princípio.

```markdown
## P-004 [DEVE] Dados pessoais nunca em log
- verificação(proibido): `console\.log\(.*cpf` em `src/**/*.js`
```
→ o audit faz grep do padrão nos arquivos do glob. Qualquer ocorrência = violação,
com arquivo e linha exatos (rastreabilidade princípio → arquivo → linha).

```markdown
## P-010 [DEVE] Toda rota de nota passa por checarDono()
- verificação(obrigatório): `checarDono\(` em `src/rotas/notas/**/*.js`
```
→ se existem arquivos no glob mas nenhum contém o padrão, é violação.

## Preset LGPD + educação

`onp-spec init --preset lgpd-educacao` já vem com princípios reais para produtos
que guardam dados de alunos (inclusive menores):

- **P-001** nota nunca exposta a outro aluno (teste)
- **P-002** acesso a nota é registrado — trilha de auditoria (teste)
- **P-003** dados de menores só com base legal explícita (teste)
- **P-004** dados pessoais nunca em log (proibido, grep)
- **P-005** minimização de coleta (recomendado)
- **P-006** erro pedagógico não é dado punitivo (recomendado)
- **P-007** exclusão a pedido do titular (pode)
- **P-008** portabilidade dos dados do aluno (pode)

Ajuste os globs/regex à sua stack — eles rodam de verdade no audit, então
precisam apontar pros seus arquivos. Guard-rails do motor:

- glob que não casa NENHUM arquivo → "verificação não olha nenhum arquivo"
  (`GLOB_SEM_ARQUIVOS` — verificação inerte, provável typo);
- nível fora de [DEVE]/[RECOMENDADO]/[PODE] → "nível de princípio inválido"
  (`NIVEL_INVALIDO` — o princípio é tratado como DEVE, nunca ignorado);
- regex rodam em subprocesso com tempo limite (5s) — padrão patológico
  (catastrophic backtracking) vira "verificação malformada"
  (`VERIFICACAO_MALFORMADA`), não trava o gate;
- o esqueleto dos testes de princípio (`verificação(teste)`) nasce no
  `scaffold`, junto com os testes dos critérios de aceite.

## Rastreabilidade que dá diferencial de segurança

Um estudo de caso de microsserviços bancários relatou 73% menos defeitos de
segurança quando os princípios eram rastreados até arquivo e linha. É exatamente
o que `verificação(proibido)` e `verificação(obrigatório)` fazem: cada violação
sai com `arquivo:linha`, não com "reveja o código".
