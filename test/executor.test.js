import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executePlan, listExecutionWorktrees, cleanupExecutionWorktrees, planSourceFingerprint } from '../src/core/executor.js';
import { montarPlano, renderPlanoJson } from '../src/core/plano.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const engine = fileURLToPath(new URL('../bin/onp-spec.js', import.meta.url));
function git(cwd, ...args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
function fixture(t, { sequential = false, count = 1 } = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onp-executor-'));
  const root = path.join(tmp, 'project with space'); mkdirSync(root);
  const oldHome = process.env.ONP_SPEC_HOME; process.env.ONP_SPEC_HOME = path.join(tmp, 'ledger');
  t.after(() => { if (oldHome === undefined) delete process.env.ONP_SPEC_HOME; else process.env.ONP_SPEC_HOME = oldHome; rmSync(tmp, { recursive: true, force: true }); });
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'user.name', 'test');
  const base = path.join(root, '.spec/features/example'); mkdirSync(base, { recursive: true });
  const tasks = Array.from({ length: count }, (_, i) => ({ id: `T-00${i + 1}`, title: `Task ${i + 1}`, files: [`file${i + 1}.txt`], refs: [], status: 'pendente', line: i }));
  writeFileSync(path.join(base, 'tasks.md'), tasks.map((task) => `## ${task.id} — ${task.title} [pendente]\n\n- Arquivos: ${task.files.join(', ')}\n`).join('\n'));
  writeFileSync(path.join(base, 'spec.md'), '# Spec: example\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'initial');
  const plan = JSON.parse(renderPlanoJson(montarPlano({ config: { ...DEFAULT_CONFIG, rootDir: root }, features: [{ name: 'example', tasks: { tasks }, spec: { stories: [] } }] }, 'example', { agent: 'codex', sequencial: sequential, enginePath: engine })));
  plan.sourceFingerprint = planSourceFingerprint(root, plan);
  const events = [], waits = [];
  const options = {
    quiet: true,
    discoverModels: async () => ({ harness: 'codex', status: 'available', models: [{ id: 'actual-account-model', isDefault: true, efforts: ['medium'] }] }),
    readQuota: async () => quota(80),
    checkGovernance: () => ({ ok: true }),
    runGate: async () => 0,
    onEvent: (event) => events.push(event),
    sleep: async (ms) => { waits.push(ms); },
  };
  return { root, base, plan, options, events, waits };
}
function quota(remaining) { return { status: 'available', observedAt: new Date().toISOString(), windows: [{ id: 'five-hour', remainingPercent: remaining, resetAt: new Date(Date.now() + 2000).toISOString() }] }; }
function commitFile(cwd, file = 'file1.txt', value = 'done') { writeFileSync(path.join(cwd, file), value); git(cwd, 'add', '--', file); git(cwd, 'commit', '-qm', `Implement ${file}`); }

test('reserva em 5% aguarda nova leitura; conclui, notifica e só limpa worktree com confirmação', async (t) => {
  const f = fixture(t); let probes = 0, executions = 0; const notifications = [];
  f.plan.config.notifications = { enabled: true };
  const result = await executePlan(f.root, f.plan, { ...f.options,
    notification: { notify: async (e) => notifications.push(e) },
    readQuota: async () => quota(++probes === 1 ? 5 : 80),
    runTask: async (inv) => { executions++; assert.equal(inv.args[inv.args.indexOf('--model') + 1], 'actual-account-model'); commitFile(inv.cwd); return { code: 0 }; },
  });
  assert.equal(result.code, 0); assert.equal(executions, 1); assert.equal(f.waits.length, 1); assert.ok(probes >= 2);
  assert.equal(notifications.length, 2); assert.equal(readFileSync(path.join(f.root, 'file1.txt'), 'utf8'), 'done');
  assert.ok(f.events.some((e) => e.acao === 'limpar-worktrees'));
  const worktrees = listExecutionWorktrees(f.root, f.plan); assert.equal(worktrees.length, 1); assert.equal(worktrees[0].safe, true);
  assert.throws(() => cleanupExecutionWorktrees(f.root, f.plan), /confirma|afirmativa/);
  const cleanup = cleanupExecutionWorktrees(f.root, f.plan, { confirmed: true }); assert.equal(cleanup.removed.length, 1);
  assert.equal(existsSync(worktrees[0].path), false);
  assert.equal(git(f.root, 'show-ref', '--verify', `refs/heads/${worktrees[0].branch}`).length > 0, true, 'branch preservada');
});

test('limite durante execução preserva alterações e retoma a sessão após leitura fresca, preservando bloqueio quando a telemetria falha', async (t) => {
  const f = fixture(t, { sequential: true }); let attempts = 0, probes = 0;
  const result = await executePlan(f.root, f.plan, { ...f.options,
    readQuota: async () => ++probes === 3 ? { status: 'unavailable', reason: 'native unavailable' } : quota(80),
    runTask: async (inv, hooks) => {
      if (++attempts === 1) {
        writeFileSync(path.join(inv.cwd, 'file1.txt'), 'partial');
        hooks.onEvent({ type: 'thread.started', thread_id: 'session-specific' });
        hooks.onEvent({ type: 'turn.failed', error: { code: 'usage_limit_reached', retry_after: 1 } });
        return { code: 1 };
      }
      assert.ok(inv.args.includes('session-specific'));
      assert.equal(readFileSync(path.join(inv.cwd, 'file1.txt'), 'utf8'), 'partial');
      commitFile(inv.cwd); return { code: 0 };
    },
  });
  assert.equal(result.code, 0); assert.equal(attempts, 2); assert.equal(f.waits.length, 1); assert.ok(f.waits[0] >= 1000);
});

test('faixa que passou não é repetida quando outra falha; retry preserva trabalho parcial', async (t) => {
  const f = fixture(t, { count: 2 }); const calls = { 'T-001': 0, 'T-002': 0 };
  const runTask = async (inv) => {
    const id = inv.input.match(/T-\d+/)[0]; calls[id]++;
    if (id === 'T-002' && calls[id] === 1) { writeFileSync(path.join(inv.cwd, 'file2.txt'), 'partial'); return { code: 1, error: 'test failure' }; }
    if (id === 'T-002') assert.equal(readFileSync(path.join(inv.cwd, 'file2.txt'), 'utf8'), 'partial');
    commitFile(inv.cwd, id === 'T-001' ? 'file1.txt' : 'file2.txt'); return { code: 0 };
  };
  await assert.rejects(executePlan(f.root, f.plan, { ...f.options, runTask }), /T-002 falhou/);
  assert.equal(readFileSync(path.join(f.root, 'file1.txt'), 'utf8'), 'done');
  const result = await executePlan(f.root, f.plan, { ...f.options, lane: 'faixa-2', runTask });
  assert.equal(result.code, 0); assert.deepEqual(calls, { 'T-001': 1, 'T-002': 2 });
});

test('modelo inexistente e impacto pendente impedem execução antes de qualquer implementação', async (t) => {
  const f = fixture(t); let ran = false;
  await assert.rejects(executePlan(f.root, f.plan, { ...f.options, checkGovernance: () => ({ ok: false, conflicts: [{ id: 'ADR' }] }), runTask: async () => { ran = true; } }), /Impacto\/PRD\/ADR/);
  assert.equal(ran, false);
  const other = fixture(t);
  other.plan.faixas[0].tarefas[0].modelo = 'invented';
  await assert.rejects(executePlan(other.root, other.plan, { ...other.options, runTask: async () => { ran = true; } }), /não está disponível/);
  assert.equal(ran, false);
});

test('limpeza preserva worktree com arquivo não rastreado mesmo já integrado', async (t) => {
  const f = fixture(t);
  await executePlan(f.root, f.plan, { ...f.options, runTask: async (inv) => { commitFile(inv.cwd); return { code: 0 }; } });
  const [item] = listExecutionWorktrees(f.root, f.plan);
  writeFileSync(path.join(item.path, 'keep.txt'), 'user change');
  const result = cleanupExecutionWorktrees(f.root, f.plan, { confirmed: true });
  assert.deepEqual(result.removed, []); assert.equal(result.preserved.length, 1); assert.ok(existsSync(path.join(item.path, 'keep.txt')));
});
