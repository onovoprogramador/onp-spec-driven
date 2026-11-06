// Real Node -> harness fixture subprocesses + real git worktrees, without network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/onp-spec.js', import.meta.url));
const FIXTURE = String.raw`
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [action, harness, ...args] = process.argv.slice(2);
const emit = (value) => console.log(JSON.stringify(value));
if (action === 'models') {
  emit({ harness, models: [{ id: 'available-model', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }] });
} else if (action === 'quota') {
  emit({ harness, observedAt: new Date().toISOString(), windows: [{ id: 'account', remainingPercent: 80 }] });
} else {
  const prompt = harness === 'codex' ? readFileSync(0, 'utf8') : harness === 'antigravity' ? args[args.indexOf('-p') + 1] : args.at(-1);
  const id = prompt.match(/T-\d{3}/)?.[0];
  if (!id) throw new Error('Prompt has no task');
  if (args[args.indexOf('--model') + 1] !== 'available-model') throw new Error('Model not from discovery');
  appendFileSync(process.env.ONP_STUB_CALLS, JSON.stringify({ id, harness, args, cwd: process.cwd() }) + '\n');
  if (harness === 'codex') emit({ type: 'thread.started', thread_id: 'session-' + id });
  else if (harness === 'antigravity') emit({ event: 'init', conversation_id: 'session-' + id, init: { model: 'available-model' } });
  else if (harness === 'opencode') emit({ type: 'step_start', sessionID: 'session-' + id });
  else emit({ type: 'system', subtype: 'init', session_id: 'session-' + id });
  if (process.env.ONP_STUB_FAIL === id) {
    writeFileSync('partial-' + id + '.txt', 'must survive the retry');
    if (harness === 'codex') emit({ type: 'turn.failed', error: { message: 'test fixture failure' } });
    else if (harness === 'antigravity') emit({ event: 'result', result: { conversation_id: 'session-' + id, status: 'ERROR', error: 'test fixture failure' } });
    else if (harness === 'opencode') emit({ type: 'error', error: { message: 'test fixture failure' } });
    else emit({ type: 'result', subtype: 'error_during_execution', is_error: true });
    // The native stream is authoritative even when a provider exits zero.
    process.exit(0);
  }
  if (id === 'T-002') {
    if (readFileSync('partial-' + id + '.txt', 'utf8') !== 'must survive the retry') throw new Error('Partial work was lost');
    if (!args.includes('session-' + id)) throw new Error('Did not resume the same session');
    unlinkSync('partial-' + id + '.txt');
  }
  mkdirSync('src', { recursive: true });
  const file = id === 'T-001' ? 'src/a.js' : 'src/b.js';
  writeFileSync(file, 'export const value = ' + JSON.stringify(id) + ';\n');
  for (const argv of [['add', '--', file], ['commit', '-qm', id + ': native fixture']]) {
    const result = spawnSync('git', argv, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  if (harness === 'codex') {
    emit({ type: 'item.completed', item: { type: 'agent_message', text: 'implemented ' + id } });
    emit({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 3 } });
  } else if (harness === 'opencode') emit({ type: 'step_finish', part: { reason: 'stop', tokens: { input: 5, output: 3 } }, sessionID: 'session-' + id });
  else if (harness === 'antigravity') emit({ event: 'result', result: { status: 'SUCCESS', response: 'implemented ' + id, conversation_id: 'session-' + id } });
  else emit({ type: 'result', subtype: 'success', is_error: false, result: 'implemented ' + id });
}
`;

const SPEC = `# Spec: Pagamentos

> feature: pagamentos
> status: em-implementacao

## Histórias

### US-001 — Cobrança

Como financeiro, quero cobrar, para receber.

#### AC-001 — Cobrança criada

- **Dado** um aluno ativo
- **Quando** o mês vira
- **Então** a cobrança aparece

## Suposições

Nenhuma.

## Perguntas em aberto

Nenhuma.
`;
const TASKS = `# Tasks: Pagamentos

> feature: pagamentos

## T-001 — Modelo [pendente]

- Refs: AC-001
- Arquivos: src/a.js

## T-002 — Serviço [pendente]

- Refs: AC-001
- Arquivos: src/b.js
`;

export function harnessExecutionSuite(harness) {
  test(`${harness}: executor Node preserva trabalho e retoma apenas a faixa que falhou`, async (t) => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), `onpspec-${harness}-`));
    const repo = path.join(tmp, 'project with spaces');
    const native = path.join(tmp, 'native fixture.mjs');
    const callsFile = path.join(tmp, 'calls.jsonl');
    const home = path.join(tmp, 'home');
    mkdirSync(repo);
    writeFileSync(native, FIXTURE);
    const env = { ...process.env, ONP_SPEC_HOME: home, ONP_STUB_CALLS: callsFile, ONP_STUB_FAIL: '' };
    const git = (args) => spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    const cli = (args, extra = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8', timeout: 15000 });
    const events = () => {
      const file = path.join(home, 'painel', 'ledger.jsonl');
      return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse) : [];
    };
    const calls = () => readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse);
    const specDir = path.join(repo, '.spec/features/pagamentos');
    const executor = path.join(specDir, 'executar-tarefas.mjs');
    const run = (args = [], extra = {}) => spawnSync(process.execPath, [executor, ...args], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8', timeout: 15000 });
    t.after(() => rmSync(tmp, { recursive: true, force: true }));
    for (const args of [['init', '-q'], ['config', 'user.email', 'test@example.invalid'], ['config', 'user.name', 'Native fixture']]) assert.equal(git(args).status, 0);
    assert.equal(cli(['init']).status, 0);
    assert.equal(cli(['new', 'pagamentos']).status, 0);
    writeFileSync(path.join(specDir, 'spec.md'), SPEC);
    writeFileSync(path.join(specDir, 'tasks.md'), TASKS);
    const config = JSON.parse(readFileSync(path.join(repo, 'onpspec.config.json'), 'utf8'));
    config.paralelo = {
      command: [process.execPath, native, 'execute', harness],
      modelsCommand: [process.execPath, native, 'models', harness],
      quotaCommand: [process.execPath, native, 'quota', harness],
    };
    writeFileSync(path.join(repo, 'onpspec.config.json'), JSON.stringify(config));
    git(['add', '-A']); git(['commit', '-qm', 'spec']);
    const planResult = cli(['plano', 'pagamentos', '--agents', harness]);
    assert.equal(planResult.status, 0, planResult.stderr);
    git(['add', '-A']); git(['commit', '-qm', 'execution plan']);
    const plan = JSON.parse(readFileSync(path.join(specDir, 'plano.json'), 'utf8'));
    const statePath = path.join(repo, '.git/onp-spec/runs', `${plan.runId}.json`);
    const state = () => JSON.parse(readFileSync(statePath, 'utf8'));

    await t.test('gera executor portátil sem HTML e lista alvos sem chamadas de IA', () => {
      assert.ok(existsSync(executor));
      assert.ok(!existsSync(path.join(specDir, 'plano-execucao.html')));
      assert.equal(plan.faixas.length, 2);
      const listing = run(['--listar']);
      assert.equal(listing.status, 0, listing.stderr);
      assert.match(listing.stdout, /faixa-1/);
      assert.match(listing.stdout, /faixa-2/);
      assert.ok(!existsSync(callsFile));
    });
    await t.test('falha parcial preserva worktrees e commits de outra faixa', () => {
      const result = run([], { ONP_STUB_FAIL: 'T-002' });
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(state().lanes['faixa-1'], 'merged');
      assert.equal(state().tasks['faixa-2--T-002'].state, 'failed');
      assert.equal(calls().filter((call) => call.id === 'T-001').length, 1);
      assert.ok(existsSync(path.join(repo, 'src/a.js')));
      const worktree = state().worktrees['faixa-2'].path;
      assert.equal(readFileSync(path.join(worktree, 'partial-T-002.txt'), 'utf8'), 'must survive the retry');
      assert.ok(events().some((event) => event.acao === 'limpar-worktrees'));
      assert.ok(events().filter((event) => event.tipo === 'tarefa' && event.stream).every((event) => existsSync(event.stream)));
    });
    await t.test('retoma sessão da faixa falha sem repetir o trabalho concluído', () => {
      const firstCommit = state().tasks['faixa-1--T-001'].commit;
      const result = run(['--faixa', 'faixa-2']);
      // Missing acceptance tests intentionally leave the real audit red.
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(state().lanes['faixa-2'], 'merged');
      assert.equal(state().tasks['faixa-1--T-001'].commit, firstCommit);
      assert.equal(state().tasks['faixa-1--T-001'].attempts, 1);
      assert.equal(state().tasks['faixa-2--T-002'].attempts, 2);
      assert.equal(calls().filter((call) => call.id === 'T-001').length, 1);
      assert.equal(calls().filter((call) => call.id === 'T-002').length, 2);
      assert.ok(existsSync(path.join(repo, 'src/b.js')));
      const taskText = readFileSync(path.join(specDir, 'tasks.md'), 'utf8');
      assert.match(taskText, /T-001 — Modelo \[concluida\]/);
      assert.match(taskText, /T-002 — Serviço \[concluida\]/);
      assert.ok(events().some((event) => event.tipo === 'gate' && event.etapa === 'audit' && event.exit === 1));
    });
    await t.test('gate isolado não chama modelos e alvo inválido falha sem executar', () => {
      const before = calls().length;
      assert.equal(run(['--gate']).status, 1);
      assert.notEqual(run(['--faixa', 'faixa-99']).status, 0);
      assert.equal(calls().length, before);
    });
    await t.test('limpeza exige confirmação e preserva worktree sujo e branches', () => {
      const owned = state().worktrees;
      assert.notEqual(cli(['worktrees', 'pagamentos', '--limpar']).status, 0);
      for (const worktree of Object.values(owned)) assert.ok(existsSync(worktree.path));
      const dirtyPath = path.join(owned['faixa-2'].path, 'user-notes.txt');
      writeFileSync(dirtyPath, 'keep my work');
      const cleanup = cli(['worktrees', 'pagamentos', '--limpar', '--confirmar']);
      assert.equal(cleanup.status, 0, cleanup.stderr);
      assert.ok(!existsSync(owned['faixa-1'].path));
      assert.ok(existsSync(dirtyPath));
      assert.equal(git(['show-ref', '--verify', '--quiet', `refs/heads/${owned['faixa-1'].branch}`]).status, 0);
    });
  });
}
