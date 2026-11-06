# Governança, TDD e research

## Artefatos para nova especificação grande

Consulte [preservacao.md](preservacao.md): o padrão não é retroativo. Crie o
conjunto em uma feature nova com `onp-spec new <feature> --grande`. Todos os
arquivos novos desse conjunto devem ligar entre si por links relativos válidos
e apontar o requisito/decisão que motivou cada implementação. Documentos de
features anteriores são entradas de leitura e não recebem links ou seções
automaticamente:

- `prd.md`: pedido literal do cliente, fonte/data, problema, público, objetivos,
  restrições, não objetivos, histórias, métricas de resultado e dúvidas.
  Cite as palavras originais; mantenha interpretações e propostas separadas.
- `adr.md`: contexto, alternativas consideradas, decisão proposta/aceita,
  justificativa, consequências, domínio, status, autoria/decisão do cliente e
  quais decisões anteriores substitui. Não apague histórico para ocultar conflito.
- `design.md`: TDD técnico completo, vinculado ao PRD, ADR, pesquisa, spec e tarefas.
- `spec.md`/`tasks.md`: comportamento verificável e implementação rastreada.
- `research.md`: fontes, observações, comparação, análise e recomendação com limites.

Para mudanças pequenas, preserve proporção. Se criar `design.md`, a estrutura
completa é obrigatória mesmo assim; a profundidade acompanha o risco.

## TDD técnico completo

A referência é a skill solicitada como `technical-design-doc-creator` da Tech
Leads Club, atualmente publicada como
[create-technical-design-doc](https://github.com/tech-leads-club/agent-skills/blob/main/packages/skills-catalog/skills/%28creation%29/create-technical-design-doc/SKILL.md).
O projeto usa seu próprio template, sem depender de instalar essa skill.

Preencha contexto e problema; objetivos/não objetivos; requisitos/restrições;
visão arquitetural e componentes; interfaces/APIs/contratos; modelo e ciclo de
vida dos dados; decisões/alternativas; dependências e domínios; segurança e
privacidade; falhas/retries/idempotência; observabilidade; capacidade e orçamento
de performance; testes/validação; migração e compatibilidade; rollout/rollback;
riscos e perguntas; marcos/responsáveis; revisão e rastreabilidade.

Quantifique orçamentos com unidade e cenário. “Rápido” deve virar, por exemplo,
p95 sob uma carga, hardware, volume e condição de cache definidos. Um diagrama
só entra quando ajuda a entender relações; não substitui contratos ou decisões.
Use “não aplicável — motivo” quando não houver algo a projetar naquela seção.

## Conflitos antes da execução

Leia os documentos vigentes dos domínios que compartilham dados, APIs ou regras
com a mudança. Compare o comportamento proposto, não apenas nomes de arquivos.
Uma nova integração pode afetar um domínio sem editar seus arquivos.

A revisão registra os documentos consultados, domínios/arquivos afetados,
conflitos e origem da avaliação. O motor detecta referências/pendências e
invalidade após mudanças; a análise semântica continua sendo responsabilidade
do agente. “O parser não achou nada” não prova ausência de conflito.

Apresente ao cliente: regra e link, cenário que muda, impacto e opções.
Use a ferramenta de perguntas nativa do harness; sem resposta explícita, não
execute a tarefa dependente. Interferência em domínio anterior exige alerta
mesmo se não houver violação aparente. Grave a resposta, fonte, data e escopo.
Reavalie se PRD, ADR, spec, tarefas ou constituição mudarem. Aprovação anterior
não vale para um novo conflito. Se for preciso revisar documentos existentes,
apresente uma proposta em versão separada e preserve os originais. Vincule os
novos documentos entre si e aos contratos anteriores, sem editar os anteriores.


### Registro pelo motor

`onp-spec impacto <feature>` retorna os documentos, conflitos e pendências.
Depois de ler os contratos e revisar a mudança, registre um arquivo JSON:

```json
{
  "summary": "Análise concreta dos contratos e domínios atingidos.",
  "reviewer": "harness e identificação da sessão/revisor",
  "conflicts": [
    {
      "id": "regra-de-atraso",
      "summary": "A proposta altera o comportamento de entregas atrasadas.",
      "rule": ".spec/features/avaliacao/adr.md#decisao"
    }
  ]
}
```

Use `impacto <feature> --revisao <arquivo.json>`. `conflicts: []` só é válido
quando a leitura realmente não encontrou conflito semântico; impactos detectados
pelo motor continuam exigindo decisão. Após perguntar e receber resposta:

```json
{
  "conflictId": "regra-de-atraso",
  "choice": "prosseguir",
  "answer": "Resposta literal que o cliente de fato enviou.",
  "source": "Ferramenta de pergunta e identificador da mensagem/resposta"
}
```

Use `impacto <feature> --decisao <arquivo.json>`. Opções: `prosseguir`,
`ajustar` ou `cancelar`; as duas últimas mantêm o trabalho bloqueado até
adequar a proposta ou encerrar seu escopo. Esses exemplos não são autorizações.
A decisão exige revisão atual e o `conflictId` reportado pelo motor.

## Research que melhora o produto

1. Parta do problema e das palavras do cliente. Explicite qual decisão a
   pesquisa pode alterar e o custo de errar; não transforme todo ajuste em
   um estudo extenso.
2. Procure fontes primárias atuais: documentação, produtos, preços públicos,
   estudos originais e dados autorizados do próprio cliente. Registre URL,
   data de consulta, versão/plano e observação reproduzível. Compare alternativas
   relevantes; não invente concorrente para completar uma tabela.
3. Separe fato observado, estimativa, hipótese e preferência. Uma landing page
   prova uma promessa comercial, não adoção, eficácia, performance ou ROI.
4. Faça análise quantitativa só com dados suficientes. Documente origem,
   tamanho da amostra, período, unidade, denominador, método de coleta e vieses.
   Sem dados, conclua “inconclusivo” e proponha coleta/experimento.
5. Apresente a recomendação e alternativas com tradeoffs. Se mudar escopo,
   contrato ou objetivo, pergunte ao cliente pela ferramenta nativa antes de
   incorporar a proposta. Registre a decisão no PRD/ADR da proposta nova e
   traduza para critérios, preservando documentos de versões anteriores.

### Matemática útil, com hipóteses visíveis

- Conversão `p = sucessos / elegíveis`: informe ambos os números e o período;
  use intervalo de confiança apropriado (por exemplo Wilson para proporções),
  especialmente com amostras pequenas. Não use normalidade sem justificar.
- Compare ganho absoluto `pB − pA` e relativo `(pB − pA) / pA`, marcando o
  segundo como indefinido se `pA = 0`. Não confunda pontos percentuais com %.
- Para experimento, defina unidade de randomização, métrica primária, efeito
  mínimo útil, poder, nível de significância e regra de parada antes de olhar
  o resultado. Ajuste múltiplas comparações e não trate correlação como causa.
- Para custo/benefício, `benefício líquido = benefício estimado − custo total`;
  declare horizonte, manutenção, custo de oportunidade e cenários pessimista,
  base e otimista. Evite falsa precisão e não invente receita do cliente.
- Para performance, compare mesma carga/ambiente, repetições e variabilidade;
  relate p50/p95/p99 quando o tamanho da amostra sustentar. Separe melhoria
  medida de estimativa e não generalize microbenchmark para o produto inteiro.

A análise deve produzir uma decisão verificável ou uma pergunta melhor, não
números decorativos. Persistem as regras e limites do domínio já acordados.
