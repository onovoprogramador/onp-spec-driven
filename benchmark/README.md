# Benchmark — onp-spec-driven vs. concorrentes

Mede a **taxa de detecção mecânica de defeitos reais** de cada ferramenta de
spec-driven development: partindo de specs reais do domínio ONP (inscrição de
turma, notas de aluno), semeia defeitos que de fato adoecem projetos SDD e conta
quantos cada ferramenta detecta **sozinha, num CI, sem humano nem LLM no loop**.

## Como rodar

```bash
# 1. prepara o concorrente com validador real (OpenSpec: clona + compila)
bash benchmark/setup.sh

# 2. roda a comparação ao vivo
node benchmark/run.js
```

Sem o setup, o benchmark ainda roda: o onp-spec-driven é avaliado ao vivo e o
OpenSpec aparece como "não disponível" (—). Para apontar um OpenSpec já
compilado em outro lugar: `OPENSPEC_BIN=/caminho/bin/openspec.js node benchmark/run.js`.

## O que é medido (e o que não é)

- **Detecção mecânica**: a ferramenta emite um erro determinístico para o
  defeito, num comando que roda em CI. É o que mantém a spec verdadeira.
- **Não** medimos qualidade de template, DX de onboarding, nem o que um agente
  LLM *poderia* pegar se obedecesse — porque isso não é garantia, é esperança.

## Ferramentas

| Ferramenta | Como entra | Por quê |
|---|---|---|
| onp-spec-driven | executada ao vivo (`onp-spec audit --ci`) | é a nossa |
| OpenSpec | executada ao vivo (`openspec validate --strict`) | tem validador mecânico real |
| spec-kit | matriz de capacidade | CLI só de scaffolding; sem validador de defeitos |

A classificação do spec-kit como "sem validador mecânico" está justificada
e é verificável no código-fonte — ver [adapters/capability.js](adapters/capability.js).

## Resultado atual

Ver [RESULTS.md](RESULTS.md) (regenerado a cada `node benchmark/run.js`).

Resumo: **onp-spec-driven 100% (9/9)** com baseline limpo · OpenSpec 11% (1/9,
só requisito incompleto) · spec-kit 0% mecânico.
