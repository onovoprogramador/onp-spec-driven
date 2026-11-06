import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditProject } from '../src/core/audit.js';
import { loadProject } from '../src/core/project.js';
import { loadConfig } from '../src/config.js';
import {
  GOVERNANCE_DOCUMENTS, DOCUMENTATION_MARKER, documentLinks, scaffoldGovernance as createBundle, checkGovernance,
  recordImpactReview, recordGovernanceDecision, validateDesignDocument,
} from '../src/core/governance.js';

function workspace(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onp-governance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function task(root, feature, file) {
  const dir = path.join(root, '.spec', 'features', feature);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'spec.md'), `# Spec: ${feature}\n`);
  writeFileSync(path.join(dir, 'tasks.md'), `## T-001 — Implementar [pendente]\n\n- Refs: AC-001\n- Arquivos: ${file}\n`);
}

// Simula new --grande: links/proveniência são escritos apenas ao criar a
// spec/tasks desta fixture. O scaffold nunca migra arquivos que já existem.
function scaffoldGovernance(root, feature, options = {}) {
  const dir = path.join(root, '.spec/features', feature);
  if (!existsSync(path.join(dir, 'governance.json'))) {
    for (const file of ['spec.md', 'tasks.md']) {
      const filename = path.join(dir, file);
      if (existsSync(filename)) writeFileSync(filename, `${DOCUMENTATION_MARKER}\n\n${readFileSync(filename, 'utf8')}\n${documentLinks(file)}\n`);
    }
  }
  return createBundle(root, feature, { ...options, newFeature: true });
}

function reviewed(root, feature) {
  const dir = path.join(root, '.spec', 'features', feature);
  const bodies = {
    'prd.md': [
      null,
      'Clientes do checkout precisam pagar por boleto sem gerar duas cobranças para o mesmo pedido.',
      'O sucesso será medido pela proporção de pedidos pagos e pelo número de cobranças duplicadas. Ainda não há linha de base; medir antes do rollout.',
      'REQ-01: manter o boleto disponível; prioridade alta, associado a AC-001. A solicitação literal está na seção anterior.',
      'Entregar emissão de boleto para pedidos novos. Parcelamento e cobrança recorrente ficam fora do escopo.',
      'O domínio pagamento preserva a regra de uma cobrança por pedido. A alteração consulta o ADR da cobrança quando existir.',
      'A emissão depende do provedor de pagamentos. Uma indisponibilidade deve permitir retentar sem duplicar cobranças.',
      'O pedido literal foi fornecido na sessão de teste. Não existe autorização implícita para remover boleto ou alterar cobrança recorrente.',
    ],
    'adr.md': [
      'ADR-01, domínio pagamento: adotar uma chave de idempotência por pedido, para atender REQ-01 e AC-001.',
      'Permanece válida a restrição de uma cobrança por pedido; não há exceções aceitas nesta proposta.',
      'Comparadas emissão síncrona e fila persistente. A fila permite recuperação após falha; emissão síncrona reduz componentes, mas exige nova tentativa do cliente.',
      'Escolhida a chave de idempotência no provedor e registro local do identificador retornado, preservando tentativas repetidas.',
      'A implementação deve reconciliar resposta perdida e falhas do provedor. O TDD descreve a estratégia de recuperação.',
      'Revisar ao trocar de provedor ou alterar a regra de unicidade. Decisões anteriores ficam preservadas no histórico.',
      'A revisão técnica verificou a unicidade por pedido; qualquer alteração dessa regra requer uma nova pergunta ao cliente.',
    ],
    'design.md': [
      'Responsável técnico: equipe de pagamentos. Versão inicial da especificação, revisão registrada nesta sessão de teste.',
      'O checkout cria pedidos e solicita cobrança ao módulo financeiro. Os dois módulos compartilham o identificador imutável do pedido.',
      'Repetir a emissão após timeout pode duplicar cobranças; preservar a regra de cobrança única ao oferecer boleto.',
      'Inclui emissão e consulta do boleto para pedidos novos. Exclui parcelamento e mudança de provedor.',
      'Checkout envia pedidoId e valor para cobrança. O provedor recebe uma chave de idempotência. Estado local transita de pendente para emitida ou falha recuperável.',
      'Timeout pode ocultar emissão concluída: consultar pelo pedido antes de repetir. Falha do provedor deve manter pedido pendente. Dados pessoais devem permanecer protegidos.',
      'Primeiro adicionar o contrato idempotente; depois integrar checkout; por último validar recuperação e fazer rollout gradual.',
      'Somente o titular autenticado do pedido acessa o boleto. Logs omitem CPF e credenciais. Acesso ao provedor usa segredo gerenciado.',
      'Teste unitário cobre unicidade por pedido. Integração simula timeout seguido de consulta. AC-001 prova emissão e recuperação sem duplicidade.',
      'Observar emissão por status, tempo de resposta p95 e contagem de duplicidades. A equipe de pagamentos recebe alerta de taxa de falha acima do limite acordado.',
      'Ao detectar duplicidade, suspender novas emissões, manter consultas e reconciliar cobranças existentes antes de reativar.',
      'Comparar taxa de pagamento antes/depois e acompanhar duplicidade igual a zero. A meta de latência depende da medição inicial.',
      'Pedido representa uma compra; cobrança é a obrigação financeira; boleto é um instrumento da cobrança, nunca um pedido novo.',
      'O ADR-01 compara fila e emissão síncrona e registra o uso de idempotência no contrato com o provedor.',
      'Depende de API de emissão e consulta do provedor. Se idempotência não existir, bloquear ativação até revisar o contrato.',
      'Medir p50/p95/p99 sob carga representativa e concorrência observada; registrar amostra e hardware antes de definir orçamento de latência.',
      'Adicionar campos opcionais mantendo leitura de registros existentes. Ativar para um grupo pequeno, verificar resultados e ampliar gradualmente.',
      'Pergunta aberta: tempo de expiração do boleto. Até resposta, preservar o prazo atual do domínio financeiro.',
      'Marcos: contrato validado, integração testada, rollout revisado. Acompanhar tarefas no plano nativo do harness.',
      'Revisão técnica conecta REQ-01, ADR-01 e AC-001 à tarefa T-001. O gate exige evidência do runner antes de concluir a implementação.',
    ],
    'research.md': [
      'Hipótese: oferecer boleto aumenta acesso de clientes sem cartão. A decisão depende de dados locais de abandono e preferência de pagamento.',
      'Pesquisa externa ainda inconclusiva neste fixture: não foram observados concorrentes. A próxima coleta usará documentação pública dos provedores e registrará a data.',
      'Amostra e linha de base indisponíveis. Nenhum número de conversão de terceiros foi tratado como observação do nosso público.',
      'Benefício líquido será receita incremental menos implementação e operação. Sensibilidade deve variar taxa de adesão e custo por emissão; não há dados para estimar intervalo de confiança.',
      'Manter boleto atende ao pedido. Uma proposta de removê-lo exigiria evidência adicional e resposta explícita do cliente.',
      'Coletar abandono por forma de pagamento e taxa de conclusão durante janela previamente definida. Sem resultado, a hipótese permanece aberta no PRD.',
    ],
  };
  for (const file of ['prd.md', 'adr.md', 'design.md', 'research.md']) {
    const target = path.join(dir, file);
    let index = 0;
    const filled = readFileSync(target, 'utf8').replace(/^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm, (match, heading, body) => {
      const replacement = bodies[file][index++];
      return `## ${heading}\n\n${replacement ?? body.trim()}\n\n`;
    }).replace('status: rascunho', 'status: revisado');
    writeFileSync(target, filled);
  }
}

function review(root, feature, extra = {}) {
  return recordImpactReview(root, feature, { reviewer: 'codex/session:test', summary: 'Revisei requisitos, decisões e contratos dos documentos listados.', ...extra });
}

test('bundle mantém pedido literal, IDs existentes e links locais para todos os documentos', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  const request = 'Quero pagar mais rápido.\nNão remova o boleto!';
  const { dir } = scaffoldGovernance(root, 'checkout', { clientRequest: request, domains: ['pagamento'] });
  assert.match(readFileSync(path.join(dir, 'prd.md'), 'utf8'), /> Quero pagar mais rápido\.\n> Não remova o boleto!/);
  assert.match(readFileSync(path.join(dir, 'tasks.md'), 'utf8'), /T-001 — Implementar/);
  for (const file of GOVERNANCE_DOCUMENTS) {
    const content = readFileSync(path.join(dir, file), 'utf8');
    for (const other of GOVERNANCE_DOCUMENTS.filter((f) => f !== file)) assert.ok(content.includes(`](${other})`));
  }
  const before = readFileSync(path.join(dir, 'prd.md'), 'utf8');
  scaffoldGovernance(root, 'checkout', { clientRequest: 'Uma tentativa de sobrescrever' });
  assert.equal(readFileSync(path.join(dir, 'prd.md'), 'utf8'), before);
  assert.equal(checkGovernance(root, 'checkout').ok, false, 'rascunho não é prova de revisão');
});

test('grande exige revisão semântica atual; mudanças no ADR invalidam revisão', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  scaffoldGovernance(root, 'checkout', { clientRequest: 'Quero pagar com boleto.' });
  reviewed(root, 'checkout');
  assert.ok(checkGovernance(root, 'checkout').issues.some((i) => i.code === 'REVISAO_IMPACTO_PENDENTE'));
  assert.equal(review(root, 'checkout').ok, true);
  const adr = path.join(root, '.spec/features/checkout/adr.md');
  writeFileSync(adr, `${readFileSync(adr, 'utf8')}\nO boleto foi substituído por cartão.\n`);
  assert.ok(checkGovernance(root, 'checkout').issues.some((i) => i.code === 'REVISAO_IMPACTO_PENDENTE'));
});

test('mudar status não preenche template; apagar governance não contorna documentos grandes', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  const { dir } = scaffoldGovernance(root, 'checkout', { clientRequest: 'Quero pagar com boleto.' });
  for (const name of ['prd.md', 'adr.md', 'design.md', 'research.md']) {
    const filename = path.join(dir, name);
    writeFileSync(filename, readFileSync(filename, 'utf8').replace('status: rascunho', 'status: revisado'));
  }
  assert.ok(review(root, 'checkout').issues.some((issue) => issue.code === 'DOCUMENTO_NAO_PREENCHIDO'));
  reviewed(root, 'checkout');
  assert.equal(review(root, 'checkout').ok, true);
  rmSync(path.join(dir, 'governance.json'));
  const missing = checkGovernance(root, 'checkout');
  assert.equal(missing.ok, false);
  assert.ok(missing.issues.some((issue) => issue.code === 'GOVERNANCA_AUSENTE'));
});

test('interferência em domínio anterior aguarda resposta e invalida resposta após mudança', (t) => {
  const root = workspace(t);
  task(root, 'cobranca', 'src/cobranca.js');
  scaffoldGovernance(root, 'cobranca', { clientRequest: 'Cobrar uma vez.', domains: ['pagamento'] });
  task(root, 'checkout', 'src/checkout.js');
  scaffoldGovernance(root, 'checkout', { clientRequest: 'Aceitar boletos.', domains: ['pagamento'] });
  reviewed(root, 'checkout');
  const checked = review(root, 'checkout');
  assert.equal(checked.ok, false);
  assert.equal(checked.conflicts[0].id, 'impacto:cobranca');
  assert.throws(() => recordGovernanceDecision(root, 'checkout', { conflictId: 'impacto:cobranca', choice: 'prosseguir' }), /resposta literal/);
  const approved = recordGovernanceDecision(root, 'checkout', {
    conflictId: 'impacto:cobranca', choice: 'prosseguir',
    answer: 'Pode incluir o boleto, preservando a cobrança única.', source: 'request_user_input:session-123',
  });
  assert.equal(approved.ok, true);
  const prior = path.join(root, '.spec/features/cobranca/adr.md');
  writeFileSync(prior, `${readFileSync(prior, 'utf8')}\nA cobrança passa a ser recorrente.\n`);
  const stale = checkGovernance(root, 'checkout');
  assert.equal(stale.ok, false);
  assert.ok(stale.issues.some((i) => i.code === 'DECISAO_CLIENTE_PENDENTE'));
});

test('impacto por arquivo funciona em caminhos Windows e não depende de PRD existente', (t) => {
  const root = workspace(t);
  task(root, 'legado', 'src\\billing\\invoice.js');
  task(root, 'nova', 'src/billing/invoice.js');
  const checked = checkGovernance(root, 'nova');
  assert.equal(checked.required, true);
  assert.equal(checked.conflicts[0].id, 'impacto:legado');
  assert.equal(review(root, 'nova').ok, false);
  assert.equal(recordGovernanceDecision(root, 'nova', {
    conflictId: 'impacto:legado', choice: 'ajustar', answer: 'Revise o plano.', source: 'AskUserQuestion:turn-1',
  }).ok, false);
});

test('conflito semântico não desaparece ao regravar a mesma revisão e exige decisão real', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  scaffoldGovernance(root, 'checkout', { clientRequest: 'Preservar boletos.' });
  reviewed(root, 'checkout');
  review(root, 'checkout', { conflicts: [{ id: 'regra-boleto', summary: 'A implementação proposta remove boleto.', rule: 'prd.md#regras' }] });
  assert.equal(review(root, 'checkout').ok, false);
  assert.throws(() => recordGovernanceDecision(root, 'checkout', { conflictId: 'inexistente', choice: 'prosseguir', answer: 'Sim.', source: 'chat' }), /inexistente/);
  assert.equal(recordGovernanceDecision(root, 'checkout', { conflictId: 'regra-boleto', choice: 'cancelar', answer: 'Cancele.', source: 'question:42' }).ok, false);
});

test('mudança de status da tarefa preserva revisão, mas mudança de escopo a invalida', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  scaffoldGovernance(root, 'checkout', { clientRequest: 'Aceitar boletos.' });
  reviewed(root, 'checkout');
  assert.equal(review(root, 'checkout').ok, true);
  const filename = path.join(root, '.spec/features/checkout/tasks.md');
  writeFileSync(filename, readFileSync(filename, 'utf8').replace('[pendente]', '[em-andamento]'));
  assert.equal(checkGovernance(root, 'checkout').ok, true);
  writeFileSync(filename, readFileSync(filename, 'utf8').replace('src/checkout.js', 'src/cobranca.js'));
  assert.equal(checkGovernance(root, 'checkout').ok, false);
});

test('TDD incompleto, vínculo quebrado, pedido reescrito e JSON inválido falham fechados', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  const { dir } = scaffoldGovernance(root, 'checkout', { clientRequest: 'Aceitar boletos.' });
  reviewed(root, 'checkout');
  assert.deepEqual(validateDesignDocument(readFileSync(path.join(dir, 'design.md'), 'utf8')), []);
  writeFileSync(path.join(dir, 'design.md'), '# Design curto\n');
  writeFileSync(path.join(dir, 'prd.md'), '# PRD\nQuero cartões.\n');
  const bad = checkGovernance(root, 'checkout');
  for (const code of ['TDD_SECAO_AUSENTE', 'VINCULO_AUSENTE', 'PEDIDO_CLIENTE_AUSENTE']) assert.ok(bad.issues.some((i) => i.code === code), code);
  writeFileSync(path.join(dir, 'governance.json'), 'broken');
  assert.equal(checkGovernance(root, 'checkout').issues[0].code, 'GOVERNANCA_INVALIDA');
  writeFileSync(path.join(dir, 'governance.json'), JSON.stringify({ version: 1, domains: [], decisions: [], review: { conflicts: {} } }));
  assert.equal(checkGovernance(root, 'checkout').issues[0].code, 'GOVERNANCA_INVALIDA');
});

test('feature pequena isolada continua compatível sem governança artificial', (t) => {
  const root = workspace(t);
  task(root, 'simples', 'src/simples.js');
  assert.equal(checkGovernance(root, 'simples').ok, true);
  assert.equal(checkGovernance(root, 'simples').required, false);
});

test('design.md legado curto mantém o contrato anterior sem migração automática', (t) => {
  const root = workspace(t);
  task(root, 'simples', 'src/simples.js');
  writeFileSync(path.join(root, '.spec/features/simples/design.md'), '# Design\nSó um parágrafo.\n');
  const checked = checkGovernance(root, 'simples');
  assert.equal(checked.ok, true);
  assert.ok(!checked.issues.some((issue) => issue.code === 'TDD_SECAO_AUSENTE'));
});

test('scaffold repetido preserva bytes, mtime e revisão dos documentos novos já escritos', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  const { dir } = scaffoldGovernance(root, 'checkout', { clientRequest: 'Aceitar boletos.' });
  reviewed(root, 'checkout');
  const previous = review(root, 'checkout');
  const files = [...GOVERNANCE_DOCUMENTS, 'governance.json'];
  const before = files.map((file) => ({ file, bytes: readFileSync(path.join(dir, file)), mtime: statSync(path.join(dir, file), { bigint: true }).mtimeNs }));
  const repeated = createBundle(root, 'checkout', { newFeature: true, clientRequest: 'Pedido diferente que não pode sobrescrever nada.', domains: ['outro'] });
  assert.deepEqual(repeated.created, []);
  assert.equal(repeated.preserved.length, files.length);
  for (const item of before) {
    assert.deepEqual(readFileSync(path.join(dir, item.file)), item.bytes, item.file);
    assert.equal(statSync(path.join(dir, item.file), { bigint: true }).mtimeNs, item.mtime, item.file);
  }
  const current = checkGovernance(root, 'checkout');
  assert.equal(current.ok, true);
  assert.equal(current.fingerprint, previous.fingerprint);
  assert.equal(current.ownFingerprint, previous.ownFingerprint);
});

test('audit CI inclui gate documental e mantém integridade de features já concluídas', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  scaffoldGovernance(root, 'checkout', { clientRequest: 'Aceitar boletos.' });
  const audit = () => auditProject(loadProject(loadConfig(root)), { ci: true });
  const draft = audit();
  assert.equal(draft.exitCode, 1);
  assert.ok(draft.findings.some((finding) => finding.code === 'DOCUMENTO_RASCUNHO' && finding.severity === 'erro'));
  reviewed(root, 'checkout');
  review(root, 'checkout');
  assert.ok(!audit().findings.some((finding) => finding.code === 'REVISAO_IMPACTO_PENDENTE'));
  const tasks = path.join(root, '.spec/features/checkout/tasks.md');
  writeFileSync(tasks, readFileSync(tasks, 'utf8').replace('[pendente]', '[concluida]'));
  task(root, 'novidade', 'src/nova.js');
  scaffoldGovernance(root, 'novidade', { clientRequest: 'Uma novidade.' });
  assert.ok(!audit().findings.some((finding) => finding.feature === 'checkout' && finding.code === 'REVISAO_IMPACTO_PENDENTE'));
  rmSync(path.join(root, '.spec/features/checkout/adr.md'));
  assert.ok(audit().findings.some((finding) => finding.feature === 'checkout' && finding.code === 'DOCUMENTO_AUSENTE'));
});

test('marcar todas as tarefas concluídas não contorna revisão semântica ausente', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  scaffoldGovernance(root, 'checkout', { clientRequest: 'Aceitar boletos.' });
  reviewed(root, 'checkout');
  const filename = path.join(root, '.spec/features/checkout/tasks.md');
  writeFileSync(filename, readFileSync(filename, 'utf8').replace('[pendente]', '[concluida]'));
  const audit = auditProject(loadProject(loadConfig(root)), { ci: true });
  assert.ok(audit.findings.some((finding) => finding.code === 'REVISAO_IMPACTO_PENDENTE'));
  assert.equal(checkGovernance(root, 'checkout', { integrityOnly: true }).ok, false, 'alias antigo também não pode contornar o gate');
});

test('mudanças próprias após a última tarefa invalidam a prova histórica de revisão e resposta', (t) => {
  for (const changed of ['adr.md', 'prd.md', 'tasks.md', 'constitution', 'config']) {
    const root = workspace(t);
    task(root, 'checkout', 'src/checkout.js');
    scaffoldGovernance(root, 'checkout', { clientRequest: 'Aceitar boletos.' });
    reviewed(root, 'checkout');
    review(root, 'checkout', { conflicts: [{ id: 'regra', summary: 'O domínio da cobrança será alterado.', rule: 'adr.md' }] });
    recordGovernanceDecision(root, 'checkout', { conflictId: 'regra', choice: 'prosseguir', answer: 'Pode seguir com a regra apresentada.', source: 'pergunta:1' });
    const dir = path.join(root, '.spec/features/checkout');
    const tasks = path.join(dir, 'tasks.md');
    writeFileSync(tasks, readFileSync(tasks, 'utf8').replace('[pendente]', '[concluida]'));
    assert.equal(checkGovernance(root, 'checkout', { historical: true }).ok, true);
    if (changed === 'constitution') writeFileSync(path.join(root, '.spec/constituicao.md'), '# Nova regra\nNão mudar a cobrança.\n');
    else if (changed === 'config') writeFileSync(path.join(root, 'onpspec.config.json'), JSON.stringify({ testCommand: 'node --test outra-suite' }));
    else {
      const filename = path.join(dir, changed);
      writeFileSync(filename, `${readFileSync(filename, 'utf8')}\nA regra financeira foi modificada após a tarefa.\n`);
    }
    const historical = checkGovernance(root, 'checkout', { historical: true });
    assert.equal(historical.ok, false, changed);
    assert.ok(historical.issues.some((issue) => issue.code === 'REVISAO_IMPACTO_PENDENTE'), changed);
    assert.ok(historical.issues.some((issue) => issue.code === 'DECISAO_CLIENTE_PENDENTE'), changed);
    assert.ok(auditProject(loadProject(loadConfig(root)), { ci: true }).findings.some((finding) => finding.code === 'REVISAO_IMPACTO_PENDENTE'), changed);
  }
});

test('conclusão histórica conserva conflitos e só aceita a resposta para a decisão exata revisada', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  scaffoldGovernance(root, 'checkout', { clientRequest: 'Aceitar boletos.' });
  reviewed(root, 'checkout');
  const conflict = { id: 'regra', summary: 'Aumentar prazo do boleto para sete dias.', rule: 'prd.md' };
  review(root, 'checkout', { conflicts: [conflict] });
  const tasks = path.join(root, '.spec/features/checkout/tasks.md');
  writeFileSync(tasks, readFileSync(tasks, 'utf8').replace('[pendente]', '[concluida]'));
  assert.ok(checkGovernance(root, 'checkout', { historical: true }).issues.some((issue) => issue.code === 'DECISAO_CLIENTE_PENDENTE'));
  recordGovernanceDecision(root, 'checkout', { conflictId: 'regra', choice: 'prosseguir', answer: 'Aprovo sete dias.', source: 'pergunta:2' });
  assert.equal(checkGovernance(root, 'checkout', { historical: true }).ok, true);
  task(root, 'novidade', 'src/novidade.js');
  scaffoldGovernance(root, 'novidade', { clientRequest: 'Nova feature.' });
  assert.equal(checkGovernance(root, 'checkout', { historical: true }).ok, true, 'documento novo não apaga a prova histórica');
  assert.equal(checkGovernance(root, 'checkout').ok, false, 'nova execução ainda exige revisão global atual');
  review(root, 'checkout', { conflicts: [{ ...conflict, summary: 'Remover boleto completamente.' }] });
  assert.ok(checkGovernance(root, 'checkout', { historical: true }).issues.some((issue) => issue.code === 'DECISAO_CLIENTE_PENDENTE'), 'resposta antiga não autoriza outro conflito com mesmo id');
});

test('revisão após feature nova não apaga conflito conhecido quando proposta própria não mudou', (t) => {
  const root = workspace(t);
  task(root, 'checkout', 'src/checkout.js');
  scaffoldGovernance(root, 'checkout', { clientRequest: 'Aceitar boletos.' });
  reviewed(root, 'checkout');
  review(root, 'checkout', { conflicts: [{ id: 'regra', summary: 'A proposta altera a regra do boleto.', rule: 'prd.md' }] });
  task(root, 'novidade', 'src/novidade.js');
  scaffoldGovernance(root, 'novidade', { clientRequest: 'Nova feature.' });
  const rechecked = review(root, 'checkout');
  assert.ok(rechecked.conflicts.some((conflict) => conflict.id === 'regra'));
  assert.ok(rechecked.issues.some((issue) => issue.code === 'DECISAO_CLIENTE_PENDENTE'));
});
