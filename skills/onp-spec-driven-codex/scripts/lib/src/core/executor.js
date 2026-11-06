// Executor portátil, sem inferência auxiliar, painel ou dependência de Bash.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, appendFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { discoverModels, selectModel, readQuota, buildInvocation, notifyNative } from './harness.js';
import { quotaDecision, classifyRateLimit } from './quota.js';
import { checkGovernance } from './governance.js';
import { stopProcessTree } from './process.js';
import { registrarEvento, caminhoStream } from './ledger.js';

function git(root, args, { allowFailure = false, raw = false } = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
  if (r.status !== 0 && !allowFailure) throw new Error(`git ${args[0]}: ${r.stderr || r.error?.message || 'falhou'}`);
  return { code: r.status, out: raw ? (r.stdout || '') : (r.stdout || '').trim() };
}
function json(file) { return JSON.parse(readFileSync(file, 'utf8')); }
function atomicJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}
const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const withoutTaskStatus = (content) => content.replace(/^(##[ \t]+T-\d{3,}[ \t]*[—–-][^\r\n]*\[)(pendente|em-andamento|conclu[ií]da)(\][ \t]*\r?$)/gmi, '$1estado$3');
export function planSourceFingerprint(root, plan) {
  const paths = ['spec.md', 'tasks.md', 'prd.md', 'adr.md', 'design.md', 'research.md'].map((name) => `${plan.baseDir}/${name}`);
  paths.push(`${plan.specDir}/constituicao.md`, 'onpspec.config.json');
  const sources = paths.map((rel) => {
    const file = path.resolve(root, rel);
    let content = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (rel.endsWith('/tasks.md') && content !== null) content = content.replace(/\[(pendente|em-andamento|conclu[ií]da)\]/gi, '[estado]');
    return [rel, content];
  });
  const governance = path.join(root, plan.baseDir, 'governance.json');
  if (existsSync(governance)) {
    const state = json(governance);
    sources.push(['governance-inputs', { large: state.large, domains: state.domains, clientRequest: state.clientRequest }]);
  }
  return digest(sources);
}

function commonDir(root) { return path.resolve(root, git(root, ['rev-parse', '--git-common-dir']).out); }
function checkpointPath(root, runId) {
  if (!/^[\w.-]+$/.test(runId)) throw new Error('runId inválido');
  return path.join(commonDir(root), 'onp-spec', 'runs', `${runId}.json`);
}
function live(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}
function acquire(file) {
  const lock = `${file}.lock`;
  mkdirSync(path.dirname(lock), { recursive: true });
  try { writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 }); }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const owner = json(lock);
    if (live(owner.pid)) throw new Error(`Execução já ativa no processo ${owner.pid}`);
    rmSync(lock);
    writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
  }
  return () => rmSync(lock, { force: true });
}
function trackedWorktrees(root) {
  return git(root, ['worktree', 'list', '--porcelain', '-z']).out.split('\0\0').filter(Boolean).map((block) => {
    const fields = block.split('\0');
    return { path: fields.find((s) => s.startsWith('worktree '))?.slice(9), branch: fields.find((s) => s.startsWith('branch '))?.slice(7), locked: fields.some((s) => s.startsWith('locked')) };
  });
}
function dirty(root) { return git(root, ['status', '--porcelain', '--untracked-files=all']).out; }
// Workers read existing contracts and execution artifacts. New proposals may be
// added separately; only the orchestrator updates task status after integration.
function changedProtectedFiles(root, before, specDir) {
  const prefix = path.normalize(specDir).split(path.sep).join('/').replace(/\/$/, '');
  const paths = [`${prefix}/features/`, `${prefix}/constituicao.md`, 'onpspec.config.json'];
  const existing = new Set(git(root, ['ls-tree', '-r', '--name-only', '-z', before, '--', ...paths]).out.split('\0').filter(Boolean));
  if (!existing.size) return [];
  // Compare the original tree with the current working tree, including staged
  // and committed changes. --no-renames exposes deletion of an original as well.
  return git(root, ['diff', '--name-only', '-z', '--no-renames', before, '--', ...paths]).out
    .split('\0').filter((file) => existing.has(file));
}
function validatePlan(plan, root) {
  if (plan.version !== 2) throw new Error('Crie uma nova execução separada com esta versão; preserve o plano e o script anteriores.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(plan.feature)) throw new Error('Feature inválida');
  const base = path.resolve(root, plan.baseDir);
  const rel = path.relative(root, base);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Plano fora do projeto');
  const ids = new Set();
  for (const task of [...plan.faixas.flatMap((f) => f.tarefas), ...plan.sequenciais]) {
    if (!/^T-\d{3,}$/.test(task.id) || ids.has(task.id)) throw new Error('Tarefa inválida/duplicada no plano');
    ids.add(task.id);
  }
  for (const fx of plan.faixas) {
    if (!/^faixa-\d+$/.test(fx.id)) throw new Error('Faixa inválida');
    if (git(root, ['check-ref-format', '--branch', fx.branch], { allowFailure: true }).code !== 0) throw new Error('Branch inválida');
    const expected = path.resolve(root, '..', 'onp-worktrees', `${plan.repoName}-${plan.feature}-${fx.id}-${createHash('sha256').update(plan.runId).digest('hex').slice(0, 12)}`);
    if (path.resolve(root, fx.worktree) !== expected) throw new Error('Worktree fora da pasta de execução');
  }
}

// Propriedade é provada pelo checkpoint + registro git, nunca apenas pelo nome.
export function listExecutionWorktrees(root, plan) {
  root = realpathSync(root);
  validatePlan(plan, root);
  const file = checkpointPath(root, plan.runId);
  if (!existsSync(file)) return [];
  const state = json(file);
  const registered = trackedWorktrees(root);
  const active = existsSync(`${file}.lock`) && live(json(`${file}.lock`).pid);
  return Object.entries(state.worktrees || {}).map(([id, owned]) => {
    const entry = registered.find((w) => w.path && path.resolve(w.path) === path.resolve(owned.path));
    const exists = existsSync(owned.path);
    const matches = entry?.branch === `refs/heads/${owned.branch}`;
    const isDirty = exists && Boolean(dirty(owned.path));
    const integrated = exists && git(root, ['merge-base', '--is-ancestor', owned.branch, 'HEAD'], { allowFailure: true }).code === 0;
    return { id, ...owned, exists, registered: Boolean(entry), active, dirty: isDirty, integrated, safe: Boolean(!owned.unsafe && !active && entry && matches && !entry.locked && !isDirty && integrated) };
  });
}
export function cleanupExecutionWorktrees(root, plan, { confirmed = false } = {}) {
  if (!confirmed) throw new Error('Limpeza exige resposta afirmativa do usuário na ferramenta nativa e --confirmar.');
  const release = acquire(checkpointPath(root, plan.runId));
  try {
    // O lock aqui é da limpeza, não de execução; revalidar registro e conteúdo.
    const items = listExecutionWorktrees(root, plan).map((item) => ({ ...item, active: false, safe: Boolean(!item.unsafe && item.registered && !item.dirty && item.integrated) }));
    const removed = [];
    for (const item of items) {
      const entry = trackedWorktrees(root).find((w) => path.resolve(w.path || '') === path.resolve(item.path));
      if (!item.safe || entry?.locked || entry?.branch !== `refs/heads/${item.branch}`) continue;
      git(root, ['worktree', 'remove', item.path]); // sem --force, nunca apaga branch
      removed.push(item.path);
    }
    return { removed, preserved: items.filter((item) => !removed.includes(item.path)) };
  } finally { release(); }
}

function sessionFrom(event) {
  return event.thread_id || event.session_id || event.sessionID || event.sessionId || event.session?.id || event.conversation_id || event.result?.conversation_id || event.step_update?.conversation_id || null;
}
function failedEvent(e) {
  if (e.event === 'result' && e.result && typeof e.result === 'object') e = { ...e.result, type: 'result' };
  return (e.type === 'result' && ['ERROR', 'WAITING', 'CANCELED', 'INTERRUPTED', 'INVALID', 'RUNNING'].includes(e.status)) || e.type === 'session.error' || e.type === 'turn.failed' || e.type === 'error' || e.is_error === true || (e.type === 'result' && e.subtype && e.subtype !== 'success');
}
function runChild(invocation, { stream, onEvent, signal, register, waitForStop }) {
  return new Promise((resolve) => {
    mkdirSync(path.dirname(stream), { recursive: true });
    const child = spawn(invocation.command, invocation.args, { cwd: invocation.cwd, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    register(child);
    let pending = '', error = '', terminalFailure = false, stopping = null;
    const consume = (text) => {
      appendFileSync(stream, text);
      pending += text;
      if (pending.length > 2 * 1024 * 1024) pending = pending.slice(-1024 * 1024);
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        try { const event = JSON.parse(line); terminalFailure ||= failedEvent(event); onEvent(event); } catch { /* raw logs remain available */ }
      }
    };
    const cancel = () => { stopping = stopProcessTree(child); stopping.catch((err) => { error = err.message; terminalFailure = true; }); };
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (d) => consume(d.toString()));
    child.stderr.on('data', (d) => { const text = d.toString(); error = (error + text).slice(-16384); appendFileSync(`${stream}.stderr`, text); });
    child.on('error', (err) => { error = err.message; });
    child.on('close', async (code) => {
      let stopError = null;
      try { await Promise.all([stopping, waitForStop?.(child)].filter(Boolean)); } catch (err) { stopError = err.message; }
      signal?.removeEventListener('abort', cancel);
      if (pending.trim()) { try { const e = JSON.parse(pending); terminalFailure ||= failedEvent(e); onEvent(e); } catch {} }
      resolve({ code: terminalFailure || stopError ? (code || 1) : (code ?? 1), error, stopError });
    });
    if (signal?.aborted) cancel();
    child.stdin.on('error', (err) => { error ||= err.message; terminalFailure = true; });
    child.stdin.end(invocation.input || '');
  });
}

export async function executePlan(root, plan, options = {}) {
  root = realpathSync(root);
  validatePlan(plan, root);
  if (options.list) return { code: 0, targets: [...plan.faixas.map((f) => f.id), ...plan.sequenciais.map((t) => t.id), 'gate'], lanes: plan.faixas.map((f) => ({ id: f.id, tasks: f.tarefas.map((t) => t.id) })), worktrees: git(root, ['rev-parse', '--git-common-dir'], { allowFailure: true }).code === 0 ? listExecutionWorktrees(root, plan) : [] };
  if (options.lane && !plan.faixas.some((f) => f.id === options.lane)) throw new Error('Faixa desconhecida');
  if (options.task && !plan.sequenciais.some((t) => t.id === options.task)) throw new Error('Tarefa sequencial desconhecida');
  const stateFile = checkpointPath(root, plan.runId);
  const release = acquire(stateFile);
  const controller = new AbortController();
  const active = new Set();
  const pausedChildren = new WeakSet();
  const stoppingChildren = new WeakMap();
  const stopChild = (child) => {
    const promise = stopProcessTree(child); stoppingChildren.set(child, promise);
    promise.catch((err) => console.error(`Cancelamento pendente: ${err.message}`));
  };
  let interrupted = false, timer = null, monitoring = false, blocked = null, quotaAttempt = 0;
  const stop = () => { interrupted = true; controller.abort(); active.forEach(stopChild); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const cfg = plan.config || {};
  const adapters = { cwd: root, command: cfg.command, modelsCommand: cfg.modelsCommand, quotaCommand: cfg.quotaCommand, ...(options.adapters || {}) };
  const selectedModels = new Map();
  const rawQuotaRead = options.readQuota || (async () => {
    if (!selectedModels.size) return readQuota(plan.agent, adapters);
    const snapshots = await Promise.all([...selectedModels.values()].map((model) => readQuota(plan.agent, { ...adapters, model: model.id, rateLimitId: model.rateLimitId })));
    return {
      harness: plan.agent,
      status: snapshots.some((q) => q.status === 'available') ? 'available' : 'unavailable',
      observedAt: new Date(Math.min(...snapshots.map((q) => Date.parse(q.observedAt) || Date.now()))).toISOString(),
      windows: snapshots.flatMap((q) => q.status === 'available' ? q.windows : [{ remainingPercent: null }]),
      reason: snapshots.find((q) => q.status !== 'available')?.reason,
    };
  });
  const quotaRead = async () => { try { return await rawQuotaRead(); } catch (err) { return { status: 'unavailable', reason: err.message }; } };
  const modelRead = options.discoverModels || (() => discoverModels(plan.agent, adapters));
  const delay = options.sleep || (async (ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) await sleep(Math.min(60000, deadline - Date.now()), undefined, { signal: controller.signal });
  });
  let state;
  try { state = existsSync(stateFile) ? json(stateFile) : { runId: plan.runId, planHash: digest(plan), planSnapshot: plan, rootBranch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out, tasks: {}, worktrees: {}, lanes: {}, base: git(root, ['rev-parse', 'HEAD']).out }; }
  catch (error) { release(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); throw error; }
  const persist = () => atomicJson(stateFile, state);
  const event = (e) => {
    registrarEvento({ runId: plan.runId, ...e });
    options.onEvent?.(e);
    if (!options.quiet) console.log(JSON.stringify({ runId: plan.runId, ...e }));
  };
  const notify = async (payload) => {
    try { await notifyNative(plan.agent, payload, { enabled: cfg.notifications?.enabled === true, notifyCommand: cfg.notifications?.command, ...(options.notification || {}) }); }
    catch (err) { event({ tipo: 'notificacao', estado: 'indisponivel', motivo: err.message }); }
  };
  let catalogPromise = null, catalogTime = 0;
  const catalog = async (fresh = false) => {
    if (fresh || !catalogPromise || Date.now() - catalogTime > 60000) { catalogTime = Date.now(); catalogPromise = modelRead(); }
    return catalogPromise;
  };
  const setBlocked = (snapshot) => {
    blocked = snapshot; state.quota = snapshot; persist();
    active.forEach((child) => { pausedChildren.add(child); stopChild(child); });
  };
  let permissionPromise = null;
  const quotaGate = async () => {
    if (permissionPromise) return permissionPromise;
    permissionPromise = (async () => {
      for (;;) {
        if (interrupted) throw new Error('Execução interrompida; checkpoint preservado.');
        const snapshot = await quotaRead();
        let decision = quotaDecision(snapshot, { thresholdPercent: 5, attempt: quotaAttempt });
        if (decision.action === 'unknown' && blocked) {
          const previous = quotaDecision(blocked, { thresholdPercent: 5, attempt: quotaAttempt });
          // Um reset previsto não comprova renovação. Preserve o bloqueio até
          // uma leitura atual confirmar saldo acima da reserva.
          decision = { ...previous, action: 'wait', reason: decision.reason };
          event({ tipo: 'cota', estado: 'aguardando', ...decision });
          state.wait = decision; persist();
          await delay(Math.max(1000, decision.delayMs || 60000));
          quotaAttempt++; catalogPromise = null;
          continue;
        }
        if (decision.action !== 'wait') {
          if (decision.action === 'unknown') {
            event({ tipo: 'cota', estado: 'indisponivel', motivo: decision.reason });
            const error = new Error(`Cota indisponível: ${decision.reason} Conecte a leitura nativa por quotaCommand antes de iniciar headless.`);
            error.code = 'QUOTA_UNAVAILABLE';
            throw error;
          }
          blocked = null; quotaAttempt = 0; state.quota = null; delete state.wait; persist();
          return;
        }
        setBlocked(snapshot);
        event({ tipo: 'cota', estado: 'aguardando', ...decision });
        state.wait = decision; persist();
        await delay(Math.max(1000, decision.delayMs || 60000));
        quotaAttempt++;
        catalogPromise = null;
      }
    })();
    try { return await permissionPromise; } finally { permissionPromise = null; }
  };
  const preflight = () => {
    if (!plan.sourceFingerprint || plan.sourceFingerprint !== planSourceFingerprint(root, plan)) throw new Error('Plano desatualizado: documentos, tarefas ou configuração mudaram; crie uma nova execução separada antes de executar e preserve o plano anterior.');
    const result = (options.checkGovernance || checkGovernance)(root, plan.feature, { specDir: plan.specDir });
    if (!result.ok) {
      event({ tipo: 'pergunta', estado: 'aguardando-cliente', ...result });
      throw new Error('Impacto/PRD/ADR pendente: use a ferramenta nativa de pergunta e registre a decisão antes de executar.');
    }
  };
  const preserveExisting = (task, cwd, lane, record) => {
    if (!record.before) return;
    const taskFile = path.normalize(`${plan.baseDir}/tasks.md`).split(path.sep).join('/');
    const files = changedProtectedFiles(cwd, record.before, plan.specDir).filter((file) => {
      if (record.state !== 'completed' || file !== taskFile || !existsSync(path.join(cwd, file))) return true;
      // The orchestrator records status after completion. Only those heading
      // tokens are exempt on resume: preserve every other byte and file mode.
      if (git(cwd, ['diff', '--summary', record.before, '--', file]).out) return true;
      // Compare checkout bytes, not the LF-normalized blob: Git attributes or
      // core.autocrlf may legitimately materialize this file as CRLF.
      const before = git(cwd, ['cat-file', '--filters', `${record.before}:${file}`], { raw: true }).out;
      const current = readFileSync(path.join(cwd, file), 'utf8');
      return before === current || withoutTaskStatus(before) !== withoutTaskStatus(current);
    });
    if (!files.length) return;
    record.state = 'needs-review';
    record.protectedFiles = files;
    if (lane && state.worktrees[lane]) state.worktrees[lane].unsafe = true;
    persist();
    event({ tipo: 'pergunta', estado: 'aguardando-cliente', tarefa: task.id, faixa: lane, arquivos: files, motivo: 'Artefatos existentes foram alterados; revisão necessária antes de integrar. O trabalho foi preservado.' });
    const error = new Error(`${task.id} alterou artefatos existentes protegidos: ${files.join(', ')}. Preserve os originais e proponha uma versão separada; revisão necessária antes de retomar.`);
    error.code = 'SPEC_PRESERVATION_REQUIRED';
    throw error;
  };
  const taskRun = async (task, cwd, lane) => {
    const key = `${lane || 'seq'}--${task.id}`;
    const record = state.tasks[key] ||= { state: 'pending', attempts: 0 };
    if (record.pid && live(record.pid)) throw new Error(`${task.id} ainda tem processo ativo (${record.pid}); aguarde seu término antes de retomar.`);
    preserveExisting(task, cwd, lane, record);
    if (record.state === 'completed') {
      if (!record.commit || git(cwd, ['merge-base', '--is-ancestor', record.commit, 'HEAD'], { allowFailure: true }).code !== 0) throw new Error(`Commit de ${task.id} não está mais no worktree.`);
      return;
    }
    for (;;) {
      preflight(task.arquivos);
      let available = await catalog();
      let selected = selectModel(available, record.model || task.modelo);
      selectedModels.set(selected.id, selected);
      record.model = selected.id; persist();
      await quotaGate();
      available = await catalog();
      selected = selectModel(available, record.model || task.modelo);
      selectedModels.set(selected.id, selected);
      record.model = selected.id;
      record.before ||= git(cwd, ['rev-parse', 'HEAD']).out;
      record.attempts++; record.state = 'running'; persist();
      const stream = caminhoStream(plan.runId, `${key}-${record.attempts}`);
      event({ tipo: 'tarefa', tarefa: task.id, faixa: lane, estado: 'executando', stream, modelo: selected.id });
      let child, limitEvent = null;
      const invocation = buildInvocation(plan.agent, {
        ...cfg, command: available.command || cfg.command, model: selected,
        allowedTools: cfg.allowedTools ?? ['Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', ...(plan.testCommand ? [`Bash(${plan.testCommand}:*)`] : [])], effort: task.esforco || selected.defaultEffort, cwd, force: plan.agent === 'cursor',
        prompt: task.prompt, sessionId: record.sessionId,
        addDirs: [commonDir(root)],
      });
      const run = options.runTask || runChild;
      const result = await run(invocation, {
        stream, signal: controller.signal, waitForStop: (p) => stoppingChildren.get(p),
        register: (p) => { child = p; active.add(p); record.pid = p.pid; persist(); },
        onEvent: (e) => {
          const id = sessionFrom(e);
          if (id) { record.sessionId = id; persist(); }
          const limit = classifyRateLimit(e, { harness: plan.agent });
          if (limit && quotaDecision(limit).action === 'wait') { limitEvent = limit; setBlocked(limit); }
        },
      });
      if (child) active.delete(child);
      delete record.pid; persist();
      if (result.stopError) {
        record.state = 'needs-review';
        if (lane && state.worktrees[lane]) state.worktrees[lane].unsafe = true;
        persist(); throw new Error(`Não foi possível comprovar cancelamento de ${task.id}: ${result.stopError}`);
      }
      if (interrupted) { record.state = 'interrupted'; persist(); throw new Error('Execução interrompida; alterações preservadas.'); }
      preserveExisting(task, cwd, lane, record);
      const fromError = result.code !== 0 && classifyRateLimit({ type: 'error', error: { message: result.error } });
      if (limitEvent || fromError || (child && pausedChildren.has(child)) || (blocked && result.code !== 0)) {
        if (fromError) setBlocked(fromError);
        record.state = 'waiting-quota'; quotaAttempt++; persist();
        continue;
      }
      if (result.code !== 0) { record.state = 'failed'; persist(); event({ tipo: 'tarefa', tarefa: task.id, faixa: lane, estado: 'falhou' }); throw new Error(`${task.id} falhou: ${result.error || 'veja o stream'}`); }
      const commit = git(cwd, ['rev-parse', 'HEAD']).out;
      if (dirty(cwd) || commit === record.before) { record.state = 'needs-review'; persist(); throw new Error(`${task.id} terminou sem commit novo ou com alterações não commitadas; revise antes de retomar.`); }
      record.state = 'completed'; record.commit = commit; persist();
      event({ tipo: 'tarefa', tarefa: task.id, faixa: lane, estado: 'concluida', commit });
      await notify({ type: 'task.completed', task: task.id, feature: plan.feature, runId: plan.runId });
      return;
    }
  };
  const prepare = (lane) => {
    const target = path.resolve(root, lane.worktree);
    const owned = state.worktrees[lane.id];
    if (owned) {
      const registered = trackedWorktrees(root).find((w) => w.path && path.resolve(w.path) === target);
      if (!registered || registered.branch !== `refs/heads/${lane.branch}`) throw new Error(`Worktree de ${lane.id} mudou; não será recriado automaticamente.`);
      return target;
    }
    if (existsSync(target) || git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${lane.branch}`], { allowFailure: true }).code === 0) throw new Error(`Worktree/branch ${lane.id} já existe sem propriedade comprovada; preserve e revise.`);
    mkdirSync(path.dirname(target), { recursive: true });
    git(root, ['worktree', 'add', '-b', lane.branch, target, state.base]);
    state.worktrees[lane.id] = { path: realpathSync(target), branch: lane.branch }; persist();
    return target;
  };
  const laneRun = async (lane) => {
    if (state.lanes[lane.id] === 'merged') {
      if (git(root, ['merge-base', '--is-ancestor', lane.branch, 'HEAD'], { allowFailure: true }).code !== 0) throw new Error(`${lane.id} não está mais integrada na árvore principal; revise antes de retomar.`);
      for (const task of lane.tarefas) {
        const record = state.tasks[`${lane.id}--${task.id}`];
        if (!record?.commit || git(root, ['merge-base', '--is-ancestor', record.commit, 'HEAD'], { allowFailure: true }).code !== 0) throw new Error(`Commit de ${task.id} não está integrado.`);
      }
      return;
    }
    event({ tipo: 'faixa', faixa: lane.id, estado: 'executando' });
    try { const cwd = prepare(lane); for (const task of lane.tarefas) await taskRun(task, cwd, lane.id); state.lanes[lane.id] = 'ready'; persist(); }
    catch (err) { event({ tipo: 'faixa', faixa: lane.id, estado: 'falhou', motivo: err.message }); throw err; }
  };
  const engineRun = (args) => {
    const r = spawnSync(process.execPath, [path.resolve(root, plan.engine), ...args], { cwd: root, encoding: 'utf8', shell: false });
    if (!options.quiet && r.stdout) process.stdout.write(r.stdout);
    if (!options.quiet && r.stderr) process.stderr.write(r.stderr);
    return r.status ?? 1;
  };
  try {
    if (state.rootBranch && state.rootBranch !== git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out) throw new Error('A branch principal mudou desde o início da execução; volte à branch registrada antes de retomar.');
    if (state.planHash !== digest(plan)) throw new Error('Plano mudou durante a execução. Preserve o checkpoint e gere uma nova execução.');
    blocked = state.quota || null;
    persist();
    if (!options.gate) {
      preflight();
      if (!Object.keys(state.tasks).length && dirty(root)) throw new Error('Registre as alterações do projeto antes de executar em worktrees.');
      const selectedLanes = options.task ? [] : plan.faixas.filter((lane) => !options.lane || lane.id === options.lane);
      const selectedTasks = options.lane ? [] : plan.sequenciais.filter((task) => !options.task || task.id === options.task);
      const queued = [...selectedLanes.flatMap((lane) => lane.tarefas.map((task) => ({ key: `${lane.id}--${task.id}`, task }))), ...selectedTasks.map((task) => ({ key: `seq--${task.id}`, task }))]
        .filter(({ key }) => state.tasks[key]?.state !== 'completed');
      if (queued.length) {
        const initialCatalog = await catalog();
        for (const { key, task } of queued) {
          const model = selectModel(initialCatalog, state.tasks[key]?.model || task.modelo); selectedModels.set(model.id, model);
        }
        await quotaGate();
      }
      timer = setInterval(async () => {
        if (monitoring || !active.size || interrupted) return;
        monitoring = true;
        try { const q = await quotaRead(); if (quotaDecision(q, { thresholdPercent: 5 }).action === 'wait') setBlocked(q); }
        catch (err) { event({ tipo: 'cota', estado: 'indisponivel', motivo: err.message }); }
        finally { monitoring = false; }
      }, Math.max(1000, cfg.quota?.pollIntervalMs || 60000));
      event({ tipo: 'inicio', escopo: options.lane || options.task || 'tudo' });
      const waves = options.lane ? [[options.lane]] : options.task ? [] : plan.ondas;
      for (const wave of waves) {
        const lanes = wave.map((id) => plan.faixas.find((f) => f.id === id));
        const results = await Promise.allSettled(lanes.map(laneRun));
        // Mescla também faixas que passaram, preservando o trabalho de cada uma.
        for (const lane of lanes) {
          if (state.lanes[lane.id] !== 'ready') continue;
          preflight();
          for (const task of lane.tarefas) preserveExisting(task, state.worktrees[lane.id].path, lane.id, state.tasks[`${lane.id}--${task.id}`]);
          if (dirty(root)) throw new Error('Árvore principal alterada durante execução; merge preservado para revisão.');
          event({ tipo: 'faixa', faixa: lane.id, estado: 'mesclando' });
          const merge = git(root, ['merge', '--no-edit', lane.branch], { allowFailure: true });
          if (merge.code !== 0) { event({ tipo: 'faixa', faixa: lane.id, estado: 'conflito' }); throw new Error(`Conflito em ${lane.id}; resolva o merge sem apagar worktrees.`); }
          state.lanes[lane.id] = 'merged'; persist();
          event({ tipo: 'faixa', faixa: lane.id, estado: 'mesclada' });
        }
        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length) throw new Error(failures.map((r) => r.reason.message).join('\n'));
      }
      const sequential = options.lane ? [] : options.task ? plan.sequenciais.filter((t) => t.id === options.task) : plan.sequenciais;
      for (const task of sequential) await taskRun(task, root, null);
      preflight();
      const completed = [...plan.faixas.filter((f) => state.lanes[f.id] === 'merged').flatMap((f) => f.tarefas), ...plan.sequenciais.filter((t) => state.tasks[`seq--${t.id}`]?.state === 'completed')];
      for (const task of completed) if (engineRun(['tarefa', plan.feature, task.id, 'concluida']) !== 0) throw new Error(`Falha ao registrar ${task.id}`);
      const taskPath = `${plan.baseDir}/tasks.md`;
      if (git(root, ['diff', '--', taskPath]).out) { git(root, ['add', '--', taskPath]); git(root, ['commit', '-m', `spec(${plan.feature}): registrar tarefas concluídas`, '--', taskPath]); }
    }
    const gate = options.runGate || ((args) => engineRun(args));
    const verify = await gate(['verify', plan.feature]); event({ tipo: 'gate', etapa: 'verify', exit: verify });
    const audit = await gate(['audit', '--ci']); event({ tipo: 'gate', etapa: 'audit', exit: audit });
    const code = verify || audit ? 1 : 0;
    state.finished = code === 0; persist();
    event({ tipo: 'fim', exit: code });
    await notify({ type: 'execution.completed', feature: plan.feature, runId: plan.runId, success: code === 0 });
    return { code, checkpoint: stateFile };
  } catch (error) {
    state.error = error.message; persist();
    event({ tipo: 'fim', exit: interrupted ? 130 : 1, motivo: error.message });
    throw error;
  } finally {
    if (timer) clearInterval(timer);
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    release();
    const worktrees = Object.values(state.worktrees);
    if (worktrees.length) event({ tipo: 'pergunta', acao: 'limpar-worktrees', texto: 'Deseja limpar os worktrees usados nesta sessão?', worktrees: worktrees.map((w) => w.path) });
  }
}
