// Planos publicados são imutáveis. Documentos do cliente nunca são destinos.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PLAN_ARTIFACTS = ['plano.json', 'plano-execucao.md', 'executar-tarefas.mjs', 'executar-tarefas.sh', 'plano-execucao.html'];
const validId = (value) => typeof value === 'string' && /^[\w.-]+$/.test(value) && !['.', '..'].includes(value);
const present = (file) => { try { lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');

/** Reserva o destino até terminar a escrita exclusiva. Nunca remove artefatos. */
export function reservePlanArtifacts(root, plan) {
  if (!validId(plan.runId)) throw new Error('Identificador de execução inválido.');
  const base = path.resolve(root, plan.baseDir);
  const lock = path.join(base, '.onp-plan.lock');
  let ownsLock = false;
  try {
    writeFileSync(lock, plan.runId, { flag: 'wx' });
    ownsLock = true;
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const release = () => { if (ownsLock) { unlinkSync(lock); ownsLock = false; } };
  try {
    let destination = base;
    if (!ownsLock || PLAN_ARTIFACTS.some((name) => present(path.join(base, name)))) {
      const versions = path.join(base, 'execucoes');
      // Não seguir um link que possa apontar para documentos fora da feature.
      if (present(versions) && !lstatSync(versions).isDirectory()) throw new Error('execucoes já existe e não é um diretório próprio. Caminho preservado.');
      mkdirSync(versions, { recursive: true });
      destination = path.join(versions, plan.runId);
      mkdirSync(destination); // EEXIST preserva até uma execução parcial anterior.
    }
    return { directory: destination, artifactDir: relative(root, destination), release };
  } catch (error) { release(); throw error; }
}

/** Lê apenas planos nativos; scripts/JSON antigos continuam intocados. */
export function selectExecutionPlan(root, feature, { specDir = '.spec', runId } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(feature)) throw new Error('Feature inválida.');
  if (runId !== undefined && !validId(runId)) throw new Error('Informe um identificador válido em --run.');
  const base = path.resolve(root, specDir, 'features', feature);
  const files = [path.join(base, 'plano.json')];
  const versions = path.join(base, 'execucoes');
  if (present(versions) && lstatSync(versions).isDirectory()) {
    for (const entry of readdirSync(versions, { withFileTypes: true })) {
      if (entry.isDirectory() && validId(entry.name)) files.push(path.join(versions, entry.name, 'plano.json'));
    }
  }
  const candidates = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    let plan;
    try { plan = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    if (!plan || typeof plan !== 'object' || plan.version !== 2 || plan.feature !== feature || !validId(plan.runId)) continue;
    if (runId !== undefined && plan.runId !== runId) continue;
    if (path.resolve(root, plan.baseDir || '') !== base) continue;
    if (plan.artifactDir && path.resolve(root, plan.artifactDir) !== path.dirname(file)) continue;
    if (path.dirname(file) !== base && path.basename(path.dirname(file)) !== plan.runId) continue;
    const timestamp = Date.parse(plan.createdAt || (typeof plan.geradoEm === 'string' ? plan.geradoEm.replace(' ', 'T') + ':00Z' : ''));
    candidates.push({ plan, file, created: Number.isFinite(timestamp) ? timestamp : statSync(file).mtimeMs });
  }
  candidates.sort((a, b) => b.created - a.created || b.plan.runId.localeCompare(a.plan.runId));
  if (!candidates.length) {
    throw new Error(runId
      ? `Execução ${runId} não encontrada. Arquivos existentes foram preservados.`
      : 'Nenhum plano nativo encontrado. O executar-tarefas.sh antigo continua utilizável; onp-spec plano cria uma nova execução separada sem migrar as specs.');
  }
  return candidates[0].plan;
}
