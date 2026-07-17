# Resultados do benchmark — onp-spec-driven vs. concorrentes

> Gerado por `node benchmark/run.js` · 2026-07-17 · 3.1s
> OpenSpec: executado ao vivo

## O que se mede

Cada cenário parte de uma **spec real do domínio ONP** (inscrição de turma, notas de aluno) e semeia **um defeito que realmente adoece projetos spec-driven**. Mede-se se cada ferramenta detecta o defeito **mecanicamente** — o que um pipeline de CI pega sozinho, sem humano nem LLM no loop. É essa detecção que faz a spec *continuar verdadeira*.

## Placar (taxa de detecção mecânica)

| Ferramenta | Detecção | Acertos |
|---|---|---|
| onp-spec-driven | **100%** | 9/9 |
| OpenSpec | **11%** | 1/9 |
| spec-kit | **0%** | 0/9 |

## Matriz por classe de defeito

| Cenário | Defeito | onp-spec | OpenSpec | spec-kit |
|---|---|:--:|:--:|:--:|
| S00-baseline | BASELINE_LIMPO | ✅ | ✅ | ✅ |
| S01-req-sem-teste | REQ_SEM_TESTE | ✅ | ❌ | ❌ |
| S02-teste-orfao | TESTE_ORFAO | ✅ | ❌ | ❌ |
| S03-req-incompleto | REQ_INCOMPLETO | ✅ | ✅ | ❌ |
| S04-pronto-prematuro | PRONTO_PREMATURO | ✅ | ❌ | ❌ |
| S05-suposicao-silenciosa | SUPOSICAO_SILENCIOSA | ✅ | ❌ | ❌ |
| S06-privacidade-violada | PRIVACIDADE_VIOLADA | ✅ | ❌ | ❌ |
| S07-codigo-orfao | CODIGO_ORFAO | ✅ | ❌ | ❌ |
| S08-ref-quebrada | REF_QUEBRADA | ✅ | ❌ | ❌ |
| S09-id-duplicado | ID_DUPLICADO | ✅ | ❌ | ❌ |

Legenda: ✅ detectou (ou, no baseline, validou limpo) · ❌ não detectou · — não disponível.

## Descrição das classes de defeito

- **BASELINE_LIMPO** — spec correta — nenhuma ferramenta pode acusar falso positivo
- **REQ_SEM_TESTE** — requisito sem nenhum teste que o prove (drift #1 do SDD)
- **TESTE_ORFAO** — requisito renomeado; teste ficou pra trás apontando pro ID antigo
- **REQ_INCOMPLETO** — requisito sem comportamento observável (sem Dado/Quando/Então)
- **PRONTO_PREMATURO** — task marcada concluída sem prova de teste passando
- **SUPOSICAO_SILENCIOSA** — decisão de produto assumida sem registro explícito
- **PRIVACIDADE_VIOLADA** — nota de aluno exposta / PII em log — viola a constituição
- **CODIGO_ORFAO** — arquivo de código que não atende requisito nenhum
- **REF_QUEBRADA** — task referencia requisito que não existe
- **ID_DUPLICADO** — dois requisitos com o mesmo identificador

## Evidência (achados do onp-spec por cenário)

| Cenário | Códigos de erro emitidos |
|---|---|
| S00-baseline | _(nenhum — baseline limpo)_ |
| S01-req-sem-teste | AC_SEM_TESTE |
| S02-teste-orfao | AC_SEM_TESTE, TESTE_ORFAO |
| S03-req-incompleto | AC_INCOMPLETO |
| S04-pronto-prematuro | TASK_CONCLUIDA_SEM_PROVA, AC_SEM_PROVA |
| S05-suposicao-silenciosa | ASM_ABERTA |
| S06-privacidade-violada | PRINCIPIO_VIOLADO |
| S07-codigo-orfao | ARQUIVO_ORFAO |
| S08-ref-quebrada | REF_QUEBRADA |
| S09-id-duplicado | ID_DUPLICADO |

## Por que os concorrentes ficam para trás

- **OpenSpec** tem um validador estrutural real (exige frase normativa SHALL e ao menos um cenário por requisito), então pega `REQ_INCOMPLETO`. Mas seu modelo não conhece **testes, provas, suposições, privacidade ou código órfão** — logo não há como detectar o drift #1 (requisito sem teste), a vitória prematura, a suposição silenciosa ou a violação de privacidade.
- **spec-kit** é scaffolding: gera templates ótimos e conduz o agente, mas não roda nenhuma checagem de defeitos — e no template dele os **testes são opcionais**. Detecção mecânica: zero.

O onp-spec-driven é o único que trata **prova de teste, suposição e princípio como dados de primeira classe** e os audita mecanicamente — por isso detecta as classes que os outros nem representam.
