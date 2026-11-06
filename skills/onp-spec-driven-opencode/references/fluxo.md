# Fluxo do pedido à prova

`onp-spec` abrevia `node <dir-desta-skill>/scripts/onp-spec.mjs`, executado na
raiz do projeto. Os exemplos funcionam em terminais Windows, Linux e macOS
com Node e Git disponíveis; não precisam de Bash.

```text
onp-spec init
onp-spec new entrega-dever-casa --grande --cliente "Alunos devem entregar o dever dentro do prazo."
onp-spec harness --agents <harness-atual>
```

O exemplo cria uma feature nova. Para trabalho existente, preserve documentos,
planos e contratos; não imponha PRD/ADR/TDD retroativamente. Revisão solicitada
vira proposta separada conforme [preservacao.md](preservacao.md).
Complete pesquisa, PRD, ADR, TDD, spec e tarefas novos; eles são vinculados.
No PRD mantenha a frase original, e na spec transforme-a em um cenário claro:

```markdown
### US-001 — Aluno entrega dentro do prazo
Como aluno, quero enviar meu dever antes do prazo, para que conte como no prazo.

#### AC-001 — Entrega dentro do prazo é aceita
- **Dado** um aluno autenticado com tarefa aberta
- **Quando** envia o arquivo antes do horário-limite
- **Então** a entrega fica registrada como dentro do prazo
```

Pergunte pelo fuso e regras de atraso quando não estiverem definidos. Consulte
PRD/ADRs existentes de avaliação e entrega como entradas de leitura antes de
mudar essas regras; registre impacto, pergunta e resposta na proposta nova,
preservando os originais. Não decida isso silenciosamente à noite.

```text
onp-spec scaffold entrega-dever-casa
onp-spec plano entrega-dever-casa --agents <harness-atual>
```

Apresente faixas de arquivos independentes, modelos realmente disponíveis e
esforços suportados. Reutilize a autorização do cliente ou solicite a escolha
nativa quando faltar. `--paralelizar T-001,T-003` limita as tarefas paralelas;
`--sequencial` executa em ordem. O estado vai ao plano/tarefas nativos.

```text
onp-spec executar entrega-dever-casa
```

`executar <feature>` usa o plano nativo mais recente; acrescente `--run <id>`
para selecionar a mesma execução após criar outra versão. Se já existiam
artefatos, o plano novo fica em `execucoes/<runId>/`; os anteriores permanecem.

O executor salva progresso, pausa ao atingir a reserva de cota, aguarda o reset
e consulta novamente antes de continuar. Não apague uma execução pausada para
“recomeçar limpo”. Se o processo foi encerrado, retome o checkpoint pela mesma
execução. Quando não existe telemetria, a limitação é explícita e requer fonte
nativa confiável. Sem leitura inicial recente, o despacho é bloqueado
(`QUOTA_UNAVAILABLE`); o valor não é adivinhado.

Falha localizada: inspecione log, alterações parciais e estado real; use
`executar <feature> --faixa <id>` ou `--seq <T-xxx>` sem repetir as concluídas.
Problema de domínio exige pergunta, não retry automático.

```text
onp-spec verify entrega-dever-casa
onp-spec audit --ci
onp-spec licoes sugerir
onp-spec worktrees entrega-dever-casa
```

PASS atual + audit exit 0 permitem concluir. Compartilhe prova e notifique
pelo harness se habilitado. No fim da sessão, pergunte se o cliente quer limpar
os worktrees apresentados, identificados pelo `runId` desta sessão. Só execute
`worktrees <feature> --run <id> --limpar --confirmar` após autorização; preserve trabalho ativo, sujo ou não integrado. Sem resposta,
manter é obrigatório. Uma espera de cota não é fim da execução nem motivo para
apagar seus worktrees.

CI usa o mesmo motor: execute `verify` e `audit --ci`. Teste pulado, prova
antiga e requisito sem teste não são conclusão. Consulte `status`, `assumptions`
e `resumo` quando precisar inspecionar o estado; não é necessário abrir painel.
