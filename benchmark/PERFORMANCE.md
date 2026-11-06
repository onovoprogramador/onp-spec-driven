# Performance do motor 0.10.0

Medição local: 2026-11-06T13:52:14.022Z · darwin/arm64 · v22.14.0 · Apple M1 Pro.

Reproduzir: `npm run bench:performance -- --json benchmark/PERFORMANCE.json`.
O script verifica que os componentes de tarefas e arquivos encontrados são idênticos.
Os dados completos, incluindo todas as amostras, ficam em [PERFORMANCE.json](PERFORMANCE.json).

## Método e limites

Sete repetições após um aquecimento, mesma entrada e processo, caches locais aquecidos.
A referência reproduz o agrupamento e a varredura da versão 0.9.0. O agrupamento
antigo é medido com contagem de comparações; o lado novo mede o `montarPlano`
completo, incluindo sua preparação e metadados. Portanto, a comparação de tempo
não isola o algoritmo: descreve este experimento sintético e não latência de
um produto real. Não houve inferência, rede, teste de significância nem
medição em Linux/Windows. Variação de JIT, GC e carga do computador permanece.

## Planejamento

| Cenário | Tarefas | Faixas | Agrupamento anterior: mediana [mín, máx], ms | Plano atual: mediana [mín, máx], ms | Comparações anteriores | Referências indexadas |
|---|---:|---:|---:|---:|---:|---:|
| Independentes | 500 | 500 | 3.22 [2.98, 3.54] | 0.74 [0.53, 1.00] | 124,750 | 500 |
| Independentes | 2000 | 2000 | 33.70 [33.09, 36.26] | 1.77 [1.49, 7.30] | 1,999,000 | 2,000 |
| Independentes | 6000 | 6000 | 311.10 [307.55, 315.00] | 6.78 [5.92, 12.36] | 17,997,000 | 6,000 |
| Arquivo comum a cada 10 | 500 | 50 | 0.69 [0.68, 1.74] | 0.45 [0.39, 0.57] | 24,950 | 1,000 |
| Arquivo comum a cada 10 | 2000 | 200 | 9.13 [8.78, 9.44] | 1.27 [1.20, 1.71] | 399,800 | 4,000 |
| Arquivo comum a cada 10 | 6000 | 600 | 92.22 [91.17, 93.88] | 4.20 [3.66, 4.75] | 3,599,400 | 12,000 |

O índice de arquivos com union-find evita comparar cada tarefa com todas as
faixas. No caso independente de 6.000 tarefas, a implementação anterior faz
17.997.000 verificações; a atual indexa 6.000 referências de arquivos. Isso
explica o ganho de escala observado sem prometer o mesmo fator em todo projeto.

## Varredura de arquivos

Árvore de 720 arquivos, um glob ancestral e dez globs de subárvores. A varredura
anterior faz 121 leituras de diretório; a atual faz 81, redução de
33.1%, preservando a mesma lista ordenada de arquivos.
Mediana anterior: 6.24 ms; atual: 4.32 ms.

O carregamento do projeto também reúne globs de testes/código antes da varredura;
esta tabela mede apenas a remoção de raízes redundantes em `walkFiles`, sem
atribuir um fator de ganho não medido ao restante de `loadProject`.

## Acompanhamento sem inferência auxiliar

O novo executor não chama modelo para resumir progresso a cada minuto. Essa
remoção elimina essas chamadas por construção; não há estimativa de economia
monetária, pois preço, duração e tokens variam por harness e conta.

## Matriz de compatibilidade

A CI foi configurada para Linux, macOS e Windows com Node 18, 20 e 22. Este
artefato registra apenas a execução local acima; configurar a matriz não
equivale a comprovar os nove jobs remotos.
