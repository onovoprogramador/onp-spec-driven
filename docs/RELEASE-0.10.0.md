# Atualização 0.10.0

Pacote preparado no repositório; publicação npm, tag e release remota são
etapas separadas. As cinco variantes da skill passam para `4.0.0`.

## Requisitos, implementação e evidência

| Requisito | Implementação | Verificação relevante |
|---|---|---|
| Melhorar performance | Índice de arquivos/union-find no plano; uma varredura de candidatos e eliminação de raízes redundantes | `test/plano.test.js`, `test/multi-root.test.js`; [medições reproduzíveis](../benchmark/PERFORMANCE.md) |
| Substituir acompanhamento próprio em novas execuções | Plano Markdown/JSON e executor Node; tarefas/planos nativos, sem resumo por modelo a cada minuto; HTML anterior preservado | `test/agents-plano.e2e.test.js`, `test/plano.test.js`; revisão das cinco `SKILL.md` |
| Incluir OpenCode e preservar os demais | Cinco adaptadores e cinco pacotes com o mesmo motor; descoberta de modelos pelo harness | `test/harness.test.js`, `test/agents-plano.e2e.test.js`, `test/skill-sync.test.js` |
| Modelos headless existentes | Catálogo nativo consultado na execução; identificadores não listados bloqueados | `test/harness.test.js`, `test/executor.test.js` |
| Pausar na reserva de 5% | Normalização de janelas, timestamp, reset e backoff; checkpoint e consulta nova antes de retomar bloqueio confirmado | `test/quota.test.js`, `test/executor.test.js` |
| Preservar trabalho durante a noite | Sessão exata e alterações parciais mantidas; tarefas concluídas não repetidas | `test/executor.test.js`, `test/reexecucao*.test.js` |
| Perguntar sobre limpeza no fim da sessão | Pergunta nativa nas skills; listagem restrita a worktrees registrados; limpeza com confirmação e verificações Git | `test/executor.test.js`, `test/skill-sync.test.js` |
| Novos PRD nas palavras do cliente, ADR, TDD e specs ligados | `new --grande`; seis documentos novos com links; pedido literal preservado; template TDD completo sem exigência retroativa | `test/governance.test.js`, `test/agents-plano.e2e.test.js` |
| Avisar antes de interferir em domínio/PRD/ADR | Revisão semântica, registro de conflitos e resposta com origem; revisão/decisão desatualizada bloqueia execução | `test/governance.test.js`, `test/executor.test.js` |
| Research de produto com matemática honesta | Template/referência com fontes, concorrentes, amostra, viés, incerteza, custo/benefício, métricas e perguntas | `templates/research.md`, `references/governanca.md` das skills; validação documental em `test/governance.test.js` |
| Usar recursos e notificações nativos | Matriz por harness, capacidades descobertas, hooks/ponte de notificação apenas quando habilitados | `test/harness.test.js`, `test/executor.test.js`; referências oficiais em cada skill |
| Compatibilidade entre sistemas | Node/argumentos estruturados, launcher Windows compatível, expansão de testes sem glob do shell | `test/harness.test.js`; CI Linux/macOS/Windows × Node 18/20/22 em `.github/workflows/ci.yml` |
| Evitar plano obsoleto e falsa retomada | Impressão das fontes do plano; verificação de commits integrados ao retomar | `test/executor-integrity.test.js` |
| Preservar todos os artefatos existentes | Instalação separada, planos novos versionados, originais intactos e ausência de novas exigências documentais retroativas | `test/install.test.js`, `test/governance-legacy.test.js`, `test/agents-plano.e2e.test.js`; scripts originais em `test/legacy-runtime.test.js` |

As referências de teste indicam onde verificar cada comportamento; não
substituem a saída do comando final nem demonstram testes ao vivo com todas
as contas/CLIs. Os contratos documentais também exigem julgamento semântico:
um parser não prova sozinho ausência de conflito em linguagem natural.

## Atualização sem migração automática

`init --agents <harness>` preserva arquivos existentes, inclusive a skill
customizada. Uma versão diferente do mesmo harness é instalada ao lado, como
`onp-spec-driven-<harness>-v<versao>`, com nome correspondente no frontmatter.
Os pontos da versão viram hífens, como `onp-spec-driven-codex-v4-0-0`.
Invoque explicitamente a versão escolhida. Se outro harness ocupa o destino,
`--nova-versao` permite um destino separado. Na instalação manual, use uma pasta
vazia; não sobreponha a instalação anterior.

Specs, PRDs, ADRs, designs, research, constituição, configuração e planos antigos
permanecem preservados. Não há requisito retroativo de novo TDD/PRD/ADR, links
ou regeneração de plano. A implementação já autorizada continua com seus
contratos; a atualização não é autorização para migrar seus documentos.
Se o cliente solicitar revisão, apresente uma proposta em versão separada e
preserve o original. Domínios anteriores continuam como entradas de leitura
para avaliar mudanças novas.

Um plano novo usa a raiz da feature apenas quando não há nenhum artefato de
plano. Com Markdown, JSON, script ou HTML anterior, usa
`.spec/features/<feature>/execucoes/<runId>/`, preservando todos os arquivos
antigos. `executar <feature>` seleciona o plano nativo mais recente; `--run <id>`
seleciona um plano exato. O wrapper gerado fixa essa execução. Scripts legados
continuam disponíveis sem regeneração obrigatória e mantêm seu comportamento.
As novas garantias de cota/checkpoint pertencem ao executor nativo desta versão.

Preserve checkpoints e worktrees. `worktrees <feature>` consulta o histórico
arquivado, inclusive quando existem versões novas de plano. A limpeza de uma
execução confirmada usa `--run <id>`; cada execução tem seus próprios caminhos.

`impacto <feature> --revisao <arquivo.json>` registra uma análise já feita;
`--decisao <arquivo.json>` registra uma resposta realmente recebida pela
ferramenta nativa. Nenhum dos comandos autoriza o agente a responder pelo cliente.
Uma proposta de escopo nova exige avaliação própria; ela não reescreve os
documentos anteriores para tornar a aprovação válida.

## Limites observáveis

- **Cota:** Codex fornece consulta nativa pelo app-server. Outros ambientes
  podem depender de statusline/ponte para dados oficiais; Cursor e OpenCode
  não possuem um saldo universal que esta skill possa deduzir. Sem percentual
  recente, o despacho inicial bloqueia com `QUOTA_UNAVAILABLE`, sem inferência.
  Claude, Cursor, Antigravity e OpenCode exigem uma ponte `quotaCommand` para
  telemetria oficial. Depois de bloqueio confirmado, ausência de nova leitura
  mantém a espera; não autoriza retomada.
- **Timers:** retomada local exige processo vivo ou scheduler nativo operante.
  O checkpoint permite recuperar trabalho após reinício, mas não liga uma
  máquina desligada. Reset previsto precisa de nova consulta, não é liberação.
- **Notificações e perguntas:** disponibilidade varia entre app, IDE, CLI e
  headless. A skill usa os recursos efetivamente expostos e preserva preferências;
  não cria painel, servidor ou mecanismo externo para simular capacidade ausente.
- **Sistemas operacionais:** a matriz de CI está configurada. Testes locais e
  simulação de launcher Windows não equivalem à execução dos nove jobs remotos,
  nem validam cada versão do CLI de fornecedor em cada sistema.
- **Performance:** o relatório registra entradas sintéticas, máquina, versão do
  Node, amostras e limites. Não transforma ganho do motor em promessa de latência
  ou economia monetária de um produto do cliente.

## Gate de entrega

```text
node tools/build-skill.mjs
npm test
npm pack --dry-run
git diff --check
```

Registre o resultado desses comandos após a última alteração. Publicação e
compatibilidade ao vivo com serviços externos só devem ser afirmadas com
suas próprias evidências.

## Checkpoint funcional de 06/11/2026 às 13:09 — preservação e compatibilidade

```text
VERIFICATION REPORT
-------------------
Claim: Build das cinco skills, atualização sem sobrescrita, compatibilidade 0.9 e pacote local validados
Command: node tools/build-skill.mjs; npm test; npx --yes node@18 tools/test.mjs; npm pack --dry-run --json; git diff --check
Executed: 2026-11-06 13:09 (America/Sao_Paulo), após as alterações de código
Exit code: 0 em todos os comandos
Output summary: Node 22.14.0: tests 343; pass 343; fail 0; skipped 0. Node 18.20.8: tests 343; pass 343; fail 0; skipped 0. Pacote 0.10.0: 264 arquivos, cinco skills autossuficientes presentes.
Warnings: none
Errors: none
Verdict: PASS
```

Os testes de atualização comparam bytes e mtimes de specs, documentos livres,
constituição/configuração, skills customizadas e artefatos de planos. Exercitam
planos versionados, seleção fixa por `--run`, instalação idempotente, features
parciais e `specDir` personalizado. Scripts originais da versão 0.9 executam
com o motor atual, incluindo gates reais e uma regressão de teste detectada.
A atualização de status altera somente seu token e mantém LF/CRLF, espaços e
linhas em branco; retomadas não repetem tarefas concluídas.

O executor detecta alterações em artefatos Git existentes antes de concluir
uma tarefa ou integrar um worktree. No modo paralelo, os originais na árvore
principal ficam intactos e o trabalho divergente fica para revisão. No modo
sequencial, a detecção ocorre após a ação do worker no checkout principal:
é um bloqueio de conclusão/continuação, não uma sandbox de escrita, e não faz
rollback automático. A instalação e a geração de planos não executam workers.

A execução local foi no macOS; a matriz remota de sistemas operacionais não
foi executada nesta sessão. Os testes legados de Bash são específicos de POSIX.
`git worktree list --porcelain` confirmou apenas a árvore principal do projeto;
os worktrees temporários dos testes foram removidos. Nesse checkpoint, a
publicação npm ainda não havia sido realizada.
