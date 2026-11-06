# Codex: integração nativa

Verificado em 2026-11-06. Descubra ferramentas da sessão e `codex --help`.
A aplicação, IDE, CLI e SDK não expõem necessariamente a mesma superfície.

| Necessidade | Preferência nativa | Limite e fallback |
|---|---|---|
| Plano/progresso | Ferramenta de plano/tarefas exposta pelo cliente | Publique mudanças de estado, sem painel de specs |
| Perguntas | Ferramenta request_user_input ou versão assíncrona disponível | Algumas versões/modos restringem a ferramenta; nesse caso pergunte no chat |
| Paralelismo | Ferramentas nativas de colaboração e worktrees | Respeite vagas e isolamento reais |
| Pesquisa | Ferramentas de busca/web e fontes conectadas | Use fontes primárias e cite evidência |
| Modelos | App-server `model/list` autenticado, com paginação | Catálogo pode ser limitado pelo provedor; mantenha o identificador validado |
| Créditos | App-server `account/rateLimits/read` e eventos de atualização | Nem todo login/provedor oferece cota percentual |
| Espera | Timer/agendamento nativo anunciado pelo cliente | Caso ausente, executor Node + checkpoint; não invente `/timer` |
| Conclusão | Notificação de conclusão configurada no cliente | Só use API de notificação se efetivamente exposta e habilitada |

O app-server é consultado por stdio com handshake da versão instalada; não é
um painel nem servidor web criado pela skill. Não leia tokens de autenticação
para consultar endpoints privados. Headless usa `codex exec --json`, sandbox
existente e argumentos permitidos para o worktree. Nunca aumente sandbox para
contornar erro de escrita.

Considere todas as janelas aplicáveis retornadas pela conta/modelo. Guarde o
reset como timestamp absoluto e consulte novamente no despertar. Créditos
avulsos, limite de plano, janela de contexto e consumo de tokens são diferentes.
Se o app-server reportar conta/modelo indisponível, não substitua por outro
provedor ou nome aprendido anteriormente.

Fontes: [protocolo do app-server: modelos, cota, eventos e interação](https://learn.chatgpt.com/docs/app-server),
[CLI e comandos disponíveis](https://learn.chatgpt.com/docs/developer-commands).
