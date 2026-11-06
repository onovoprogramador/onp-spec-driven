# Preservação e compatibilidade

Atualizar ou instalar a skill não autoriza alterar artefatos já existentes do
cliente. Preserve conteúdo e caminhos de specs, PRDs, ADRs, designs, pesquisas,
constituição, planos, scripts, HTML, configuração e customizações da skill.
Não renomeie, apague, sobrescreva, acrescente links nem complete seções antigas
para adequá-las ao novo padrão.

## Trabalho novo e trabalho existente

- Uma **nova especificação grande** recebe PRD, ADR, TDD, research, spec e tarefas
  vinculados. Todo `design.md` **novo** segue a estrutura completa.
- Especificações existentes continuam com seus contratos anteriores. Não
  imponha retroativamente novos documentos, seções, links ou aprovação só
  porque a skill foi atualizada. Continue a implementação já autorizada e os
  comandos de estado/prova pertinentes ao trabalho; isso não autoriza uma
  migração documental automática.
- Leia domínios e decisões anteriores como entradas para o trabalho novo.
  Antes de interferir neles, alerte e use a pergunta nativa. Não acrescente
  links recíprocos nos originais: a proposta nova pode apontar para eles.
- Se o cliente pedir uma revisão de documento existente, apresente uma
  **proposta em versão separada**, com diferença, motivo e referências ao
  original. A decisão explícita seleciona a proposta aplicável; o original
  permanece preservado. Pedido de implementação não é autorização implícita
  para reescrever a documentação histórica.

## Instalação e planos

`init` preserva qualquer instalação existente. Uma variante nova do mesmo
harness pode ser instalada ao lado como `onp-spec-driven-<harness>-v<versao>`;
o nome da skill corresponde à pasta, por exemplo `onp-spec-driven-codex-v4-0-0`.
Use esse nome ao invocá-la e mantenha
claro qual versão está ativa. Para outro harness com destino já ocupado,
`init --agents <harness> --nova-versao` escolhe uma instalação separada. Nunca
mescle arquivos novos com customizações antigas nem recomende remover a antiga
como condição para atualizar. Na cópia manual, escolha um destino vazio.

O primeiro plano nativo usa os caminhos históricos da feature somente se
nenhum artefato de plano existir. Quando já existe Markdown, JSON, script ou
HTML, um plano novo é criado em `execucoes/<runId>/` dentro da feature. Os
artefatos existentes ficam intactos; planos e scripts anteriores não precisam
ser regenerados só pela atualização.

`executar <feature>` seleciona o plano nativo mais recente; use `--run <id>`
para escolher uma execução exata. O wrapper gerado fixa essa identificação.
Scripts legados continuam disponíveis nos caminhos originais e preservam seu
comportamento; as garantias novas de cota/checkpoint são do executor nativo
desta versão. A execução nativa confere se as fontes do seu plano permanecem atuais: uma revisão de
escopo solicitada gera uma versão separada de plano, sem substituir o anterior.
Nunca trate a falta de metadados novos em um plano legado como licença para
reescrevê-lo. Não gere novos painéis; preserve HTML preexistente.
