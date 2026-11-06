// Plano de execução — transforma as tarefas pendentes de tasks.md em FAIXAS:
// tarefas com `Arquivos:` disjuntos podem rodar em PARALELO (1 faixa = 1
// git worktree + 1 branch + 1 janela de contexto limpa); tarefas que
// compartilham arquivo caem na MESMA faixa (sequência dentro dela); tarefa
// sem `Arquivos:` tem pegada desconhecida → roda ao final, uma a uma, na
// árvore principal.
//
// PARALELIZAR É ESCOLHA DO USUÁRIO: o agente pergunta antes — inclusive QUAIS
// tarefas paralelizar. Com `--paralelizar T-001,T-003`, só as escolhidas
// concorrem às faixas; as demais rodam uma após a outra, na árvore principal,
// depois das ondas. Com `--sequencial`, o plano roda TODAS as tarefas uma
// após a outra (sem worktrees) — mesma disciplina de commits e mesmo gate.
//
// Cálculo independente do harness; execução Node portátil, progresso nativo.

import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { foldStatus } from '../util/text.js';

export const AGENTES = ['claude', 'antigravity', 'codex', 'cursor', 'opencode'];

// Alias mantido para consumidores antigos: todos têm executor Node.
export function usaExecutorSh(agent) { return AGENTES.includes(agent); }

// esforço aceito em PT ou EN → nível do CLI (`claude --effort <nível>`)
export const ESFORCO_CLI = {
  baixo: 'low',
  low: 'low',
  medio: 'medium',
  medium: 'medium',
  alto: 'high',
  high: 'high',
  xalto: 'xhigh',
  xhigh: 'xhigh',
  max: 'max',
  maximo: 'max',
};

export function normalizarEsforco(raw) {
  if (!raw) return null;
  return ESFORCO_CLI[foldStatus(String(raw)).replace(/[\s_-]/g, '')] || null;
}

// O adapter valida esforço contra o catálogo real na hora de executar.
export function esforcoParaAgente(esforcoCli) { return esforcoCli; }

function normFile(f) {
  return f.split('\\').join('/').replace(/^\.\//, '');
}

// ── cálculo ────────────────────────────────────────────────────────────────

export function montarPlano(project, featureName, opts = {}) {
  const agent = AGENTES.includes(opts.agent) ? opts.agent : 'claude';
  const feature = project.features.find((f) => f.name === featureName);
  if (!feature) return { erro: `feature "${featureName}" não encontrada em ${project.config.specDir}/features/` };
  if (!feature.tasks || !feature.tasks.tasks.length) {
    return { erro: `feature "${featureName}" não tem tarefas em tasks.md — escreva as tarefas (T-xxx) primeiro` };
  }

  const cfg = project.config.paralelo;
  const avisos = [];

  // escolha explícita do usuário para o plano INTEIRO (--modelo/--esforco):
  // vence tasks.md e config — é assim que quem tem licença apertada trava o
  // gasto de tokens sem editar arquivo nenhum
  let esforcoForcado = null;
  if (opts.esforco != null) {
    esforcoForcado = normalizarEsforco(opts.esforco);
    if (!esforcoForcado) {
      return { erro: `--esforco "${opts.esforco}" desconhecido (aceitos: baixo|medio|alto|xalto|max)` };
    }
  }
  const modeloForcado = opts.modelo || null;
  // título dos critérios de aceite, para dar contexto humano nos prompts
  const acTitulo = {};
  for (const f of project.features) {
    if (!f.spec) continue;
    for (const s of f.spec.stories) for (const ac of s.acs) acTitulo[ac.id] = ac.title || '';
  }

  const concluidas = [];
  const pendentes = [];
  for (const t of feature.tasks.tasks) {
    if (t.status === 'concluida') {
      concluidas.push(t);
      continue;
    }
    if (t.status === 'em-andamento') {
      avisos.push(`${t.id} está [em-andamento] — entrou no plano; se já houver trabalho local, commite antes de executar`);
    }
    const esforcoRaw = esforcoForcado || t.esforco || cfg.esforco;
    const esforcoCli = normalizarEsforco(esforcoRaw);
    if (!esforcoCli) {
      avisos.push(`${t.id}: esforço "${esforcoRaw}" desconhecido — usando "medium" (aceitos: baixo|medio|alto|xalto|max)`);
    }
    const model = modeloForcado || t.model || cfg.model || null;
    pendentes.push({
      ...t,
      files: t.files.map(normFile),
      model,
      esforcoCli: esforcoParaAgente(esforcoCli || 'medium', agent),
      acs: t.refs.filter((r) => r.startsWith('AC-')),
    });
  }

  if (!pendentes.length) {
    return { erro: `todas as tarefas de "${featureName}" já estão [concluida] — nada a planejar` };
  }

  // modo sequencial (escolha do usuário): nada de faixas nem worktrees —
  // TODAS as tarefas rodam uma após a outra, na árvore principal, na ordem
  // do tasks.md; a disciplina de commits e o gate continuam os mesmos
  if (opts.sequencial) {
    pendentes.sort((a, b) => a.line - b.line);
    return fecharPlano(project, featureName, {
      agent,
      opts,
      cfg,
      avisos,
      acTitulo,
      concluidas,
      modo: 'sequencial',
      faixas: [],
      ondas: [],
      sequenciais: pendentes,
      modeloForcado,
      esforcoForcado,
    });
  }

  // seleção do usuário (--paralelizar T-001,T-003): só as escolhidas
  // concorrem às faixas; as demais rodam ao final, uma a uma, na árvore
  // principal — mesma disciplina de commits e mesmo gate
  let selecao = null;
  if (Array.isArray(opts.paralelizar)) {
    selecao = [...new Set(opts.paralelizar)];
    if (!selecao.length) {
      return { erro: 'seleção vazia em --paralelizar — para rodar tudo uma após a outra, use --sequencial' };
    }
    const ids = new Set(pendentes.map((t) => t.id));
    const desconhecidas = selecao.filter((id) => !ids.has(id));
    if (desconhecidas.length) {
      return {
        erro: `--paralelizar cita tarefa(s) que não estão pendentes em "${featureName}": ${desconhecidas.join(', ')}`,
      };
    }
  }

  // agrupa por conflito de arquivos: componentes conexos viram faixas
  const escolhida = (t) => !selecao || selecao.includes(t.id);
  const comArquivos = pendentes.filter((t) => t.files.length && escolhida(t));
  const sequenciais = pendentes.filter((t) => !t.files.length || !escolhida(t));
  for (const t of sequenciais) {
    if (!t.files.length) {
      t.motivoSeq = 'sem `Arquivos:` — pegada desconhecida';
      avisos.push(`${t.id} não lista Arquivos: — pegada desconhecida, vai rodar sozinha ao final (sem paralelismo)`);
    } else {
      t.motivoSeq = 'fora da seleção do usuário';
    }
  }

  // Union-find + índice de arquivo: evita comparar cada tarefa a todas as faixas.
  const parents = comArquivos.map((_, i) => i);
  const find = (i) => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  const owners = new Map();
  comArquivos.forEach((t, i) => {
    for (const file of t.files) {
      if (owners.has(file)) parents[find(i)] = find(owners.get(file));
      else owners.set(file, i);
    }
  });
  const groups = new Map();
  comArquivos.forEach((t, i) => {
    const key = find(i);
    if (!groups.has(key)) groups.set(key, { tasks: [], fileSet: new Set() });
    const group = groups.get(key);
    group.tasks.push(t);
    t.files.forEach((f) => group.fileSet.add(f));
  });
  const faixas = [...groups.values()];
  // ordem estável: pela primeira tarefa (ordem do tasks.md)
  faixas.sort((a, b) => a.tasks[0].line - b.tasks[0].line);
  for (const fx of faixas) fx.tasks.sort((a, b) => a.line - b.line);

  const repoName = path.basename(project.config.rootDir);
  faixas.forEach((fx, i) => {
    fx.id = `faixa-${i + 1}`;
    fx.branch = `spec/${featureName}-faixa-${i + 1}`;
    fx.worktree = `../onp-worktrees/${repoName}-${featureName}-faixa-${i + 1}`;
  });

  // ondas: no máximo maxParalelas faixas simultâneas
  const max = Math.max(1, cfg.maxParalelas | 0 || 3);
  const ondas = [];
  for (let i = 0; i < faixas.length; i += max) ondas.push(faixas.slice(i, i + max));

  return fecharPlano(project, featureName, {
    agent,
    opts,
    cfg,
    avisos,
    acTitulo,
    concluidas,
    modo: 'paralelo',
    faixas,
    ondas,
    sequenciais,
    paralelizar: selecao,
    modeloForcado,
    esforcoForcado,
  });
}

// campos comuns aos dois modos (paralelo e sequencial)
function fecharPlano(project, featureName, { agent, opts, cfg, avisos, acTitulo, concluidas, modo, faixas, ondas, sequenciais, paralelizar = null, modeloForcado = null, esforcoForcado = null }) {
  const repoName = path.basename(project.config.rootDir);
  // como invocar o motor a partir da raiz do projeto
  let engine = opts.enginePath || 'onp-spec';
  if (path.isAbsolute(engine)) {
    const rel = path.relative(project.config.rootDir, engine);
    if (!rel.startsWith('..')) engine = rel.split(path.sep).join('/');
  }

  const runId = opts.runId || `${repoName.replace(/[^a-zA-Z0-9_.-]/g, '-')}-${featureName}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const key = createHash('sha256').update(runId).digest('hex').slice(0, 12);
  for (const lane of faixas) {
    lane.branch = `spec/${featureName}-${lane.id}-${key}`;
    lane.worktree = `../onp-worktrees/${repoName}-${featureName}-${lane.id}-${key}`;
  }
  return {
    agent,
    modo,
    feature: featureName,
    // identidade desta execução no ledger global (muda a cada plano gerado)
    runId,
    specDir: project.config.specDir,
    baseDir: `${project.config.specDir}/features/${featureName}`,
    branchTrabalho: `spec/${featureName}`,
    repoName,
    testCommand: project.config.testCommand || null,
    cfg,
    engine,
    acTitulo,
    faixas,
    ondas,
    sequenciais,
    paralelizar,
    modeloForcado,
    esforcoForcado,
    concluidas,
    avisos,
    createdAt: (opts.now || new Date()).toISOString(),
    geradoEm: (opts.now || new Date()).toISOString().slice(0, 16).replace('T', ' '),
  };
}

// ── prompts ────────────────────────────────────────────────────────────────

function linhasRegras(plan) {
  const teste = plan.testCommand
    ? `Rode os testes localmente com \`${plan.testCommand}\` até passarem.`
    : 'Rode os testes do projeto localmente até passarem.';
  return [
    'Regras inegociáveis:',
    '- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.',
    '- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.',
    `- ${teste}`,
    '- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.',
    '- Specs, PRDs, ADRs, TDDs e documentos existentes são somente leitura. Nunca reformate, migre ou sobrescreva esses arquivos; mudanças de requisito exigem uma proposta separada e resposta do cliente.',
    '- Leia PRD, ADR, design.md e research.md quando existirem; pare e solicite decisão nativa se houver conflito de domínio/requisito/decisão. Nunca decida conflitos em headless.',
    '- Ao retomar após limite, inspecione git diff/log e continue o trabalho parcial sem repetir operações já concluídas.',
    '- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.',
  ];
}

function descreveTarefa(plan, t) {
  const acs = t.acs.map((id) => (plan.acTitulo[id] ? `${id} (${plan.acTitulo[id]})` : id));
  const refs = acs.length ? acs.join(', ') : t.refs.join(', ') || '—';
  const arquivos = t.files.length ? t.files.join(', ') : '(a definir pela tarefa)';
  return [
    `${t.id} — "${t.title}"`,
    `  critérios/refs: ${refs}`,
    `  arquivos permitidos (e seus testes): ${arquivos}`,
    `  mensagem de commit: "${t.id} ${plan.feature}: ${t.title}"`,
  ];
}

// prompt de UMA tarefa (script claude headless e tarefas sequenciais)
export function promptTarefa(plan, t) {
  return [
    `Você executa UMA tarefa da feature "${plan.feature}" (fluxo onp-spec, spec-anchored).`,
    `Leia primeiro: ${plan.baseDir}/spec.md, ${plan.baseDir}/tasks.md e ${plan.specDir || '.spec'}/constituicao.md.`,
    '',
    'Sua tarefa (somente ela):',
    ...descreveTarefa(plan, t),
    '',
    ...linhasRegras(plan),
  ].join('\n');
}

// prompt de uma FAIXA inteira (uma janela limpa executa as tarefas em ordem)
export function promptFaixa(plan, fx, { worktree = true } = {}) {
  const onde = worktree
    ? `Trabalhe SOMENTE dentro do worktree ${fx.worktree} (branch ${fx.branch}) — já preparado.`
    : 'Trabalhe na árvore principal do repositório.';
  return [
    `Você executa as tarefas da ${fx.id} da feature "${plan.feature}" (fluxo onp-spec, spec-anchored).`,
    onde,
    `Leia primeiro: ${plan.baseDir}/spec.md, ${plan.baseDir}/tasks.md e ${plan.specDir || '.spec'}/constituicao.md.`,
    '',
    `Execute NESTA ORDEM (1 tarefa = 1 commit):`,
    ...fx.tasks.flatMap((t) => descreveTarefa(plan, t)),
    '',
    ...linhasRegras(plan),
    'Quando a última tarefa estiver commitada, PARE e informe o resultado — a mesclagem é do orquestrador.',
  ].join('\n');
}

// ── artefato: plano.json (leitura de máquina — alimenta o ledger/resumo) ──

export function renderPlanoJson(plan) {
  const tarefa = (t) => ({
    id: t.id,
    titulo: t.title,
    modelo: t.model,
    esforco: t.esforcoCli,
    arquivos: t.files,
    refs: t.refs,
    prompt: promptTarefa(plan, t),
  });
  return `${JSON.stringify(
    {
      version: 2,
      engine: plan.engine,
      config: plan.cfg,
      testCommand: plan.testCommand,
      runId: plan.runId,
      feature: plan.feature,
      agent: plan.agent,
      modo: plan.modo,
      paralelizar: plan.paralelizar || null,
      modeloForcado: plan.modeloForcado || null,
      esforcoForcado: plan.esforcoForcado || null,
      geradoEm: plan.geradoEm,
      createdAt: plan.createdAt,
      branchTrabalho: plan.branchTrabalho,
      baseDir: plan.baseDir,
      artifactDir: plan.artifactDir || plan.baseDir,
      specDir: plan.specDir,
      repoName: plan.repoName,
      logsDir: `../onp-worktrees/${plan.repoName}-${plan.feature}-logs`,
      ondas: plan.ondas.map((onda) => onda.map((fx) => fx.id)),
      faixas: plan.faixas.map((fx) => ({
        id: fx.id,
        branch: fx.branch,
        worktree: fx.worktree,
        tarefas: fx.tasks.map(tarefa),
      })),
      sequenciais: plan.sequenciais.map(tarefa),
      concluidas: plan.concluidas.map((t) => t.id),
      avisos: plan.avisos,
    },
    null,
    2
  )}\n`;
}

// ── Artefatos: sem servidor, HTML ou chamadas de IA para resumir ───────────
export function renderPlanoMd(plan) {
  const lines = [
    `# Plano de execução: ${plan.feature}`, '',
    `Harness: **${plan.agent}** · modo: **${plan.modo}** · execução: ${plan.runId}`, '',
    'Use o plano/tarefas, perguntas, agentes, timers e notificações NATIVOS disponíveis nesta sessão.',
    'Confirme a seleção de tarefas e o custo quando ainda não autorizados. Modelos são resolvidos no catálogo atual do harness; nenhum nome é presumido.', '',
    '| faixa | tarefa | modelo solicitado | esforço | arquivos |', '|---|---|---|---|---|',
  ];
  for (const fx of [...plan.faixas, { id: 'sequencial', tasks: plan.sequenciais }]) {
    for (const t of fx.tasks) lines.push(`| ${fx.id} | ${t.id} — ${t.title} | ${t.model || 'padrão disponível do harness'} | ${t.esforcoCli} | ${t.files.join(', ')} |`);
  }
  lines.push('', '## Execução', '',
    `\`node ${plan.artifactDir || plan.baseDir}/executar-tarefas.mjs\``, '',
    'Opções: --listar, --faixa <id>, --seq <T-xxx>, --gate. Retomadas preservam commits, alterações parciais e sessões registradas.',
    'Cada faixa usa worktree e branch próprios; merge é serial e preserva conflitos para revisão. Tarefas só concluem com commit, árvore limpa e gate verificável.',
    'Antes de implementar, revise o impacto em PRDs, ADRs e domínios anteriores. Conflitos pendentes bloqueiam a execução até resposta explícita do cliente.',
    'A 5% ou menos restantes, o executor aguarda o reset e consulta a cota novamente. Sem telemetria inicial, exige uma ponte nativa antes de iniciar; após bloqueio, preserva a espera até leitura fresca. Nunca inventa um saldo.',
    'Progresso sai como eventos no terminal/ledger para o harness nativo. Notificações dependem da preferência do usuário e da capacidade disponível.', '',
    '## Encerramento', '',
    `Rode \`onp-spec verify ${plan.feature}\` e \`onp-spec audit --ci\`.`,
    `Pergunte com a ferramenta nativa se o usuário quer limpar os worktrees usados. Liste com \`onp-spec worktrees ${plan.feature}\`; remova somente após resposta afirmativa, com \`--limpar --confirmar\`.`,
    'Worktrees sujos, ativos ou não integrados são preservados. Não apague branches automaticamente.', '');
  return lines.join('\n');
}

export function renderPlanoMjs(plan) {
  const up = '../'.repeat((plan.artifactDir || plan.baseDir).split('/').length);
  return `#!/usr/bin/env node
// Gerado pelo onp-spec. Executor portátil; usa somente Node e o CLI nativo.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL(${JSON.stringify(up)}, import.meta.url));
const engine = path.resolve(root, ${JSON.stringify(plan.engine)});
const child = spawn(process.execPath, [engine, 'executar', ${JSON.stringify(plan.feature)}, ...process.argv.slice(2), '--run', ${JSON.stringify(plan.runId)}], { cwd: root, stdio: 'inherit', shell: false });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 2; });
child.on('exit', code => { process.exitCode = code ?? 1; });
`;
}

// Compatibilidade de invocação POSIX; toda lógica vive no executor Node.
export function renderPlanoSh() {
  return '#!/usr/bin/env sh\nexec node "$(dirname "$0")/executar-tarefas.mjs" "$@"\n';
}

export function renderPlanoHtml() {
  throw new Error('Painel HTML removido: use as ferramentas nativas do harness.');
}
