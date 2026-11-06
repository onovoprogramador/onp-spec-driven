# ONP Spec 0.10.0 — resumo acessível

[Ver o resumo visual em SVG](ATUALIZACOES-0.10.0.svg).

- **Performance:** no cenário sintético local de 6.000 tarefas independentes,
  a mediana do agrupamento anterior foi **311,10 ms** e a do plano atual completo,
  **6,78 ms**. Foram sete amostras após aquecimento, em macOS/M1 Pro e Node 22.14.0.
  Os escopos medidos diferem; isso não mede latência nem benefício de um produto.
- **Preservação:** arquivos existentes, customizações, planos, scripts e HTML
  permanecem. Novas skills e planos usam versões separadas. Não há exigências
  documentais retroativas; compatibilidade com scripts 0.9 foi testada.
- **Documentação nova:** research, PRD com a voz do cliente, ADR, TDD completo,
  specs e tarefas ligados entre si. Impacto em domínio anterior exige aviso e
  pergunta antes de executar. Falta de dados na pesquisa leva a conclusão
  inconclusiva, não a estatísticas inventadas.
- **Continuidade:** com 5% ou menos de cota restante, o novo executor pausa,
  mantém checkpoint, aguarda e consulta novamente. Só retoma com liberação
  verificada. Sem telemetria, o despacho inicial bloqueia. Timers dependem de
  processo ou agendamento operante; scripts antigos mantêm seu comportamento.
- **Recursos nativos:** plano e tarefas por eventos, modelos disponíveis na
  conta e notificações quando ativadas. Ao encerrar, pergunta antes de limpar
  worktrees; trabalho ativo, sujo ou não integrado permanece.
- **Checkpoint de validação:** em **06/11/2026 às 13:09, São Paulo**, passaram
  **343 de 343 testes** em Node 18.20.8 e novamente em Node 22.14.0 no macOS.
  A CI multiplataforma está configurada; seus resultados remotos não foram
  comprovados nesta sessão. **Situação naquele checkpoint: publicação npm pendente.**

Os números são o registro dos [resultados de performance](../benchmark/PERFORMANCE.md)
e da [verificação da versão](RELEASE-0.10.0.md), não uma nova execução de testes.
