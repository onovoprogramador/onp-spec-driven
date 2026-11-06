# Claude Code: integração nativa

Verificado em 2026-11-06. Consulte `claude --help` e as ferramentas anunciadas
pela sessão antes de usar uma capacidade; versão, conta e permissões importam.

| Necessidade | Preferência nativa | Limite e fallback |
|---|---|---|
| Plano/progresso | TaskCreate/TaskUpdate/TaskList, ou TodoWrite se exposto | Use os nomes realmente presentes; não monte painel |
| Perguntas | AskUserQuestion no agente principal | Subagente/headless devolve impedimento se não puder perguntar |
| Paralelismo | Agent, contexto isolado e worktree nativo quando disponíveis | Não delegue mudanças nos mesmos arquivos simultaneamente |
| Pesquisa | WebSearch/WebFetch e leitura local | Registre fontes; ausência de web não vira evidência |
| Modelos | Inicialização de controle do CLI/SDK, `models`/`supportedModels` | Valide identificador e esforços aceitos; não fixe nomes |
| Créditos | `/usage`; dados `rate_limits` na statusline oficial | Statusline precisa estar ativa e seu snapshot ser recente |
| Espera | CronCreate/CronList/CronDelete quando expostos | Revalide saldo ao despertar; timer não comprova reset |
| Conclusão | Notificação normal do harness e hooks já habilitados | Não instale script de notificação nem mude preferências |

Headless usa `claude -p` com saída `stream-json`; respeite permission mode e
allowed tools existentes. Nunca use bypassPermissions para resolver uma falha.
A consulta ao controle de modelos não precisa enviar um prompt de inferência.
Na statusline, `rate_limits.five_hour` e `seven_day` podem fornecer
`used_percentage` e `resets_at`; não converta percentual de contexto em saldo.
Campos de cota podem faltar antes de uma resposta ou conforme o tipo de conta.

Timers de sessão só funcionam enquanto o cliente está vivo e apto a executar.
Depois de reiniciar, valide o timer/checkpoint real antes de prometer retomada;
schedulers nativos duráveis dependem da instalação/configuração existente.


O executor headless exige `paralelo.quotaCommand` como array
`[executável, ...argumentos]` apontando para uma ponte que consulte telemetria
oficial do cliente/provedor. A resposta JSON identifica `harness`,
`observedAt` e janelas de cota; um snapshot antigo não libera execução.
Sem essa leitura na partida, retorna `QUOTA_UNAVAILABLE` antes de inferência.
Depois de limite confirmado, permanece esperando até leitura nova liberada.

Fontes: [subagentes](https://code.claude.com/docs/en/sub-agents),
[SDK](https://code.claude.com/docs/en/agent-sdk/typescript),
[statusline](https://code.claude.com/docs/en/statusline),
[agendamento e limitações](https://code.claude.com/docs/en/scheduled-tasks),
[hooks de notificação](https://code.claude.com/docs/en/hooks).
