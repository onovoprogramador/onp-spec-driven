import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { executePlan, planSourceFingerprint } from '../src/core/executor.js';
import { montarPlano, renderPlanoJson } from '../src/core/plano.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { listExecutionPlans } from '../src/core/execution-history.js';

const engine = fileURLToPath(new URL('../bin/onp-spec.js', import.meta.url));
function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(t, { sequential = false } = {}) {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'onp-plan-integrity-'));
  const root = path.join(temp, 'project with spaces');
  const base = path.join(root, '.spec', 'features', 'example');
  mkdirSync(base, { recursive: true });
  const home = process.env.ONP_SPEC_HOME;
  process.env.ONP_SPEC_HOME = path.join(temp, 'ledger');
  t.after(() => {
    if (home === undefined) delete process.env.ONP_SPEC_HOME;
    else process.env.ONP_SPEC_HOME = home;
    rmSync(temp, { recursive: true, force: true });
  });
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'test');
  writeFileSync(path.join(base, 'spec.md'), '# Spec: example\n');
  writeFileSync(path.join(base, 'tasks.md'), '## T-001 — Implementar [pendente]\n\n- Arquivos: output.txt\n');
  writeFileSync(path.join(root, '.spec', 'constituicao.md'), '# Constituição\n');
  writeFileSync(path.join(root, 'onpspec.config.json'), '{}\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'Initial scope');
  const initial = git(root, 'rev-parse', 'HEAD');
  const task = { id: 'T-001', title: 'Implementar', files: ['output.txt'], refs: [], status: 'pendente', line: 1 };
  const project = { config: { ...DEFAULT_CONFIG, rootDir: root }, features: [{ name: 'example', tasks: { tasks: [task] }, spec: { stories: [] } }] };
  const plan = JSON.parse(renderPlanoJson(montarPlano(project, 'example', { agent: 'codex', enginePath: engine, sequencial: sequential })));
  plan.sourceFingerprint = planSourceFingerprint(root, plan);
  let calls = 0, gates = 0;
  const options = {
    quiet: true,
    checkGovernance: () => ({ ok: true }),
    discoverModels: async () => ({ status: 'available', harness: 'codex', models: [{ id: 'live-account-model', isDefault: true, efforts: ['medium'] }] }),
    readQuota: async () => ({ status: 'available', observedAt: new Date().toISOString(), windows: [{ id: 'account', remainingPercent: 90 }] }),
    runGate: async () => { gates++; return 0; },
    runTask: async (invocation) => {
      calls++;
      writeFileSync(path.join(invocation.cwd, 'output.txt'), 'implemented');
      git(invocation.cwd, 'add', '--', 'output.txt');
      git(invocation.cwd, 'commit', '-qm', 'T-001 example: implement');
      return { code: 0 };
    },
  };
  return { root, base, plan, initial, options, get calls() { return calls; }, get gates() { return gates; } };
}

for (const [label, filename, content] of [
  ['spec', '.spec/features/example/spec.md', '# Spec: example\nNovo requisito de domínio.\n'],
  ['escopo das tarefas', '.spec/features/example/tasks.md', '## T-001 — Implementar [pendente]\n\n- Arquivos: different-domain.txt\n'],
  ['configuração', 'onpspec.config.json', '{"paralelo":{"model":"different-model"}}\n'],
  ['constituição', '.spec/constituicao.md', '# Constituição\nNova regra de domínio.\n'],
]) {
  test(`plano obsoleto por ${label} não inicia implementação`, async (t) => {
    const f = fixture(t);
    writeFileSync(path.join(f.root, filename), content);
    git(f.root, 'add', '.'); git(f.root, 'commit', '-qm', `Change ${label}`);
    await assert.rejects(executePlan(f.root, f.plan, f.options), /plano.*(?:desatualiz|obsolet|mudou)|regenere|regenerar/i);
    assert.equal(f.calls, 0);
    assert.equal(f.gates, 0);
  });
}

test('mudança somente do status das tarefas preserva impressão das fontes', (t) => {
  const f = fixture(t);
  const filename = path.join(f.base, 'tasks.md');
  writeFileSync(filename, readFileSync(filename, 'utf8').replace('[pendente]', '[em-andamento]'));
  assert.equal(planSourceFingerprint(f.root, f.plan), f.plan.sourceFingerprint);
});

test('sequencial concluída retoma após gate falho sem repetir inferência por status registrado pelo motor', async (t) => {
  const f = fixture(t, { sequential: true });
  let gates = 0;
  const options = { ...f.options, runGate: async () => ++gates <= 2 ? 1 : 0 };
  assert.equal((await executePlan(f.root, f.plan, options)).code, 1);
  assert.equal(f.calls, 1);
  assert.match(readFileSync(path.join(f.base, 'tasks.md'), 'utf8'), /\[concluida\]/);
  assert.equal((await executePlan(f.root, f.plan, options)).code, 0);
  assert.equal(f.calls, 1, 'only the gate runs again after a completed task');
  assert.equal(gates, 4);
  assert.equal((await executePlan(f.root, f.plan, options)).code, 0);
  assert.equal(f.calls, 1);
  assert.equal(gates, 6);
});

test('retomada concluída respeita checkout CRLF configurado pelo Git sem afrouxar conteúdo', async (t) => {
  const f = fixture(t, { sequential: true });
  writeFileSync(path.join(f.root, '.gitattributes'), '*.md text eol=crlf\n');
  git(f.root, 'add', '.gitattributes'); git(f.root, 'commit', '-qm', 'Markdown uses CRLF in working tree');
  const documents = ['.spec/features/example/spec.md', '.spec/features/example/tasks.md', '.spec/constituicao.md'];
  for (const file of documents) rmSync(path.join(f.root, file));
  git(f.root, 'checkout', '--', ...documents);
  const taskFile = path.join(f.base, 'tasks.md');
  const before = readFileSync(taskFile, 'utf8');
  assert.match(before, /\r\n/);
  f.plan.sourceFingerprint = planSourceFingerprint(f.root, f.plan);
  assert.equal((await executePlan(f.root, f.plan, f.options)).code, 0);
  assert.equal(readFileSync(taskFile, 'utf8'), before.replace('[pendente]', '[concluida]'));
  assert.equal((await executePlan(f.root, f.plan, f.options)).code, 0);
  assert.equal(f.calls, 1);
  assert.equal(f.gates, 4);
});

test('worker continua proibido de alterar apenas status de tasks.md durante implementação', async (t) => {
  const f = fixture(t, { sequential: true });
  await assert.rejects(executePlan(f.root, f.plan, { ...f.options, runTask: async ({ cwd }) => {
    const tasks = path.join(cwd, '.spec/features/example/tasks.md');
    writeFileSync(tasks, readFileSync(tasks, 'utf8').replace('[pendente]', '[concluida]'));
    git(cwd, 'add', '-A'); git(cwd, 'commit', '-qm', 'Worker incorrectly marks itself completed');
    return { code: 0 };
  } }), /artefatos existentes protegidos/);
  assert.equal(f.gates, 0);
});

test('retomada sequencial parcial mantém tarefa concluída e executa apenas a restante', async (t) => {
  const f = fixture(t, { sequential: true });
  const firstTask = f.plan.sequenciais[0];
  f.plan.sequenciais.push({ ...firstTask, id: 'T-002', arquivos: ['output2.txt'], prompt: firstTask.prompt.replaceAll('T-001', 'T-002').replaceAll('output.txt', 'output2.txt') });
  const tasksFile = path.join(f.base, 'tasks.md');
  writeFileSync(tasksFile, readFileSync(tasksFile, 'utf8') + '\n## T-002 — Segunda tarefa [pendente]\n\n- Arquivos: output2.txt\n');
  git(f.root, 'add', '.'); git(f.root, 'commit', '-qm', 'Second sequential task');
  f.plan.sourceFingerprint = planSourceFingerprint(f.root, f.plan);
  const calls = [];
  const options = { ...f.options, runTask: async ({ cwd, input }) => {
    const id = input.match(/T-\d{3}/)[0];
    calls.push(id);
    const output = id === 'T-001' ? 'output.txt' : 'output2.txt';
    writeFileSync(path.join(cwd, output), id);
    git(cwd, 'add', '--', output); git(cwd, 'commit', '-qm', `Implement ${id}`);
    return { code: 0 };
  } };
  assert.equal((await executePlan(f.root, f.plan, { ...options, task: 'T-001' })).code, 0);
  assert.deepEqual(calls, ['T-001']);
  assert.equal((await executePlan(f.root, f.plan, options)).code, 0);
  assert.equal((await executePlan(f.root, f.plan, options)).code, 0);
  assert.deepEqual(calls, ['T-001', 'T-002']);
  assert.equal(f.gates, 6);
});

test('tarefa concluída não dispensa alterações em texto fora do token de status do heading', async (t) => {
  const f = fixture(t, { sequential: true });
  const tasks = path.join(f.base, 'tasks.md');
  writeFileSync(tasks, readFileSync(tasks, 'utf8') + '\nObservação original: [pendente].\n');
  git(f.root, 'add', '.'); git(f.root, 'commit', '-qm', 'Existing task note');
  f.plan.sourceFingerprint = planSourceFingerprint(f.root, f.plan);
  assert.equal((await executePlan(f.root, f.plan, f.options)).code, 0);
  writeFileSync(tasks, readFileSync(tasks, 'utf8').replace('Observação original: [pendente]', 'Observação original: [concluida]'));
  git(f.root, 'add', '.'); git(f.root, 'commit', '-qm', 'Unauthorized note rewrite');
  await assert.rejects(executePlan(f.root, f.plan, f.options), /artefatos existentes protegidos/);
  assert.equal(f.calls, 1);
  assert.equal(f.gates, 2);
});

test('faixa marcada integrada não passa após reset remover seus commits da árvore principal', async (t) => {
  const f = fixture(t);
  const first = await executePlan(f.root, f.plan, f.options);
  assert.equal(first.code, 0);
  assert.equal(f.calls, 1);
  assert.equal(f.gates, 2);
  git(f.root, 'reset', '--hard', f.initial);
  await assert.rejects(executePlan(f.root, f.plan, f.options), /integr|merge|commit|branch/i);
  assert.equal(f.calls, 1, 'não repetir uma tarefa para esconder a perda da integração');
  assert.equal(f.gates, 2, 'não declarar gate novo sem a implementação integrada');
});

test('cota inicial desconhecida bloqueia o primeiro despacho sem gastar inferência', async (t) => {
  const f = fixture(t);
  await assert.rejects(executePlan(f.root, f.plan, {
    ...f.options,
    readQuota: async () => ({ status: 'unavailable', reason: 'fonte nativa ausente' }),
  }), /cota|quotaCommand|telemetria/i);
  assert.equal(f.calls, 0);
  assert.equal(f.gates, 0);
  assert.equal((git(f.root, 'worktree', 'list', '--porcelain').match(/^worktree /gm) || []).length, 1, 'nenhum worktree paralelo criado sem telemetria');
});


test('histórico mantém limpeza acessível depois de regenerar ou apagar plano.json', async (t) => {
  const f = fixture(t);
  await executePlan(f.root, f.plan, f.options);
  const nextTask = { id: 'T-002', title: 'Segunda mudança', files: ['output2.txt'], refs: [], status: 'pendente', line: 1 };
  writeFileSync(path.join(f.base, 'tasks.md'), '## T-002 — Segunda mudança [pendente]\n\n- Arquivos: output2.txt\n');
  git(f.root, 'add', '.'); git(f.root, 'commit', '-qm', 'New scope');
  const project = { config: { ...DEFAULT_CONFIG, rootDir: f.root }, features: [{ name: 'example', tasks: { tasks: [nextTask] }, spec: { stories: [] } }] };
  const nextPlan = JSON.parse(renderPlanoJson(montarPlano(project, 'example', { agent: 'codex', enginePath: engine })));
  nextPlan.sourceFingerprint = planSourceFingerprint(f.root, nextPlan);
  await executePlan(f.root, nextPlan, { ...f.options, runTask: async (invocation) => {
    writeFileSync(path.join(invocation.cwd, 'output2.txt'), 'second implementation');
    git(invocation.cwd, 'add', '--', 'output2.txt'); git(invocation.cwd, 'commit', '-qm', 'T-002 example: second');
    return { code: 0 };
  } });
  const invoke = (...args) => spawnSync(process.execPath, [engine, 'worktrees', 'example', ...args], { cwd: f.root, encoding: 'utf8', shell: false });
  const latest = path.join(f.base, 'plano.json');
  writeFileSync(latest, 'not valid JSON');
  const listed = invoke();
  assert.equal(listed.status, 0, listed.stderr);
  const items = JSON.parse(listed.stdout);
  assert.equal(items.length, 2);
  assert.deepEqual(new Set(items.map((item) => item.runId)), new Set([f.plan.runId, nextPlan.runId]));
  assert.notEqual(items[0].path, items[1].path);
  rmSync(latest);
  const ambiguous = invoke('--limpar', '--confirmar');
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /--run/);
  const cleaned = invoke('--run', f.plan.runId, '--limpar', '--confirmar');
  assert.equal(cleaned.status, 0, cleaned.stderr);
  assert.equal(JSON.parse(cleaned.stdout).removed.length, 1);
  const first = items.find((item) => item.runId === f.plan.runId);
  const second = items.find((item) => item.runId === nextPlan.runId);
  assert.equal(existsSync(first.path), false);
  assert.equal(existsSync(second.path), true);
  assert.equal(listExecutionPlans(f.root, { feature: 'example' }).length, 2, 'histórico não é apagado pela limpeza');
});

test('histórico recusa checkpoints corrompidos ou com identidade divergente sem removê-los', async (t) => {
  const f = fixture(t);
  const result = await executePlan(f.root, f.plan, f.options);
  const directory = path.dirname(result.checkpoint);
  const corrupt = path.join(directory, 'corrupted.json');
  const copied = path.join(directory, 'copied.json');
  writeFileSync(corrupt, 'invalid JSON');
  writeFileSync(copied, readFileSync(result.checkpoint));
  const warnings = [];
  const plans = listExecutionPlans(f.root, { feature: 'example', onWarning: (message) => warnings.push(message) });
  assert.deepEqual(plans.map((plan) => plan.runId), [f.plan.runId]);
  assert.equal(warnings.length, 2);
  assert.ok(existsSync(corrupt)); assert.ok(existsSync(copied));
});

for (const [label, filename, remove] of [
  ['spec da própria feature', '.spec/features/example/spec.md', false],
  ['ADR de domínio anterior', '.spec/features/previous/adr.md', false],
  ['design anterior removido', '.spec/features/previous/design.md', true],
  ['plano legado', '.spec/features/example/plano.json', false],
  ['executor legado', '.spec/features/example/executar-tarefas.sh', false],
  ['constituição', '.spec/constituicao.md', false],
  ['configuração', 'onpspec.config.json', false],
]) {
  test(`worker não integra alteração em ${label}; preserva worktree e bloqueia nova inferência`, async (t) => {
    const f = fixture(t);
    const original = path.join(f.root, filename);
    if (!existsSync(original)) {
      mkdirSync(path.dirname(original), { recursive: true });
      writeFileSync(original, 'existing customer artifact\n');
      git(f.root, 'add', '--', filename); git(f.root, 'commit', '-qm', 'Existing customer artifact');
    }
    const originalContent = readFileSync(original, 'utf8');
    const before = git(f.root, 'rev-parse', 'HEAD');
    let calls = 0;
    const events = [];
    const options = { ...f.options, onEvent: (event) => events.push(event), runTask: async ({ cwd }) => {
      calls++;
      if (remove) rmSync(path.join(cwd, filename));
      else writeFileSync(path.join(cwd, filename), 'unauthorized replacement\n');
      writeFileSync(path.join(cwd, 'output.txt'), 'implementation retained for review');
      git(cwd, 'add', '-A'); git(cwd, 'commit', '-qm', 'T-001 modifies protected artifact');
      return { code: 0 };
    } };
    await assert.rejects(executePlan(f.root, f.plan, options), /artefatos existentes protegidos/);
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), before, 'unsafe lane must never merge');
    assert.equal(readFileSync(original, 'utf8'), originalContent, 'main checkout keeps the original');
    const checkpoint = JSON.parse(readFileSync(path.join(f.root, '.git/onp-spec/runs', `${f.plan.runId}.json`), 'utf8'));
    const worktree = checkpoint.worktrees['faixa-1'];
    assert.equal(checkpoint.tasks['faixa-1--T-001'].state, 'needs-review');
    assert.equal(worktree.unsafe, true);
    assert.equal(readFileSync(path.join(worktree.path, 'output.txt'), 'utf8'), 'implementation retained for review');
    assert.ok(events.some((event) => event.tipo === 'pergunta' && event.arquivos?.includes(filename)));
    assert.ok(!events.some((event) => event.tipo === 'tarefa' && event.estado === 'concluida'));
    assert.equal(f.gates, 0);
    await assert.rejects(executePlan(f.root, f.plan, options), /artefatos existentes protegidos/);
    assert.equal(calls, 1, 'restarting cannot silently retry an unresolved document rewrite');
  });
}

test('worker sequencial detecta edição sem commit e deixa os arquivos para revisão', async (t) => {
  const f = fixture(t, { sequential: true });
  const spec = path.join(f.base, 'spec.md');
  await assert.rejects(executePlan(f.root, f.plan, { ...f.options, runTask: async ({ cwd }) => {
    writeFileSync(path.join(cwd, '.spec/features/example/spec.md'), 'partial unauthorized replacement\n');
    writeFileSync(path.join(cwd, 'output.txt'), 'partial implementation');
    return { code: 0 };
  } }), /artefatos existentes protegidos/);
  assert.equal(readFileSync(spec, 'utf8'), 'partial unauthorized replacement\n', 'no destructive rollback of the worker checkout');
  assert.equal(readFileSync(path.join(f.root, 'output.txt'), 'utf8'), 'partial implementation');
  assert.equal(f.gates, 0);
  const checkpoint = JSON.parse(readFileSync(path.join(f.root, '.git/onp-spec/runs', `${f.plan.runId}.json`), 'utf8'));
  assert.equal(checkpoint.tasks['seq--T-001'].state, 'needs-review');
});

test('worker pode acrescentar proposta separada sem alterar originais e o motor registra status', async (t) => {
  const f = fixture(t);
  const original = readFileSync(path.join(f.base, 'spec.md'), 'utf8');
  const result = await executePlan(f.root, f.plan, { ...f.options, runTask: async ({ cwd }) => {
    const proposal = path.join(cwd, '.spec/features/example/revisoes/proposta/design.md');
    mkdirSync(path.dirname(proposal), { recursive: true });
    writeFileSync(proposal, '# Proposta separada para revisão\n');
    writeFileSync(path.join(cwd, 'output.txt'), 'implemented');
    git(cwd, 'add', '-A'); git(cwd, 'commit', '-qm', 'T-001 implementation and separate proposal');
    return { code: 0 };
  } });
  assert.equal(result.code, 0);
  assert.equal(readFileSync(path.join(f.base, 'spec.md'), 'utf8'), original);
  assert.ok(existsSync(path.join(f.base, 'revisoes/proposta/design.md')));
  assert.match(readFileSync(path.join(f.base, 'tasks.md'), 'utf8'), /\[concluida\]/);
});
