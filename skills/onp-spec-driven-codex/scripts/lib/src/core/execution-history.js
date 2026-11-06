// Read-only index of plans actually owned by this repository's executor.
// Regenerating/deleting plano.json must not hide worktrees from previous runs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validSnapshot(state, filename) {
  const plan = state?.planSnapshot;
  return plan && plan.version === 2 && typeof plan.runId === 'string' && /^[\w.-]+$/.test(plan.runId)
    && filename === `${plan.runId}.json` && state.runId === plan.runId
    && typeof plan.feature === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(plan.feature)
    && typeof plan.baseDir === 'string' && typeof plan.specDir === 'string'
    && typeof plan.repoName === 'string' && Array.isArray(plan.faixas) && Array.isArray(plan.sequenciais)
    && plan.faixas.every((lane) => lane && typeof lane.id === 'string' && typeof lane.branch === 'string'
      && typeof lane.worktree === 'string' && Array.isArray(lane.tarefas))
    && state.planHash === digest(plan);
}

/** Only local executor snapshots with matching identity/hash are returned.
 * Optional warnings reveal filenames, never checkpoint contents/account data. */
export function listExecutionPlans(root, { feature, onWarning = () => {} } = {}) {
  if (feature !== undefined && (typeof feature !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(feature))) {
    throw new Error('Feature inválida para consultar histórico de execução.');
  }
  root = realpathSync(root);
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: root, encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (result.status !== 0) throw new Error('O histórico de execução exige um repositório Git.');
  const directory = path.join(path.resolve(root, result.stdout.trim()), 'onp-spec', 'runs');
  if (!existsSync(directory)) return [];
  const plans = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    let state;
    try { state = JSON.parse(readFileSync(path.join(directory, entry.name), 'utf8')); }
    catch { onWarning(`Checkpoint inválido preservado: ${entry.name}`); continue; }
    // Pre-archive checkpoints are retained and never guessed into ownership.
    if (!state?.planSnapshot) { onWarning(`Checkpoint sem plano arquivado preservado: ${entry.name}`); continue; }
    if (!validSnapshot(state, entry.name)) { onWarning(`Checkpoint com identidade ou conteúdo divergente preservado: ${entry.name}`); continue; }
    if (feature === undefined || state.planSnapshot.feature === feature) plans.push(state.planSnapshot);
  }
  return plans;
}
