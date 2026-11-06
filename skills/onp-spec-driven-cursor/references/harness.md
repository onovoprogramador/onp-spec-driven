# Cursor: integração nativa

Verificado em 2026-11-06. Inspecione ferramentas do Agent e `agent --help`.
Use a variante da skill instalada em `.cursor/skills/onp-spec-driven`.

| Necessidade | Preferência nativa | Limite e fallback |
|---|---|---|
| Plano/progresso | Plan, tarefas e Agents Window nativos | Evite tabelas repetidas e interfaces próprias |
| Perguntas | Ferramenta de perguntas do Agent | Em ACP, `cursor/ask_question` requer cliente que responda |
| Paralelismo | Subagentes e worktrees nativos | Headless Node quando necessário e disponível |
| Pesquisa | Web/browser/ferramentas do Agent | Cite fontes primárias, sem supor disponibilidade |
| Modelos | `agent --list-models` / `agent models` conforme ajuda | Use exatamente um identificador listado para esta conta |
| Créditos | Fonte de uso oficialmente exposta na sessão/provedor | Listagem de modelos e tokens consumidos não fornecem saldo |
| Espera | Automação/timer nativo se exposto | Node com checkpoint se não houver; não invente endpoint de billing |
| Conclusão | Notificações existentes do Agent | ACP `cursor/task` informa término de subagente, não é toast genérico |

Headless usa `agent -p --output-format stream-json`. `--force` permite escrita
no modo print, preservando as restrições configuradas em `.cursor/cli.json`.
Não altere a política de permissões para contornar um bloqueio.
A integração atual não envia um `--effort` inventado. Se esforço for parte do
identificador do modelo, selecione apenas a variante realmente listada;
não construa slugs concatenando sufixos.

Quando a conta não expõe cota restante, reporte “desconhecida” e configure uma
ponte para dados oficiais existentes antes de prometer pausa exata em 5%.
Um erro 429 pode informar tentativa posterior; não significa necessariamente
que créditos financeiros foram restaurados.


O executor headless exige `paralelo.quotaCommand` como array
`[executável, ...argumentos]` apontando para uma ponte que consulte telemetria
oficial do cliente/provedor. A resposta JSON identifica `harness`,
`observedAt` e janelas de cota; um snapshot antigo não libera execução.
Sem essa leitura na partida, retorna `QUOTA_UNAVAILABLE` antes de inferência.
Depois de limite confirmado, permanece esperando até leitura nova liberada.

Fontes: [Agent e ferramentas](https://cursor.com/docs/agent/overview),
[CLI](https://cursor.com/docs/cli/overview),
[parâmetros e modelos](https://cursor.com/docs/cli/reference/parameters),
[ACP: perguntas, plano e conclusão](https://cursor.com/docs/cli/acp).
