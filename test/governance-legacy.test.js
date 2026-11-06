import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { loadProject } from '../src/core/project.js';
import { auditProject } from '../src/core/audit.js';
import { runVerify } from '../src/core/verify.js';
import { GOVERNANCE_DOCUMENTS, DOCUMENTATION_MARKER, DOCUMENTATION_CONTRACT, scaffoldGovernance,
  checkGovernance, recordImpactReview, isGovernanceEnrolled } from '../src/core/governance.js';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onp-governance-legacy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.spec/features/antiga');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'spec.md'), '# Spec: Antiga\r\n\r\n> feature: antiga\r\n> status: em-implementacao\r\n\r\n## Histórias\r\n\r\n### US-777 — Pagar\r\n\r\nComo cliente, quero pagar, para receber.\r\n\r\n#### AC-777 — Cobrança única\r\n\r\n- **Dado** um pedido\r\n- **Quando** pago\r\n- **Então** uma cobrança é criada\r\n\r\n## Suposições\r\n\r\nNenhuma.\r\n\r\n## Perguntas em aberto\r\n\r\nNenhuma.\r\n');
  writeFileSync(path.join(dir, 'tasks.md'), '# Tarefas antigas\r\n\r\n## T-777 — Cobrar [pendente]\r\n\r\n- Refs: AC-777\r\n- Arquivos: src/cobranca.js\r\n');
  return { root, dir };
}

function hashes(dir, files = GOVERNANCE_DOCUMENTS) {
  return files.map((file) => {
    const filename = path.join(dir, file);
    return { file, hash: createHash('sha256').update(readFileSync(filename)).digest('hex'), mtime: statSync(filename, { bigint: true }).mtimeNs };
  });
}

function legacyDocs(dir) {
  writeFileSync(path.join(dir, 'design.md'), '\ufeff# Desenho antigo\r\n\r\nUsar o serviço financeiro existente.\r\n');
  writeFileSync(path.join(dir, 'prd.md'), '# Pedido do cliente\n\nQuero cobrar uma única vez.\n');
  writeFileSync(path.join(dir, 'adr.md'), '# Decisão histórica\n\nUma cobrança por pedido. Sem seção de metadados nova.\n');
  writeFileSync(path.join(dir, 'research.md'), '# Pesquisa anterior\n\nEntrevistas locais documentadas em outro sistema.\n');
}

test('audit mantém resultados do legado com PRD/ADR/design curtos e não toca nenhum byte', (t) => {
  const { root, dir } = fixture(t);
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'test'));
  writeFileSync(path.join(root, 'src/cobranca.js'), "exports.cobrar = (pedido, cobrancas) => { if (!cobrancas.has(pedido)) cobrancas.set(pedido, { pedido }); return cobrancas.get(pedido); };\n");
  writeFileSync(path.join(root, 'test/cobranca.test.cjs'), "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { cobrar } = require('../src/cobranca.js');\ntest('uma cobrança por pedido @spec:AC-777', () => { const cobrancas = new Map(); const primeira = cobrar('pedido-1', cobrancas); const segunda = cobrar('pedido-1', cobrancas); assert.equal(segunda, primeira); assert.equal(cobrancas.size, 1); });\n");
  writeFileSync(path.join(root, 'onpspec.config.json'), JSON.stringify({ testCommand: 'node --test --test-reporter=tap', reporter: 'tap' }));
  const verified = runVerify(loadProject(loadConfig(root)), 'antiga');
  assert.equal(verified.record.exitCode, 0, verified.rawOutput);
  const audit = () => auditProject(loadProject(loadConfig(root)), { ci: true });
  const baseline = audit();
  assert.equal(baseline.exitCode, 0, JSON.stringify(baseline.findings));
  legacyDocs(dir);
  const before = hashes(dir);
  assert.equal(isGovernanceEnrolled(root, 'antiga'), false);
  assert.deepEqual(audit(), baseline, 'documentos antigos não introduzem erros novos de formato');
  scaffoldGovernance(root, 'nova', { newFeature: true, clientRequest: 'Criar outra feature.' });
  const after = audit();
  assert.deepEqual(after.findings.filter((finding) => finding.feature === 'antiga'), baseline.findings.filter((finding) => finding.feature === 'antiga'));
  assert.deepEqual(hashes(dir), before, 'criar feature nova e auditar preserva bytes/mtime de todos os documentos antigos');
});

test('scaffold só cria ausentes e nunca inscreve ou reescreve documentos legados', (t) => {
  const { root, dir } = fixture(t);
  legacyDocs(dir);
  const before = hashes(dir);
  const first = scaffoldGovernance(root, 'antiga', { clientRequest: 'Novo pedido não deve reescrever o anterior.' });
  assert.deepEqual(first.created, ['.spec/features/antiga/governance.json']);
  assert.equal(first.preserved.length, GOVERNANCE_DOCUMENTS.length);
  assert.deepEqual(hashes(dir), before);
  assert.equal(isGovernanceEnrolled(root, 'antiga'), false);
  const withState = hashes(dir, [...GOVERNANCE_DOCUMENTS, 'governance.json']);
  const again = scaffoldGovernance(root, 'antiga', { newFeature: true, clientRequest: 'Não substituir.', domains: ['financeiro'] });
  assert.deepEqual(again.created, []);
  assert.deepEqual(hashes(dir, [...GOVERNANCE_DOCUMENTS, 'governance.json']), withState);
  assert.equal(isGovernanceEnrolled(root, 'antiga'), false, 'repetir scaffold não transforma legado em contrato novo');
});

test('scaffold não sobrescreve registro existente vazio nem confunde menção ao contrato com adesão', (t) => {
  const { root, dir } = fixture(t);
  legacyDocs(dir);
  const metadata = path.join(dir, 'governance.json');
  writeFileSync(metadata, '');
  const before = hashes(dir, [...GOVERNANCE_DOCUMENTS, 'governance.json']);
  assert.throws(() => scaffoldGovernance(root, 'antiga', { newFeature: true }));
  assert.deepEqual(hashes(dir, [...GOVERNANCE_DOCUMENTS, 'governance.json']), before);
  writeFileSync(metadata, JSON.stringify({ version: 1, large: false, domains: [], decisions: [], review: null, clientRequest: 'Ainda não adotar onp-docs-v1.' }));
  assert.equal(isGovernanceEnrolled(root, 'antiga'), false);
});

test('revisão explícita lê regras legadas sem impor novo TDD nem alterar documentos', (t) => {
  const { root, dir } = fixture(t);
  legacyDocs(dir);
  const before = hashes(dir);
  const reviewed = recordImpactReview(root, 'antiga', { summary: 'A mudança mantém cobrança única, conforme o ADR histórico.', reviewer: 'codex:sessao-legada' });
  assert.equal(reviewed.ok, true);
  assert.equal(isGovernanceEnrolled(root, 'antiga'), true, 'revisão de nova execução é registrada sem migração documental');
  for (const name of ['prd.md', 'adr.md', 'design.md']) assert.ok(reviewed.documents.includes(`.spec/features/antiga/${name}`));
  const state = JSON.parse(readFileSync(path.join(dir, 'governance.json'), 'utf8'));
  assert.equal(state.documentationContract, undefined);
  assert.ok(!auditProject(loadProject(loadConfig(root)), { ci: true }).findings.some((finding) => /TDD_|DOCUMENTO_|VINCULO_|PEDIDO_CLIENTE/.test(finding.code)));
  assert.deepEqual(hashes(dir), before);
});

test('trabalho novo detecta impacto no PRD legado preservado', (t) => {
  const { root, dir } = fixture(t);
  legacyDocs(dir);
  const before = hashes(dir);
  const created = scaffoldGovernance(root, 'nova', { newFeature: true, clientRequest: 'Alterar cobrança.' });
  const tasks = path.join(created.dir, 'tasks.md');
  writeFileSync(tasks, readFileSync(tasks, 'utf8').replace('src/exemplo.js', 'src/cobranca.js'));
  const check = checkGovernance(root, 'nova');
  assert.ok(check.documents.includes('.spec/features/antiga/adr.md'));
  assert.ok(check.conflicts.some((conflict) => conflict.id === 'impacto:antiga' && conflict.rule === '.spec/features/antiga/prd.md'));
  assert.ok(check.issues.some((issue) => issue.code === 'DECISAO_CLIENTE_PENDENTE'));
  assert.deepEqual(hashes(dir), before);
});

test('proveniência nova impede bypass apagando somente metadata ou somente marcadores', (t) => {
  const { root } = fixture(t);
  const { dir } = scaffoldGovernance(root, 'nova', { newFeature: true, clientRequest: 'Nova feature.' });
  const metadata = path.join(dir, 'governance.json');
  assert.equal(JSON.parse(readFileSync(metadata, 'utf8')).documentationContract, DOCUMENTATION_CONTRACT);
  const state = readFileSync(metadata);
  rmSync(metadata);
  assert.equal(isGovernanceEnrolled(root, 'nova'), true);
  assert.ok(checkGovernance(root, 'nova').issues.some((issue) => issue.code === 'GOVERNANCA_AUSENTE'));
  writeFileSync(metadata, state);
  for (const file of GOVERNANCE_DOCUMENTS) {
    const filename = path.join(dir, file);
    writeFileSync(filename, readFileSync(filename, 'utf8').replace(DOCUMENTATION_MARKER, ''));
  }
  assert.equal(isGovernanceEnrolled(root, 'nova'), true);
  assert.ok(checkGovernance(root, 'nova').issues.some((issue) => issue.code === 'DOCUMENTO_RASCUNHO'));
});
