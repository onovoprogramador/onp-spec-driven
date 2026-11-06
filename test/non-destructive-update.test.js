import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectExecutionPlan, reservePlanArtifacts, PLAN_ARTIFACTS } from '../src/core/plan-artifacts.js';

const BIN = fileURLToPath(new URL('../bin/onp-spec.js', import.meta.url));
function fixture(t, specDir = '.spec') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onp-preserve-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, specDir, 'features', 'existing');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, 'onpspec.config.json'), `${JSON.stringify({ specDir, testCommand: 'node --test', custom: 'keep verbatim' }, null, 4)}\r\n`);
  writeFileSync(path.join(root, specDir, 'constituicao.md'), '# Constituição anterior\r\n');
  writeFileSync(path.join(dir, 'spec.md'), '# Spec: existing\r\n\r\n## Suposições\r\n\r\n## Perguntas em aberto\r\n');
  writeFileSync(path.join(dir, 'tasks.md'), '# Tarefas\r\n\r\n## T-001 — Implementar [pendente]\r\n\r\n- Arquivos: src/example.js\r\n');
  writeFileSync(path.join(dir, 'design.md'), '\ufeff# Design livre de 2025\r\nMinha arquitetura original.\r\n');
  writeFileSync(path.join(dir, 'prd.md'), '# Requisito original\nTexto literal do cliente.\n');
  writeFileSync(path.join(dir, 'adr.md'), '# Decisão anterior\nContrato vigente.\n');
  const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ONP_SPEC_HOME: path.join(root, '.ledger') } });
  const good = (...args) => { const result = cli(...args); assert.equal(result.status, 0, result.stdout + result.stderr); return result; };
  return { root, dir, cli, good, specDir };
}
function snapshot(root, files) {
  return Object.fromEntries(files.map((rel) => {
    const file = path.join(root, rel);
    return [rel, { sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), mtime: statSync(file).mtimeMs }];
  }));
}
const documents = (specDir) => ['onpspec.config.json', `${specDir}/constituicao.md`, ...['spec.md', 'tasks.md', 'design.md', 'prd.md', 'adr.md'].map((name) => `${specDir}/features/existing/${name}`)];

test('init e geração preservam bytes/mtime de specs, skills personalizadas e artefatos anteriores', (t) => {
  const f = fixture(t);
  const skill = '.agents/skills/onp-spec-driven';
  mkdirSync(path.join(f.root, skill, 'scripts'), { recursive: true });
  writeFileSync(path.join(f.root, skill, 'SKILL.md'), '---\nname: onp-spec-driven\nmetadata:\n  agent: codex\n  version: 0.9.0\n---\nMinha skill customizada.\n');
  writeFileSync(path.join(f.root, skill, 'scripts/custom.js'), '// código privado\r\n');
  for (const name of PLAN_ARTIFACTS) writeFileSync(path.join(f.dir, name), name === 'plano.json' ? '{"runId":"legacy","feature":"existing"}\n' : `original:${name}\r\n`);
  const files = [...documents(f.specDir), `${skill}/SKILL.md`, `${skill}/scripts/custom.js`, ...PLAN_ARTIFACTS.map((name) => `.spec/features/existing/${name}`)];
  const before = snapshot(f.root, files);
  f.good('init', '--agents', 'codex');
  const aliases = readdirSync(path.join(f.root, '.agents/skills')).filter((name) => name !== 'onp-spec-driven');
  assert.equal(aliases.length, 1);
  assert.match(aliases[0], /^onp-spec-driven-codex-v[\d-]+$/);
  const installed = path.join(f.root, '.agents/skills', aliases[0]);
  assert.match(readFileSync(path.join(installed, 'SKILL.md'), 'utf8'), new RegExp(`^name: ${aliases[0]}$`, 'm'));
  assert.ok(existsSync(path.join(installed, 'scripts/onp-spec.mjs')));
  const aliasMtime = statSync(path.join(installed, 'SKILL.md')).mtimeMs;
  f.good('init', '--agents', 'codex');
  assert.equal(readdirSync(path.dirname(installed)).length, 2);
  assert.equal(statSync(path.join(installed, 'SKILL.md')).mtimeMs, aliasMtime);
  f.good('plano', 'existing', '--agents', 'codex', '--sequencial');
  const plan = selectExecutionPlan(f.root, 'existing');
  assert.equal(plan.artifactDir, `.spec/features/existing/execucoes/${plan.runId}`);
  assert.ok(existsSync(path.join(f.root, plan.artifactDir, 'executar-tarefas.mjs')));
  f.good('new', 'new-large', '--grande', '--cliente', 'Quero manter tudo que já construí.');
  f.cli('audit', '--json'); // status da auditoria é independente da preservação
  f.good('status');
  assert.deepEqual(snapshot(f.root, files), before);
});

test('planos nativos repetidos ficam imutáveis e cada wrapper continua selecionando sua execução', (t) => {
  const f = fixture(t);
  f.good('plano', 'existing', '--agents', 'codex', '--sequencial');
  const first = selectExecutionPlan(f.root, 'existing');
  assert.equal(first.artifactDir, '.spec/features/existing');
  const firstFiles = PLAN_ARTIFACTS.filter((name) => name !== 'plano-execucao.html').map((name) => `${first.artifactDir}/${name}`);
  const before = snapshot(f.root, [...documents(f.specDir), ...firstFiles]);
  f.good('plano', 'existing', '--agents', 'opencode', '--sequencial');
  const second = selectExecutionPlan(f.root, 'existing');
  assert.notEqual(second.runId, first.runId);
  assert.equal(second.agent, 'opencode');
  utimesSync(path.join(f.root, first.artifactDir, 'plano.json'), new Date(), new Date('2040-01-01'));
  assert.equal(selectExecutionPlan(f.root, 'existing').runId, second.runId, 'mtime de restore não muda a ordem dos planos');
  utimesSync(path.join(f.root, first.artifactDir, 'plano.json'), new Date(), new Date(before[`${first.artifactDir}/plano.json`].mtime));
  // fs pode arredondar mtime quando restaurado; preserve a comparação de conteúdo.
  before[`${first.artifactDir}/plano.json`].mtime = statSync(path.join(f.root, first.artifactDir, 'plano.json')).mtimeMs;
  assert.deepEqual(selectExecutionPlan(f.root, 'existing', { runId: first.runId }), first);
  assert.deepEqual(snapshot(f.root, [...documents(f.specDir), ...firstFiles]), before);
  // Sem git/catalog/modelo: --listar deve continuar uma operação de leitura.
  for (const plan of [first, second]) {
    const run = spawnSync(process.execPath, [path.join(f.root, plan.artifactDir, 'executar-tarefas.mjs'), '--listar', '--run', 'attempt-to-change-run'], { cwd: os.tmpdir(), encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const result = JSON.parse(run.stdout);
    assert.deepEqual(result.targets, ['T-001', 'gate']);
    // CLI --run inexistente falha; sucesso acima prova que wrapper pinou seu ID.
    assert.match(readFileSync(path.join(f.root, plan.artifactDir, 'executar-tarefas.mjs'), 'utf8'), new RegExp(plan.runId));
  }
  assert.notEqual(f.cli('executar', 'existing', '--listar', '--run', 'missing').status, 0);
});

test('JSON legado ou corrompido nunca é regravado para satisfazer executar', (t) => {
  const f = fixture(t);
  const file = path.join(f.dir, 'plano.json');
  writeFileSync(file, '{old custom json');
  const before = snapshot(f.dir, ['plano.json']);
  const result = f.cli('executar', 'existing', '--listar');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /antigo continua utilizável/);
  f.good('plano', 'existing', '--agents', 'claude');
  assert.ok(selectExecutionPlan(f.root, 'existing').artifactDir.includes('/execucoes/'));
  assert.deepEqual(snapshot(f.dir, ['plano.json']), before);
});

test('JSON válido sem objeto no plano antigo não oculta execuções nativas novas', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.dir, 'plano.json'), 'null\n');
  const before = snapshot(f.dir, ['plano.json']);
  f.good('plano', 'existing', '--agents', 'codex');
  assert.ok(selectExecutionPlan(f.root, 'existing').artifactDir.includes('/execucoes/'));
  f.good('executar', 'existing', '--listar');
  assert.deepEqual(snapshot(f.dir, ['plano.json']), before);
});

test('new recusa inclusive diretório parcial sem spec e não altera arquivos', (t) => {
  const f = fixture(t);
  const partial = path.join(f.root, '.spec/features/partial');
  mkdirSync(partial); writeFileSync(path.join(partial, 'tasks.md'), 'Tarefas já escritas\r\n');
  const before = snapshot(partial, ['tasks.md']);
  const result = f.cli('new', 'partial', '--grande');
  assert.equal(result.status, 2);
  assert.deepEqual(readdirSync(partial), ['tasks.md']);
  assert.deepEqual(snapshot(partial, ['tasks.md']), before);
});

test('init respeita specDir personalizado sem criar ou migrar .spec', (t) => {
  const f = fixture(t, 'product/specifications');
  const before = snapshot(f.root, documents(f.specDir));
  f.good('init');
  assert.equal(existsSync(path.join(f.root, '.spec')), false);
  f.good('plano', 'existing', '--agents', 'codex');
  const plan = selectExecutionPlan(f.root, 'existing', { specDir: f.specDir });
  const run = spawnSync(process.execPath, [path.join(f.root, plan.artifactDir, 'executar-tarefas.mjs'), '--listar'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(snapshot(f.root, documents(f.specDir)), before);
});

test('outro harness usa instalação paralela explícita e preserva variante anterior', (t) => {
  const f = fixture(t);
  f.good('init', '--agents', 'antigravity');
  const skill = '.agents/skills/onp-spec-driven/SKILL.md';
  const before = snapshot(f.root, [skill]);
  const conflict = f.cli('init', '--agents', 'codex');
  assert.equal(conflict.status, 2); assert.match(conflict.stderr, /--nova-versao/);
  f.good('init', '--agents', 'codex', '--nova-versao');
  assert.deepEqual(snapshot(f.root, [skill]), before);
  const dirs = readdirSync(path.join(f.root, '.agents/skills'));
  assert.equal(dirs.length, 2); assert.ok(dirs.some((name) => name.startsWith('onp-spec-driven-codex-v')));
});

test('reservas concorrentes e colisão de run nunca reutilizam artefatos anteriores', (t) => {
  const f = fixture(t);
  const base = { baseDir: '.spec/features/existing', runId: 'run-a' };
  const first = reservePlanArtifacts(f.root, base);
  const next = reservePlanArtifacts(f.root, { ...base, runId: 'run-b' });
  assert.notEqual(next.directory, first.directory);
  assert.ok(lstatSync(next.directory).isDirectory());
  assert.throws(() => reservePlanArtifacts(f.root, { ...base, runId: 'run-b' }), /EEXIST/);
  next.release(); first.release();
  assert.equal(existsSync(path.join(f.dir, '.onp-plan.lock')), false);
});

for (const newline of ['\n', '\r\n']) {
  test(`status de tarefa altera somente o token e preserva formato ${JSON.stringify(newline)}`, (t) => {
    const f = fixture(t);
    const tasks = path.join(f.dir, 'tasks.md');
    const original = ['\ufeff# Tarefas', '', '## T-001 — Título [adicional]\t[pendente]  ', '', '', '- Arquivos: src/example.js', '', '## T-002 — Outra [pendente]', ''].join(newline);
    writeFileSync(tasks, original);
    f.good('tarefa', 'existing', 'T-001', 'concluida');
    assert.equal(readFileSync(tasks, 'utf8'), original.replace('[pendente]', '[concluida]'));
    const mtime = statSync(tasks).mtimeMs;
    f.good('tarefa', 'existing', 'T-001', 'concluida');
    assert.equal(readFileSync(tasks, 'utf8'), original.replace('[pendente]', '[concluida]'));
    assert.equal(statSync(tasks).mtimeMs, mtime, 'repetir status não regrava o documento');
  });
}
