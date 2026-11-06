# Antigravity: integração nativa

Verificado em 2026-11-06. Distinga App/IDE e CLI: descubra ferramentas da
sessão e `agy --help`. Versões antigas podem não oferecer o CLI atual.

| Necessidade | Preferência nativa | Limite e fallback |
|---|---|---|
| Plano/progresso | Task groups, Implementation Plan e Artifacts | São recursos nativos; não gere dashboard HTML paralelo |
| Perguntas | Revisão/pergunta nativa disponível no agente principal | Sem ferramenta, chat com decisão explícita registrada |
| Paralelismo | Agent Manager, subagentes e worktrees nativos | CLI `agy` quando autenticado e compatível |
| Pesquisa | Ferramentas web/codebase anunciadas | Pesquisa citada, sem fabricar fontes |
| Modelos | `agy models` | Escolha apenas IDs disponíveis para a conta |
| Créditos | `/usage`/`/quota` e quota buckets da statusline oficial | Snapshot recente; `remaining_fraction` não é percentual inteiro |
| Espera | Timer/automação disponível na sessão | Node com checkpoint quando não exposto |
| Conclusão | Configuração nativa `notifications` quando habilitada | Não ative silenciosamente nem crie mecanismo de desktop próprio |

Headless atual: `agy -p <prompt> --output-format stream-json`; valide as flags
na instalação. `--conversation <id>` retoma a conversa exata; não use “última”
quando há várias execuções. `--effort` só aceita níveis suportados pelo modelo.
A statusline pode fornecer `remaining_fraction`, `reset_time` ou
`reset_in_seconds`; interprete unidades e mantenha evidência temporal.

A política “Always Proceed” do cliente não substitui resposta do dono do
produto para interferência em domínio anterior ou conflito com ADR/PRD.
Registre impedimento antes de alterar os contratos mesmo em headless.


O executor headless exige `paralelo.quotaCommand` como array
`[executável, ...argumentos]` apontando para uma ponte que consulte telemetria
oficial do cliente/provedor. A resposta JSON identifica `harness`,
`observedAt` e janelas de cota; um snapshot antigo não libera execução.
Sem essa leitura na partida, retorna `QUOTA_UNAVAILABLE` antes de inferência.
Depois de limite confirmado, permanece esperando até leitura nova liberada.

Fontes: [headless](https://antigravity.google/docs/cli/headless/),
[comandos e notificações](https://antigravity.google/docs/cli/reference),
[uso/cota](https://antigravity.google/docs/cli/commands/usage),
[statusline](https://antigravity.google/docs/cli/statusline),
[Implementation Plan](https://antigravity.google/docs/ide-implementation-plan),
[política de revisão](https://antigravity.google/docs/artifact-review).
