// Documentos e decisões de produto são entradas versionadas da execução.
// Este gate valida integridade/rastreabilidade; a análise semântica é feita
// pelo agente e registrada explicitamente, nunca inferida por regex.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTasks } from '../parsers/tasks.js';
import { globToRegExp } from '../util/text.js';

const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url));
export const GOVERNANCE_DOCUMENTS = ['prd.md', 'adr.md', 'design.md', 'spec.md', 'tasks.md', 'research.md'];
export const DOCUMENTATION_CONTRACT = 'onp-docs-v1';
export const DOCUMENTATION_MARKER = '<!-- onp-spec:documentation-contract=v1 -->';
const LABELS = { 'prd.md': 'PRD', 'adr.md': 'ADR', 'design.md': 'TDD', 'spec.md': 'Spec', 'tasks.md': 'Tarefas', 'research.md': 'Pesquisa' };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const unique = (items) => [...new Set(items)].sort();
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
const read = (file) => existsSync(file) ? readFileSync(file, 'utf8') : null;

function featureDir(rootDir, feature, specDir = '.spec') {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(feature)) throw new Error('feature inválida: use kebab-case');
  return path.join(rootDir, specDir, 'features', feature);
}

function readState(dir) {
  const raw = read(path.join(dir, 'governance.json'));
  if (raw === null) return null;
  const data = JSON.parse(raw);
  const string = (value) => typeof value === 'string' && value.trim().length > 0;
  const conflict = (value) => value && string(value.id) && string(value.summary) && string(value.rule);
  if (data.version !== 1 || !Array.isArray(data.domains) || !data.domains.every(string) ||
      !Array.isArray(data.decisions) || !data.decisions.every((value) => value &&
        string(value.conflictId) && ['prosseguir', 'ajustar', 'cancelar'].includes(value.choice) &&
        string(value.answer) && string(value.source) && string(value.fingerprint) && string(value.answeredAt)) ||
      (data.review != null && (!string(data.review.summary) || !string(data.review.reviewer) ||
        !string(data.review.fingerprint) || !Array.isArray(data.review.conflicts) || !data.review.conflicts.every(conflict)))) {
    throw new Error('governance.json inválido ou de versão não suportada');
  }
  return data;
}

function writeState(dir, state) {
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'governance.json');
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
  renameSync(tmp, target);
}

export function documentLinks(file) {
  return GOVERNANCE_DOCUMENTS.filter((name) => name !== file)
    .map((name) => `[${LABELS[name]}](${name})`).join(' · ');
}

function hasDocumentationMarker(dir) {
  return GOVERNANCE_DOCUMENTS.some((name) => read(path.join(dir, name))?.includes(DOCUMENTATION_MARKER));
}

/** O formato de documentos antigos nunca os inscreve no contrato novo. */
export function isGovernanceEnrolled(rootDir, feature, { specDir = '.spec' } = {}) {
  const dir = featureDir(rootDir, feature, specDir);
  if (hasDocumentationMarker(dir)) return true;
  const raw = read(path.join(dir, 'governance.json'));
  if (!raw) return false;
  try {
    const state = JSON.parse(raw);
    return state.documentationContract === DOCUMENTATION_CONTRACT ||
      (state.version === 1 && Boolean(state.review || state.decisions?.length));
  } catch {
    // Um registro novo truncado ainda precisa falhar fechado na validação;
    // menção ao nome do contrato no texto do cliente não inscreve o legado.
    return /"documentationContract"\s*:\s*"onp-docs-v1"/.test(raw);
  }
}

function quoteRequest(text) {
  return text.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
}

/** Idempotente: não sobrescreve documentos existentes nem respostas. */
export function scaffoldGovernance(rootDir, feature, { specDir = '.spec', clientRequest = '', domains = [], newFeature = false } = {}) {
  const dir = featureDir(rootDir, feature, specDir);
  mkdirSync(dir, { recursive: true });
  const existingState = readState(dir);
  const state = existingState || {
    version: 1, large: newFeature, ...(newFeature ? { documentationContract: DOCUMENTATION_CONTRACT } : {}), domains: unique(domains),
    clientRequest: String(clientRequest), review: null, decisions: [],
  };
  const title = feature.split('-').join(' ');
  const created = [];
  const preserved = [];
  for (const name of GOVERNANCE_DOCUMENTS) {
    const dest = path.join(dir, name);
    if (!existsSync(dest)) {
      const template = readFileSync(path.join(TEMPLATES, name), 'utf8');
      const vars = {
        TITULO: title, FEATURE: feature, LINKS: documentLinks(name),
        PEDIDO_CLIENTE: state.clientRequest ? quoteRequest(state.clientRequest) : 'PENDENTE: transcrever o pedido literal do cliente.',
        TITULO_HISTORIA: '[título da história]',
      };
      let content = template.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
      if (newFeature) content = `${DOCUMENTATION_MARKER}\n\n${content}`;
      if (GOVERNANCE_DOCUMENTS.some((other) => other !== name && !content.includes(`](${other})`))) {
        content += `\n## Documentos relacionados\n\n${documentLinks(name)}\n`;
      }
      writeFileSync(dest, content, { flag: 'wx' });
      created.push(relative(rootDir, dest));
    } else preserved.push(relative(rootDir, dest));
  }
  const statePath = relative(rootDir, path.join(dir, 'governance.json'));
  if (!existingState) {
    writeFileSync(path.join(dir, 'governance.json'), `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    created.push(statePath);
  }
  else preserved.push(statePath);
  return { dir, created, preserved, state };
}

function taskFiles(content) {
  return content ? parseTasks(content).tasks.flatMap((task) => task.files) : [];
}

function normalizeFile(file) {
  return path.posix.normalize(String(file).replace(/\\/g, '/')).replace(/^\.\//, '');
}

function overlaps(a, b) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`) ||
    globToRegExp(a).test(b) || globToRegExp(b).test(a);
}

function conflictFingerprint(conflict) {
  return hash(JSON.stringify({
    id: conflict.id, summary: conflict.summary, rule: conflict.rule,
    feature: conflict.feature || null, files: unique(conflict.files || []), domains: unique(conflict.domains || []),
  }));
}

function snapshot(rootDir, feature, { specDir = '.spec', files, domains } = {}) {
  const dir = featureDir(rootDir, feature, specDir);
  const state = readState(dir);
  const ownFiles = unique((files || taskFiles(read(path.join(dir, 'tasks.md')))).map(normalizeFile));
  const ownDomains = unique(domains || state?.domains || []);
  const documents = [];
  const inputs = [];
  const ownInputs = [];
  const conflicts = [];
  const featuresRoot = path.dirname(dir);
  const entries = existsSync(featuresRoot) ? readdirSync(featuresRoot, { withFileTypes: true }) : [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const otherDir = path.join(featuresRoot, entry.name);
    const otherState = readState(otherDir);
    // Status das tarefas muda durante a execução; isso não modifica seu escopo.
    for (const name of GOVERNANCE_DOCUMENTS) {
      const filename = path.join(otherDir, name);
      let content = read(filename);
      if (content === null) continue;
      if (name === 'tasks.md') content = content.replace(/\[(pendente|em-andamento|conclu[ií]da)\]/gi, '[estado]');
      const file = relative(rootDir, filename);
      documents.push(file);
      const input = [file, hash(content)];
      inputs.push(input);
      if (entry.name === feature) ownInputs.push(input);
    }
    const governanceInput = [`${entry.name}/governance-inputs`, otherState ? {
      large: otherState.large, documentationContract: otherState.documentationContract,
      domains: otherState.domains, clientRequest: otherState.clientRequest,
    } : null];
    inputs.push(governanceInput);
    if (entry.name === feature) ownInputs.push(governanceInput);
    if (entry.name === feature) continue;
    const previousFiles = taskFiles(read(path.join(otherDir, 'tasks.md'))).map(normalizeFile);
    const commonFiles = ownFiles.filter((file) => previousFiles.some((other) => overlaps(file, other)));
    const commonDomains = ownDomains.filter((domain) => (otherState?.domains || []).includes(domain));
    if (commonFiles.length || commonDomains.length) {
      conflicts.push({
        id: `impacto:${entry.name}`, automatic: true, feature: entry.name,
        summary: `A mudança interfere no domínio da feature ${entry.name}.`,
        files: commonFiles, domains: commonDomains,
        rule: relative(rootDir, path.join(otherDir, existsSync(path.join(otherDir, 'prd.md')) ? 'prd.md' : 'spec.md')),
      });
    }
  }
  for (const filename of [path.join(rootDir, specDir, 'constituicao.md'), path.join(rootDir, 'onpspec.config.json')]) {
    if (!existsSync(filename)) continue;
    const file = relative(rootDir, filename);
    const input = [file, hash(readFileSync(filename))];
    documents.push(file);
    inputs.push(input);
    ownInputs.push(input);
  }
  const hasRules = documents.some((file) => /\/(prd|adr)\.md$/.test(file));
  const fingerprint = hash(JSON.stringify({ inputs, feature, files: ownFiles, domains: ownDomains }));
  const ownFingerprint = hash(JSON.stringify({ inputs: ownInputs, feature, files: ownFiles, domains: ownDomains }));
  const large = Boolean(state?.documentationContract === DOCUMENTATION_CONTRACT || hasDocumentationMarker(dir));
  return { dir, state, large, files: ownFiles, domains: ownDomains, documents, fingerprint, ownFingerprint, conflicts, required: Boolean(large || hasRules || conflicts.length) };
}

function sections(content) {
  const found = new Map();
  const pattern = /^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
  for (const match of content.matchAll(pattern)) found.set(match[1].trim(), match[2].trim());
  return found;
}

function draftIssues(name, content) {
  const issues = [];
  const actual = sections(content);
  const original = sections(readFileSync(path.join(TEMPLATES, name), 'utf8'));
  for (const [heading, body] of original) {
    if (body.includes('{{PEDIDO_CLIENTE}}')) continue;
    if (!actual.has(heading) || !actual.get(heading) || actual.get(heading) === body) {
      issues.push({ code: 'DOCUMENTO_NAO_PREENCHIDO', message: `${name}: preencha a seção "${heading}" com dados da feature; instruções do template não são conteúdo revisado.` });
    }
  }
  if (/\|\s*Preencher\s*(?=\|)|^\s*PENDENTE:|\{\{\w+\}\}/im.test(content)) {
    issues.push({ code: 'DOCUMENTO_NAO_PREENCHIDO', message: `${name} ainda contém marcadores de preenchimento.` });
  }
  return issues;
}

export function validateDesignDocument(content) {
  const issues = [];
  for (let i = 1; i <= 20; i++) {
    const section = content.match(new RegExp(`^## ${i}\\. [^\\n]+\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
    if (!section || !section[1].replace(/<!--[\s\S]*?-->/g, '').trim()) {
      issues.push({ code: 'TDD_SECAO_AUSENTE', message: `design.md precisa da seção ${i} preenchida.` });
    }
  }
  return issues;
}

function validateBundle(snap) {
  if (!snap.large) return [];
  const design = read(path.join(snap.dir, 'design.md'));
  const issues = design === null ? [] : [...validateDesignDocument(design), ...draftIssues('design.md', design)];
  if (snap.state?.documentationContract !== DOCUMENTATION_CONTRACT) issues.push({ code: 'GOVERNANCA_AUSENTE', message: 'Documentos com o contrato novo exigem seu registro em governance.json; apagar somente o registro não libera a execução.' });
  for (const name of GOVERNANCE_DOCUMENTS) {
    const content = read(path.join(snap.dir, name));
    if (!content) {
      issues.push({ code: 'DOCUMENTO_AUSENTE', message: `${name} obrigatório para especificação grande.` });
      continue;
    }
    for (const other of GOVERNANCE_DOCUMENTS.filter((f) => f !== name)) {
      if (!content.includes(`](${other})`)) issues.push({ code: 'VINCULO_AUSENTE', message: `${name} precisa vincular ${other}.` });
    }
    if (['prd.md', 'adr.md', 'design.md', 'research.md'].includes(name) &&
        !/^>\s*status:\s*(revisado|aceito|aprovado)\s*$/mi.test(content)) {
      issues.push({ code: 'DOCUMENTO_RASCUNHO', message: `${name} precisa ser preenchido e revisado (status: revisado).` });
    }
    if (['prd.md', 'adr.md', 'research.md'].includes(name)) issues.push(...draftIssues(name, content));
  }
  const request = snap.state?.clientRequest;
  if (!request?.trim() || !(read(path.join(snap.dir, 'prd.md')) || '').includes(quoteRequest(request))) {
    issues.push({ code: 'PEDIDO_CLIENTE_AUSENTE', message: 'O PRD deve preservar o pedido literal registrado em governance.json.' });
  }
  return issues;
}

/** Gate para executar: não faz chamadas de rede, não responde pelo cliente. */
export function checkGovernance(rootDir, feature, options = {}) {
  let snap;
  try { snap = snapshot(rootDir, feature, options); }
  catch (error) { return { ok: false, required: true, issues: [{ code: 'GOVERNANCA_INVALIDA', message: error.message }], conflicts: [], documents: [] }; }
  const issues = validateBundle(snap);
  const review = snap.state?.review;
  // Uma feature entregue ainda precisa provar sua revisão e decisões. Apenas
  // documentos de outras features criados depois deixam de invalidar o parecer
  // histórico; alterações próprias, na constituição ou config continuam bloqueando.
  const historical = Boolean(options.historical || options.integrityOnly);
  const reviewCurrent = Boolean(review && (historical
    ? review.ownFingerprint === snap.ownFingerprint
    : review.fingerprint === snap.fingerprint));
  if ((snap.required || review) && !reviewCurrent) {
    issues.push({ code: 'REVISAO_IMPACTO_PENDENTE', message: 'Releia os PRDs, ADRs e domínios existentes e registre uma revisão semântica atual antes de executar.' });
  }
  const conflicts = historical ? [] : [...snap.conflicts];
  if (historical || reviewCurrent) {
    for (const conflict of review?.conflicts || []) {
      if (!conflicts.some((existing) => existing.id === conflict.id)) conflicts.push(conflict);
    }
  }
  for (const conflict of conflicts) {
    const decision = [...(snap.state?.decisions || [])].reverse().find((d) => d.conflictId === conflict.id &&
      d.conflictFingerprint === conflictFingerprint(conflict) && (historical
        ? d.ownFingerprint === snap.ownFingerprint
        : d.fingerprint === snap.fingerprint));
    if (!decision || decision.choice !== 'prosseguir') issues.push({
      code: 'DECISAO_CLIENTE_PENDENTE', conflictId: conflict.id,
      message: `${conflict.summary} Alerte o cliente e use a ferramenta de perguntas do harness antes da ação afetada.`,
    });
  }
  return { ok: issues.length === 0, required: snap.required, issues, conflicts, documents: snap.documents, fingerprint: snap.fingerprint, ownFingerprint: snap.ownFingerprint };
}

/** O agente declara o resultado da leitura; conflito não é descartado por silêncio. */
export function recordImpactReview(rootDir, feature, { summary, reviewer, conflicts = [], ...options } = {}) {
  if (!summary?.trim() || !reviewer?.trim()) throw new Error('revisão exige resumo da análise e identificação do revisor/harness');
  const snap = snapshot(rootDir, feature, options);
  const ids = new Set(snap.conflicts.map((c) => c.id));
  const all = [...snap.conflicts];
  for (const conflict of conflicts) {
    if (!conflict.id?.trim() || !conflict.summary?.trim() || !conflict.rule?.trim()) throw new Error('conflito exige id, summary e rule (PRD/ADR/domínio afetado)');
    if (ids.has(conflict.id)) throw new Error(`id de conflito duplicado: ${conflict.id}`);
    ids.add(conflict.id);
    all.push(conflict);
  }
  // Regravar o mesmo parecer não apaga um conflito conhecido. Para resolvê-lo
  // sem autorização, altere a proposta/documentos e faça uma nova análise.
  if (snap.state?.review?.ownFingerprint === snap.ownFingerprint) {
    for (const conflict of snap.state.review.conflicts || []) {
      if (!ids.has(conflict.id)) { all.push(conflict); ids.add(conflict.id); }
    }
  }
  const state = snap.state || { version: 1, large: false, domains: snap.domains, decisions: [], clientRequest: '' };
  state.review = { summary, reviewer, conflicts: all, fingerprint: snap.fingerprint, ownFingerprint: snap.ownFingerprint, reviewedAt: new Date().toISOString(), documents: snap.documents };
  writeState(snap.dir, state);
  // A primeira criação de governance.json também passa a integrar o snapshot.
  const refreshed = snapshot(rootDir, feature, options);
  state.review.fingerprint = refreshed.fingerprint;
  state.review.ownFingerprint = refreshed.ownFingerprint;
  writeState(snap.dir, state);
  return checkGovernance(rootDir, feature, options);
}

/** Registra resposta já recebida pela ferramenta nativa; nunca cria aprovação. */
export function recordGovernanceDecision(rootDir, feature, { conflictId, choice, answer, source, ...options } = {}) {
  if (!['prosseguir', 'ajustar', 'cancelar'].includes(choice)) throw new Error('decisão deve ser prosseguir, ajustar ou cancelar');
  if (!answer?.trim() || !source?.trim()) throw new Error('registre a resposta literal e sua origem (ferramenta/mensagem do cliente)');
  const snap = snapshot(rootDir, feature, options);
  if (snap.state?.review?.fingerprint !== snap.fingerprint) throw new Error('revisão ausente ou desatualizada; revise o impacto antes de registrar decisão');
  const conflict = snap.state.review.conflicts.find((c) => c.id === conflictId);
  if (!conflict) throw new Error(`conflito inexistente: ${conflictId}`);
  snap.state.decisions.push({ conflictId, choice, answer, source, fingerprint: snap.fingerprint, ownFingerprint: snap.ownFingerprint,
    conflictFingerprint: conflictFingerprint(conflict), answeredAt: new Date().toISOString() });
  writeState(snap.dir, snap.state);
  return checkGovernance(rootDir, feature, options);
}
