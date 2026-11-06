# OpenCode: integração nativa

Verificado em 2026-11-06. Inspecione `opencode --help`, provedores conectados e
ferramentas da sessão. Instale esta variante em `.opencode/skills/onp-spec-driven`
ou no diretório global de skills do OpenCode, preservando esse nome de pasta.

| Necessidade | Preferência nativa | Limite e fallback |
|---|---|---|
| Plano/progresso | `todowrite`, modos/agents Build e Plan disponíveis | Subagentes podem ter ferramentas desabilitadas |
| Perguntas | `question` no cliente interativo | Headless precisa devolver impedimento ao orquestrador |
| Paralelismo | Ferramenta nativa de subagente/sessões | Worktree por execução para arquivos independentes |
| Pesquisa | `webfetch` e `websearch` quando expostos | `websearch` depende do provedor/configuração |
| Modelos | `opencode models --refresh` e provedores autenticados | Preserve ID `provider/model`; catálogo não é prova de crédito |
| Créditos | Dados oficiais do provedor por integração disponível | OpenCode não implica um saldo único entre provedores |
| Espera | Timer/plugin nativo já disponível e autorizado | Sem ele, Node e checkpoint; não instale daemon próprio |
| Conclusão | `client.tui.showToast` em sessão TUI conectada, quando habilitado | Ausência de TUI/API implica fallback de conclusão/chat |

Headless usa `opencode run --format json --model <provider/model>`. Respeite
permissões do OpenCode; não habilite ferramentas negadas para fazer um plano
passar. Quando houver sessão anterior, retome seu identificador exato.

Não inicie servidor web só para notificar. Se já houver conexão nativa do
cliente/SDK, use a API de toast e eventos que ela oferece, respeitando a
preferência de notificações. Sem fonte de cota confiável, reporte desconhecida;
gasto em tokens/dólares de uma sessão não estabelece saldo da conta.


O executor headless exige `paralelo.quotaCommand` como array
`[executável, ...argumentos]` apontando para uma ponte que consulte telemetria
oficial do cliente/provedor. A resposta JSON identifica `harness`,
`observedAt` e janelas de cota; um snapshot antigo não libera execução.
Sem essa leitura na partida, retorna `QUOTA_UNAVAILABLE` antes de inferência.
Depois de limite confirmado, permanece esperando até leitura nova liberada.

Fontes: [skills e locais de instalação](https://opencode.ai/docs/skills/),
[ferramentas e perguntas](https://opencode.ai/docs/tools/),
[CLI e modelos](https://opencode.ai/docs/cli/),
[SDK: TUI e eventos](https://opencode.ai/docs/sdk/).
