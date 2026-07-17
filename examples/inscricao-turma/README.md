# Exemplo: inscrição na turma

Projeto real e completo, com o audit fechando limpo. Use como referência ou como
roteiro de demonstração.

## Rodar

```bash
cd examples/inscricao-turma
npx onp-spec verify inscricao-turma   # 3/3 ACs provados
npx onp-spec audit --ci               # exit 0 — spec e código alinhados
npx onp-spec status                   # painel
```

## O que este exemplo mostra

- **Rastreabilidade completa**: US-001/US-002 → AC-001/002/003 → T-001/002/003 →
  testes anotados com `@spec:AC-xxx`.
- **DoD executável**: cada AC tem um teste; `verify` grava a prova em
  `.spec/verification/inscricao-turma.json`.
- **Suposições resolvidas**: ASM-001 e ASM-002 estão `confirmada` — por isso a
  feature pôde ir para `implementada`. Se estivessem `aberta`, o audit bloquearia.
- **Constituição LGPD**: P-001/002/003 provados por teste; P-004 (PII em log)
  checado por grep. `src/inscricao.js` não vaza dado pessoal.

## O momento do vídeo: provar que a spec continua verdadeira

Renomeie um requisito na spec e veja o audit acusar o drift na hora:

```bash
# troque AC-003 por AC-030 em .spec/features/inscricao-turma/spec.md
sed -i '' 's/AC-003/AC-030/g' .spec/features/inscricao-turma/spec.md
npx onp-spec audit --ci
```

Saída (exit 1):

```
ERRO AC_SEM_TESTE  AC-030 (...) não tem nenhum teste anotado com @spec:AC-030
ERRO TESTE_ORFAO   teste anotado com @spec:AC-003, mas esse AC não existe (drift!)
```

A spec mudou, o teste ficou pra trás, e a ferramenta **não deixou passar**. É essa
a diferença entre spec-first (a spec vira mentira) e spec-anchored (a máquina
força o alinhamento). Reverta com `git checkout` ou desfazendo o sed.
