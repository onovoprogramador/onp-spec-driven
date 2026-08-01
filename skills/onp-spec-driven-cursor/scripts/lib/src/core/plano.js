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
// O CÁLCULO do plano é agnóstico de agente. Os ARTEFATOS variam:
//   claude      → plano-execucao.md + executar-tarefas.sh (claude -p headless,
//                 com --model e --effort por tarefa, e o resumo geral de
//                 andamento a cada 1 min no terminal) + plano-execucao.html
//                 (visual, somente leitura)
//   codex       → mesmos artefatos do claude, mas o executor roda
//                 `codex exec` headless (--json, --sandbox, --model e
//                 model_reasoning_effort por tarefa) — nunca depende do CLI
//                 do Claude
//   cursor      → mesmos artefatos do claude, mas o executor roda o CLI do
//                 Cursor (`agent -p`, legado `cursor-agent`) com
//                 --output-format stream-json e --force (sem --force o modo
//                 print não modifica arquivos); o Cursor não tem flag de
//                 esforço — esforço é sufixo do slug do modelo
//   antigravity → plano-execucao.md com comandos de worktree e um PROMPT
//                 pronto por faixa, para os agentes paralelos nativos do
//                 Antigravity (nunca depende de CLI nenhum)

import path from 'path';
import { foldStatus } from '../util/text.js';

export const AGENTES = ['claude', 'antigravity', 'codex', 'cursor'];

// agentes cujo plano gera executar-tarefas.sh + plano-execucao.html (CLI
// headless próprio); o antigravity executa com os agentes nativos dele
export function usaExecutorSh(agent) {
  return agent === 'claude' || agent === 'codex' || agent === 'cursor';
}

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

// defaults do codex quando a config ainda traz um modelo claude-* (a config
// tem defaults do claude; um modelo do outro CLI quebraria o codex exec)
const MODELO_CODEX = 'gpt-5.6-terra';
const RESUMO_MODEL_CODEX = 'gpt-5.6-luna';
const ehModeloClaude = (m) => /^claude-/.test(String(m || ''));

// no Cursor, modelos claude-* são slugs VÁLIDOS (o Cursor serve Claude, GPT,
// Gemini e os modelos da casa) — nada é trocado. Só o modelo do resumo por
// minuto muda quando ainda é o default claude-haiku-4-5 (não é slug do
// Cursor): entra o composer, modelo da casa com uso incluído nos planos.
const RESUMO_MODEL_CURSOR = 'composer';
const RESUMO_MODEL_DEFAULT = 'claude-haiku-4-5';

// o codex não tem nível "max" — o teto do model_reasoning_effort é xhigh
export function esforcoParaAgente(esforcoCli, agent) {
  if (agent === 'codex' && esforcoCli === 'max') return 'xhigh';
  return esforcoCli;
}

export function resumoModelParaAgente(cfg, agent) {
  const m = cfg.resumoModel || RESUMO_MODEL_DEFAULT;
  if (agent === 'codex' && ehModeloClaude(m)) return RESUMO_MODEL_CODEX;
  if (agent === 'cursor' && m === RESUMO_MODEL_DEFAULT) return RESUMO_MODEL_CURSOR;
  return m;
}

function intersecta(setA, arrB) {
  return arrB.some((f) => setA.has(f));
}

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
  if (modeloForcado && agent === 'codex' && ehModeloClaude(modeloForcado)) {
    return {
      erro: `--modelo "${modeloForcado}" é um modelo do Claude — este plano é do codex (use um modelo do Codex, ex.: gpt-5.6-terra, gpt-5.6-luna)`,
    };
  }

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
    let model = modeloForcado || t.model || cfg.model;
    if (agent === 'codex' && ehModeloClaude(model)) {
      if (t.model) avisos.push(`${t.id}: modelo "${model}" é do Claude — no codex vai rodar com "${MODELO_CODEX}"`);
      model = MODELO_CODEX;
    }
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

  const faixas = [];
  for (const t of comArquivos) {
    const donos = faixas.filter((fx) => intersecta(fx.fileSet, t.files));
    if (!donos.length) {
      faixas.push({ tasks: [t], fileSet: new Set(t.files) });
    } else {
      // conflita com 1+ faixas: funde todas na primeira e acrescenta a tarefa
      const alvo = donos[0];
      for (const outra of donos.slice(1)) {
        alvo.tasks.push(...outra.tasks);
        for (const f of outra.fileSet) alvo.fileSet.add(f);
        faixas.splice(faixas.indexOf(outra), 1);
      }
      alvo.tasks.push(t);
      for (const f of t.files) alvo.fileSet.add(f);
    }
  }
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

  return {
    agent,
    modo,
    feature: featureName,
    // identidade desta execução no ledger global (muda a cada plano gerado)
    runId: opts.runId || `${repoName}-${featureName}-${Date.now().toString(36)}`,
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
    `Leia primeiro: ${plan.baseDir}/spec.md, ${plan.baseDir}/tasks.md e .spec/constituicao.md.`,
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
    `Leia primeiro: ${plan.baseDir}/spec.md, ${plan.baseDir}/tasks.md e .spec/constituicao.md.`,
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
  });
  return `${JSON.stringify(
    {
      runId: plan.runId,
      feature: plan.feature,
      agent: plan.agent,
      modo: plan.modo,
      paralelizar: plan.paralelizar || null,
      modeloForcado: plan.modeloForcado || null,
      esforcoForcado: plan.esforcoForcado || null,
      geradoEm: plan.geradoEm,
      branchTrabalho: plan.branchTrabalho,
      baseDir: plan.baseDir,
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

// ── artefato: plano-execucao.md ────────────────────────────────────────────

function tabelaFaixa(plan, fx) {
  const linhas = [
    '| tarefa | título | modelo | esforço | arquivos |',
    '|---|---|---|---|---|',
  ];
  for (const t of fx.tasks) {
    linhas.push(`| ${t.id} | ${t.title} | \`${t.model}\` | ${t.esforcoCli} | ${t.files.map((f) => `\`${f}\``).join(', ') || '—'} |`);
  }
  return linhas;
}

// flags que reproduzem este plano (para o "regenere com" dos artefatos)
function flagsRegenerar(plan) {
  let flags = '';
  if (plan.modo === 'sequencial') flags += ' --sequencial';
  else if (plan.paralelizar) flags += ` --paralelizar ${plan.paralelizar.join(',')}`;
  if (plan.modeloForcado) flags += ` --modelo ${plan.modeloForcado}`;
  if (plan.esforcoForcado) flags += ` --esforco ${plan.esforcoForcado}`;
  return flags;
}

export function renderPlanoMd(plan) {
  const L = [];
  const paralelas = plan.faixas.reduce((n, fx) => n + fx.tasks.length, 0);
  const sequencial = plan.modo === 'sequencial';
  L.push(`# Plano de execução — ${plan.feature}`);
  L.push('');
  L.push(`> gerado por \`onp-spec plano\` em ${plan.geradoEm} — NÃO edite à mão;`);
  L.push(`> mudou tasks.md ou a config? Regenere: \`onp-spec plano ${plan.feature}${flagsRegenerar(plan)}\``);
  L.push('');
  L.push('## Resumo — o que vai acontecer');
  L.push('');
  if (sequencial) {
    L.push(`- **modo SEQUENCIAL (escolha do usuário)**: ${plan.sequenciais.length} tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal${plan.concluidas.length ? ` (${plan.concluidas.length} já concluída(s): ${plan.concluidas.map((t) => t.id).join(', ')})` : ''}`);
    L.push('- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md');
  } else {
    L.push(`- **${paralelas + plan.sequenciais.length} tarefa(s) pendente(s)**: ${paralelas} em ${plan.faixas.length} faixa(s) paralela(s) + ${plan.sequenciais.length} sequencial(is)${plan.concluidas.length ? ` (${plan.concluidas.length} já concluída(s): ${plan.concluidas.map((t) => t.id).join(', ')})` : ''}`);
    if (plan.paralelizar) {
      L.push(`- **seleção do usuário**: paralelizar só ${plan.paralelizar.join(', ')} — as demais rodam uma após a outra, ao final`);
    }
    L.push(`- **1 faixa = 1 worktree + 1 branch + 1 janela de contexto limpa** — faixas não compartilham nenhum arquivo entre si`);
    L.push(`- prefere outra seleção ou uma após a outra? Regenere com \`onp-spec plano ${plan.feature} --paralelizar T-xxx,T-yyy\` ou \`--sequencial\``);
  }
  if (plan.modeloForcado || plan.esforcoForcado) {
    const partes = [];
    if (plan.modeloForcado) partes.push(`modelo \`${plan.modeloForcado}\``);
    if (plan.esforcoForcado) partes.push(`esforço \`${plan.esforcoForcado}\``);
    L.push(`- **custo travado pelo usuário**: ${partes.join(' · ')} em TODAS as tarefas (vence tasks.md e config)`);
  }
  L.push(`- tudo acontece na branch de trabalho \`${plan.branchTrabalho}\`; levar para a main é decisão sua`);
  if (plan.avisos.length) {
    L.push('');
    L.push('### Avisos');
    L.push('');
    for (const a of plan.avisos) L.push(`- ⚠ ${a}`);
  }
  L.push('');
  if (!sequencial) {
    L.push('## Faixas e ondas');
    L.push('');
    plan.ondas.forEach((onda, i) => {
      L.push(`### Onda ${i + 1} — ${onda.map((fx) => fx.id).join(' ∥ ')}`);
      L.push('');
      for (const fx of onda) {
        L.push(`#### ${fx.id} — branch \`${fx.branch}\` — worktree \`${fx.worktree}\``);
        L.push('');
        L.push(...tabelaFaixa(plan, fx));
        L.push('');
      }
    });
  }
  if (plan.sequenciais.length) {
    L.push(sequencial ? '## Ordem de execução (uma tarefa após a outra)' : '## Tarefas sequenciais (após as ondas, na árvore principal)');
    L.push('');
    L.push(`| tarefa | título | modelo | esforço |${sequencial ? '' : ' por que sequencial |'}`);
    L.push(`|---|---|---|---|${sequencial ? '' : '---|'}`);
    for (const t of plan.sequenciais) {
      L.push(`| ${t.id} | ${t.title} | \`${t.model}\` | ${t.esforcoCli} |${sequencial ? '' : ` ${t.motivoSeq || '—'} |`}`);
    }
    L.push('');
  }
  L.push('## Gestão de branches e commits');
  L.push('');
  L.push(`1. branch de trabalho \`${plan.branchTrabalho}\` criada do ponto atual (se ainda não existir)`);
  if (sequencial) {
    L.push('2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito');
    L.push(`3. gate final na branch de trabalho: \`onp-spec verify ${plan.feature}\` + \`onp-spec audit --ci\` — **exit 0 ou não está pronto**`);
  } else {
    L.push('2. cada faixa nasce dela como branch própria e roda no seu worktree — **1 tarefa = 1 commit** (`T-xxx feature: título`)');
    L.push('3. terminou a onda → merge `--no-ff` de cada faixa de volta, na ordem; conflito interrompe a faixa e pede resolução humana');
    L.push('4. faixa mesclada → worktree removido, branch apagada, tarefa marcada `[concluida]` no tasks.md');
    L.push(`5. gate final na branch de trabalho: \`onp-spec verify ${plan.feature}\` + \`onp-spec audit --ci\` — **exit 0 ou não está pronto**`);
  }
  L.push('');
  L.push('## Como executar');
  L.push('');
  if (usaExecutorSh(plan.agent)) {
    const codex = plan.agent === 'codex';
    const cursor = plan.agent === 'cursor';
    const cliTarefa = codex ? '`codex exec`' : cursor ? '`agent -p` (CLI do Cursor)' : '`claude -p`';
    const ajustes = codex
      ? `\`--model\` e \`model_reasoning_effort\` já definidos por tarefa e sandbox \`${plan.cfg.sandbox}\``
      : cursor
        ? '`--model` já definido por tarefa e `--force` (sem ele o modo print do Cursor não modifica arquivos)'
        : `\`--model\` e \`--effort\` já definidos por tarefa e permissões \`${plan.cfg.permissionMode}\``;
    L.push(
      codex
        ? '### ▶ Execução — Codex headless (codex exec)'
        : cursor
          ? '### ▶ Execução — Cursor headless (agent CLI)'
          : '### ▶ Execução — Claude Code headless'
    );
    L.push('');
    L.push('```bash');
    L.push(`bash ${plan.baseDir}/executar-tarefas.sh`);
    L.push('```');
    L.push('');
    if (sequencial) {
      L.push(`Cada tarefa roda ${cliTarefa} com **janela de contexto limpa**, na árvore principal,`);
      L.push(`uma após a outra, com ${ajustes}.`);
      L.push('Os prompts exatos estão embutidos no script.');
    } else {
      L.push(`Cada faixa roda ${cliTarefa} com **janela de contexto limpa**, no seu worktree, com`);
      L.push(`${ajustes}. Os prompts exatos estão`);
      L.push('embutidos no script — quer rodar uma faixa na mão, é só copiá-los de lá.');
    }
    L.push(`Logs: \`../onp-worktrees/${plan.repoName}-${plan.feature}-logs/\`.`);
    if (codex) {
      L.push('');
      L.push('**Confirmação de custos — antes de executar**: os modelos e esforços por');
      L.push('tarefa estão nas tabelas acima; o agente CONFIRMA com o usuário se estão');
      L.push('dentro da licença/cota dele (modelo forte + esforço alto torra tokens).');
      L.push(`Para gastar menos: \`onp-spec plano ${plan.feature} --modelo gpt-5.6-luna --esforco baixo\``);
      L.push(`(tudo) ou por tarefa \`onp-spec tarefa ${plan.feature} T-xxx --modelo <m> --esforco <nível>\` — e regenere o plano.`);
    }
    if (cursor) {
      L.push('');
      L.push('**Confirmação de custos — antes de executar**: os modelos por tarefa estão');
      L.push('nas tabelas acima; o agente CONFIRMA com o usuário se estão dentro do plano');
      L.push('dele no Cursor (modelos claude-*/gpt-* são cobrados por uso; `composer` tem');
      L.push(`uso incluído nos planos pagos). Para gastar menos: \`onp-spec plano ${plan.feature} --modelo composer\``);
      L.push(`(tudo) ou por tarefa \`onp-spec tarefa ${plan.feature} T-xxx --modelo <m>\` — e regenere o plano.`);
      L.push('');
      L.push('**Esforço no Cursor**: o CLI não tem flag de esforço — o nível vai embutido');
      L.push('no slug do modelo (ex.: `gpt-5.6-terra-high`). A coluna "esforço" acima é');
      L.push('informativa e NÃO vira flag; para controlar o esforço, escolha o slug.');
    }
    L.push('');
    L.push('### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)');
    L.push('');
    L.push('O script roda em **background**: o agente AVISA o usuário antes de iniciar e,');
    L.push('enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual');
    L.push('tarefa está rodando, qual não está, o que concluiu/falhou) junto com o');
    L.push('**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao');
    L.push('final, o usuário recebe o resumo completo da execução. A qualquer momento:');
    L.push('');
    L.push('```bash');
    L.push(`onp-spec resumo ${plan.feature} --tabela   # a tabela de andamento`);
    L.push(`onp-spec resumo ${plan.feature}            # o resumo em texto`);
    L.push('```');
  } else if (sequencial) {
    L.push('### ▶ Sequencial no Antigravity (uma tarefa após a outra, sem Claude CLI)');
    L.push('');
    L.push('1. **Entre na branch de trabalho** (terminal, na raiz do repositório):');
    L.push('');
    L.push('```bash');
    L.push(`git checkout -b ${plan.branchTrabalho}   # ou: git checkout ${plan.branchTrabalho}`);
    L.push('```');
    L.push('');
    L.push('2. **Execute as tarefas NA ORDEM, uma após a outra** (janela limpa por tarefa');
    L.push('   ajuda o foco; a próxima só começa quando a anterior commitou):');
    L.push('');
    for (const t of plan.sequenciais) {
      L.push(`#### Prompt — ${t.id}`);
      L.push('');
      L.push('```');
      L.push(promptTarefa(plan, t));
      L.push('```');
      L.push('');
      L.push(`\`node ${plan.engine} tarefa ${plan.feature} ${t.id} concluida\` após o commit.`);
      L.push('');
    }
    L.push('3. **Gate final** (exit 0 ou não está pronto):');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} verify ${plan.feature}`);
    L.push(`node ${plan.engine} audit --ci`);
    L.push('```');
    L.push('');
    L.push('4. **Acompanhamento (a cada ~1 min, enquanto executa)**: avise ANTES de começar');
    L.push('   que o trabalho roda em background e que o resumo completo vem ao final. Marque');
    L.push('   cada tarefa no ledger ao começar e ao terminar (é disso que a tabela é feita):');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} evento --run ${plan.runId} --tipo tarefa --tarefa <T-xxx> --faixa seq --estado executando   # ao começar`);
    L.push(`node ${plan.engine} evento --run ${plan.runId} --tipo tarefa --tarefa <T-xxx> --faixa seq --estado concluida    # após o commit`);
    L.push('```');
    L.push('');
    L.push('   E a cada ~1 min poste no chat a TABELA de andamento + um parágrafo curto,');
    L.push('   registrando o texto no ledger:');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} resumo ${plan.feature} --tabela   # a tabela — cole no chat`);
    L.push(`node ${plan.engine} resumo ${plan.feature} --gravar --origem ia --texto "<2 a 4 frases do que está rolando>"`);
    L.push('```');
  } else {
    L.push('### ▶ Paralelo nativo no Antigravity (janelas limpas, sem Claude CLI)');
    L.push('');
    L.push('1. **Prepare a branch de trabalho e os worktrees** (terminal, na raiz do repositório):');
    L.push('');
    L.push('```bash');
    L.push(`git checkout -b ${plan.branchTrabalho}   # ou: git checkout ${plan.branchTrabalho}`);
    for (const fx of plan.faixas) {
      L.push(`git worktree add ${fx.worktree} -b ${fx.branch}`);
    }
    L.push('```');
    L.push('');
    L.push('2. **Abra um agente NOVO por faixa** (janela limpa) e cole o prompt da faixa:');
    L.push('');
    for (const fx of plan.faixas) {
      L.push(`#### Prompt — ${fx.id}`);
      L.push('');
      L.push('```');
      L.push(promptFaixa(plan, fx));
      L.push('```');
      L.push('');
    }
    L.push('3. **Todas terminaram? Mescle na ordem e marque as tarefas** (na árvore principal):');
    L.push('');
    L.push('```bash');
    for (const fx of plan.faixas) {
      L.push(`git merge --no-ff ${fx.branch} -m "merge ${fx.id} (${plan.feature})"`);
      L.push(`git worktree remove ${fx.worktree} && git branch -d ${fx.branch}`);
      for (const t of fx.tasks) L.push(`node ${plan.engine} tarefa ${plan.feature} ${t.id} concluida`);
    }
    L.push('```');
    if (plan.sequenciais.length) {
      L.push('');
      L.push('4. **Tarefas sequenciais** — execute você mesmo (mesma janela ou nova), uma a uma:');
      L.push('');
      for (const t of plan.sequenciais) {
        L.push('```');
        L.push(promptTarefa(plan, t));
        L.push('```');
        L.push('');
        L.push(`\`node ${plan.engine} tarefa ${plan.feature} ${t.id} concluida\` após o commit.`);
        L.push('');
      }
    }
    L.push('');
    L.push('5. **Gate final** (exit 0 ou não está pronto):');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} verify ${plan.feature}`);
    L.push(`node ${plan.engine} audit --ci`);
    L.push('```');
    L.push('');
    L.push('6. **Acompanhamento (a cada ~1 min, enquanto os agentes trabalham)**: avise ANTES');
    L.push('   de despachar os agentes que o trabalho roda em background e que o resumo');
    L.push('   completo vem ao final. Marque cada tarefa no ledger quando um agente começa');
    L.push('   e quando termina (é disso que a tabela é feita):');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} evento --run ${plan.runId} --tipo tarefa --tarefa <T-xxx> --faixa <faixa-N> --estado executando`);
    L.push(`node ${plan.engine} evento --run ${plan.runId} --tipo tarefa --tarefa <T-xxx> --faixa <faixa-N> --estado concluida`);
    L.push('```');
    L.push('');
    L.push('   E a cada ~1 min poste no chat a TABELA de andamento + um parágrafo curto,');
    L.push('   registrando o texto no ledger:');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} resumo ${plan.feature} --tabela   # a tabela — cole no chat`);
    L.push(`node ${plan.engine} resumo ${plan.feature} --gravar --origem ia --texto "<2 a 4 frases do que está rolando>"`);
    L.push('```');
  }
  L.push('');
  return `${L.join('\n')}\n`;
}
// ── artefato: executar-tarefas.sh (claude e codex) ─────────────────────────
//
// O script é um DISPATCHER, não um roteiro linear: cada faixa e cada tarefa
// sequencial viram funções, então dá para reexecutar só o que falhou.
//
//   bash executar-tarefas.sh                  → tudo (ondas → sequenciais → gate)
//   bash executar-tarefas.sh --faixa faixa-2  → só essa faixa (+ merge + gate)
//   bash executar-tarefas.sh --seq T-004      → só essa tarefa sequencial
//   bash executar-tarefas.sh --gate           → só verify + audit
//   bash executar-tarefas.sh --listar         → o que existe para executar
//
// Cada tarefa roda o CLI headless do agente com saída em JSONL:
//   claude → `claude -p --output-format stream-json --verbose`
//   codex  → `codex exec --json` (sandbox + --add-dir para o .git
//            compartilhado dos worktrees)
// O JSONL cru vai para o stream da tarefa no ledger global (ferramentas,
// raciocínio, saídas, custo) — é de lá que o resumo tira a "última ação".

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function allowedTools(plan) {
  if (plan.cfg.allowedTools) return plan.cfg.allowedTools;
  const base = ['Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)'];
  if (plan.testCommand) base.push(`Bash(${plan.testCommand.split(/\s+/)[0]}:*)`);
  return base.join(',');
}

// nome de função bash a partir do id da faixa (faixa-1 → faixa_1)
const fn = (id) => id.replace(/-/g, '_');

export function renderPlanoSh(plan) {
  const L = [];
  const P = (...linhas) => L.push(...linhas);

  P('#!/usr/bin/env bash');
  P(`# executar-tarefas.sh — gerado por \`onp-spec plano ${plan.feature}\` em ${plan.geradoEm}`);
  P('# NÃO edite à mão: mudou tasks.md ou a config, regenere o plano.');
  P('#');
  P('# uso:');
  P('#   bash executar-tarefas.sh                  tudo (ondas → sequenciais → gate)');
  P('#   bash executar-tarefas.sh --faixa <id>     reexecuta UMA faixa (+ merge + gate)');
  P('#   bash executar-tarefas.sh --seq <T-xxx>    reexecuta UMA tarefa sequencial');
  P('#   bash executar-tarefas.sh --gate           só o gate (verify + audit)');
  P('#   bash executar-tarefas.sh --listar         mostra faixas, tarefas e estados');
  P('#   (acrescente --sem-gate para não rodar o gate ao final)');
  P('#');
  P(`# resumo do que está rolando, a qualquer momento: onp-spec resumo ${plan.feature}`);
  P('set -u');
  P('set -o pipefail');
  P('');
  const codex = plan.agent === 'codex';
  const cursor = plan.agent === 'cursor';
  P(`RUN_ID=${shq(plan.runId)}`);
  P(`FEATURE=${shq(plan.feature)}`);
  P(`BASE_BRANCH=${shq(plan.branchTrabalho)}`);
  P(`ENGINE=${shq(plan.engine)}`);
  if (codex) {
    P(`CODEX_FLAGS=(--sandbox ${shq(plan.cfg.sandbox || 'workspace-write')})`);
    P('STREAM_FLAGS=(--json)');
  } else if (cursor) {
    P('# --force: sem ele o modo print do Cursor só propõe alterações (não escreve).');
    P('# Controle fino é do usuário: permissions.deny em .cursor/cli.json VENCE o --force.');
    P('CURSOR_FLAGS=(--force)');
    P('STREAM_FLAGS=(--output-format stream-json)');
  } else {
    P(`CLAUDE_FLAGS=(--permission-mode ${plan.cfg.permissionMode} --allowedTools ${shq(allowedTools(plan))})`);
    P('STREAM_FLAGS=(--output-format stream-json --verbose)');
  }
  P('FALHAS=""');
  P('COM_GATE=1');
  P(`RESUMO_MODEL=${shq(resumoModelParaAgente(plan.cfg, plan.agent))}`);
  P('RESUMO_PID=""');
  P('');
  P(`verde()    { printf '\\033[32m%s\\033[0m\\n' "$*"; }`);
  P(`vermelho() { printf '\\033[31m%s\\033[0m\\n' "$*"; }`);
  P(`amarelo()  { printf '\\033[33m%s\\033[0m\\n' "$*"; }`);
  P(`info()     { printf '· %s\\n' "$*"; }`);
  P('falhar()   { vermelho "✘ $*"; exit 1; }');
  P('');
  P('# eventos vão para o ledger GLOBAL (~/.onp-spec/painel/ledger.jsonl):');
  P('# um arquivo para todos os projetos, é o que o onp-spec resumo lê');
  P('evento() { node "$ENGINE" evento --run "$RUN_ID" "$@" >/dev/null 2>&1 || true; }');
  P('');
  P('# ── ambiente (todos os modos passam por aqui) ────────────────────────');
  P('preparar_ambiente() {');
  P('  command -v git >/dev/null 2>&1 || falhar "git não encontrado"');
  P('  command -v node >/dev/null 2>&1 || falhar "node não encontrado"');
  if (codex) {
    P('  command -v codex >/dev/null 2>&1 || falhar "Codex CLI (codex) não encontrado — instale-o ou siga o modo manual em plano-execucao.md"');
  } else if (cursor) {
    P('  # binário atual do CLI do Cursor é `agent`; `cursor-agent` é o nome legado');
    P('  CURSOR_BIN=$(command -v agent || command -v cursor-agent) || falhar "CLI do Cursor (agent) não encontrado — instale: curl https://cursor.com/install -fsS | bash"');
  } else {
    P('  command -v claude >/dev/null 2>&1 || falhar "Claude Code CLI (claude) não encontrado — instale-o ou siga o modo manual em plano-execucao.md"');
  }
  P('  TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || falhar "fora de um repositório git"');
  P('  cd "$TOPLEVEL" || exit 1');
  P('  # artefatos recém-gerados pelo `onp-spec plano` são sujeira esperada:');
  P('  # se forem a ÚNICA sujeira, o script mesmo commita; qualquer outra, aborta');
  P('  if [ -n "$(git status --porcelain)" ]; then');
  P(`    if [ -z "$(git status --porcelain | grep -v -e 'plano-execucao\\.' -e 'plano\\.json' -e 'executar-tarefas\\.sh')" ]; then`);
  P('      git add -A');
  P('      git commit -q -m "plano de execução: $FEATURE (artefatos gerados)"');
  P('      info "artefatos do plano commitados"');
  P('    else');
  P('      falhar "árvore suja além dos artefatos do plano — commite ou faça git stash antes (os worktrees partem do último commit)"');
  P('    fi');
  P('  fi');
  P(`  git ls-files --error-unmatch -- ${shq(`${plan.baseDir}/spec.md`)} >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"`);
  P('  ATUAL=$(git rev-parse --abbrev-ref HEAD)');
  P('  [ "$ATUAL" != "HEAD" ] || falhar "HEAD destacado — troque para uma branch"');
  P('  if [ "$ATUAL" != "$BASE_BRANCH" ]; then');
  P('    if git show-ref --verify --quiet "refs/heads/$BASE_BRANCH"; then');
  P('      git checkout -q "$BASE_BRANCH" || falhar "não consegui trocar para $BASE_BRANCH"');
  P('    else');
  P('      git checkout -q -b "$BASE_BRANCH" || falhar "não consegui criar $BASE_BRANCH"');
  P('    fi');
  P('    info "branch de trabalho: $BASE_BRANCH (a partir de $ATUAL)"');
  P('  fi');
  P('  git worktree prune');
  P(`  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/${plan.repoName}-${plan.feature}-logs"`);
  P(`  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/${plan.repoName}-${plan.feature}"`);
  P('  STREAMS_DIR="${ONP_SPEC_HOME:-$HOME/.onp-spec}/painel/streams/$RUN_ID"');
  P('  mkdir -p "$LOG_DIR" "$STREAMS_DIR"');
  P('}');
  P('');
  P('# worktree limpo mesmo depois de uma tentativa que falhou');
  P('preparar_worktree() { # $1=faixa $2=branch $3=worktree');
  P('  git worktree prune');
  P('  if [ -e "$3" ]; then git worktree remove --force "$3" >/dev/null 2>&1; rm -rf "$3"; fi');
  P('  if git show-ref --verify --quiet "refs/heads/$2"; then git branch -D "$2" >/dev/null 2>&1; fi');
  P('  git worktree add "$3" -b "$2" >/dev/null 2>&1 || { vermelho "✘ não consegui criar o worktree de $1 em $3"; return 1; }');
  P('}');
  P('');
  P('tentativa() { # $1=faixa — conta reexecuções (vai para o ledger)');
  P('  local arq="$LOG_DIR/.tentativa-$1"');
  P('  local n=1');
  P('  [ -f "$arq" ] && n=$(( $(cat "$arq") + 1 ))');
  P('  printf "%s" "$n" > "$arq"');
  P('  printf "%s" "$n"');
  P('}');
  P('');
  P(`# uma tarefa = uma sessão ${codex ? 'codex exec' : cursor ? 'agent (Cursor)' : 'claude'} headless com contexto limpo.`);
  P('# o JSONL da sessão vira o stream da tarefa no ledger');
  P('rodar_tarefa() { # $1=escopo(faixa|seq) $2=T-xxx $3=prompt $4=modelo $5=esforço');
  P('  local chave="$1--$2"');
  P('  local stream="$STREAMS_DIR/$chave.jsonl"');
  P('  evento --tipo tarefa --tarefa "$2" --faixa "$1" --estado executando --stream "$chave"');
  if (codex) {
    P('  info "$2 — codex exec ($4 · $5) · stream: $chave"');
    P('  # --add-dir: o .git compartilhado dos worktrees mora no repo principal —');
    P('  # sem ele o sandbox workspace-write bloquearia o commit da tarefa');
    P('  if codex exec "$3" --model "$4" -c model_reasoning_effort="$5" "${STREAM_FLAGS[@]}" "${CODEX_FLAGS[@]}" --add-dir "$TOPLEVEL" > "$stream" 2>>"$LOG_DIR/$1.log"; then');
  } else if (cursor) {
    P('  info "$2 — agent -p ($4) · stream: $chave"');
    P('  # $5 (esforço) não vira flag: o CLI do Cursor não tem reasoning effort —');
    P('  # o nível vai embutido no slug do modelo (ex.: gpt-5.6-terra-high)');
    P('  if "$CURSOR_BIN" -p "$3" --model "$4" "${STREAM_FLAGS[@]}" "${CURSOR_FLAGS[@]}" > "$stream" 2>>"$LOG_DIR/$1.log"; then');
  } else {
    P('  info "$2 — claude -p ($4 · $5) · stream: $chave"');
    P('  if claude -p "$3" --model "$4" --effort "$5" "${STREAM_FLAGS[@]}" "${CLAUDE_FLAGS[@]}" > "$stream" 2>>"$LOG_DIR/$1.log"; then');
  }
  P('    evento --tipo tarefa --tarefa "$2" --faixa "$1" --estado concluida --stream "$chave"');
  P('    node "$ENGINE" stream-resumo "$RUN_ID" "$chave" 2>/dev/null || true');
  P('    return 0');
  P('  fi');
  P('  evento --tipo tarefa --tarefa "$2" --faixa "$1" --estado falhou --stream "$chave"');
  P('  node "$ENGINE" stream-resumo "$RUN_ID" "$chave" 2>/dev/null || true');
  P('  return 1');
  P('}');
  P('');
  P('mesclar_faixa() { # $1=faixa $2=branch $3=worktree $4=exit-da-faixa');
  P('  if [ "$4" -ne 0 ]; then');
  P('    evento --tipo faixa --faixa "$1" --estado falhou');
  P('    vermelho "✘ $1 falhou (log: $LOG_DIR/$1.log) — worktree mantido para inspeção: $3"');
  P(`    amarelo "  reexecute só ela: bash ${plan.baseDir}/executar-tarefas.sh --faixa $1"`);
  P('    FALHAS="$FALHAS $1"; return 1');
  P('  fi');
  P('  evento --tipo faixa --faixa "$1" --estado mesclando');
  P('  if git merge --no-ff "$2" -m "merge $1 ($FEATURE)"; then');
  P('    git worktree remove --force "$3" >/dev/null 2>&1');
  P('    git branch -d "$2" >/dev/null 2>&1');
  P('    evento --tipo faixa --faixa "$1" --estado mesclada');
  P('    verde "✔ $1 mesclada em $BASE_BRANCH"');
  P('  else');
  P('    git merge --abort >/dev/null 2>&1');
  P('    evento --tipo faixa --faixa "$1" --estado conflito');
  P('    vermelho "✘ conflito ao mesclar $1 — resolva na mão: git merge $2 (worktree mantido: $3)"');
  P('    FALHAS="$FALHAS $1"; return 1');
  P('  fi');
  P('}');
  P('');
  P('marcar_concluidas() { # $@=T-xxx');
  P('  for t in "$@"; do node "$ENGINE" tarefa "$FEATURE" "$t" concluida >/dev/null || true; done');
  P('}');
  P('');
  P('# ── resumo geral de andamento: 1/min enquanto a execução roda ─────────');
  P(
    `# escrito por IA (${codex ? 'codex exec somente leitura' : cursor ? 'agent -p sem --force, somente leitura' : 'claude -p, sem ferramentas'}) com fallback do motor; vai`
  );
  P('# para o terminal e para o ledger — o agente repassa o texto no chat.');
  P('gerar_resumo() {');
  P('  local ctx ia');
  P('  ctx=$(node "$ENGINE" resumo "$FEATURE" --contexto 2>/dev/null) || ctx=""');
  P('  [ -n "$ctx" ] || return 0');
  P(
    `  ia=$(${codex ? 'codex exec' : cursor ? '"$CURSOR_BIN" -p' : 'claude -p'} "Você narra, para o dono do produto, uma execução de tarefas de código em andamento. Estado mecânico:`
  );
  P('');
  P('$ctx');
  P('');
  P(
    `Escreva o RESUMO GERAL DE ANDAMENTO: um parágrafo único de 2 a 4 frases, em português simples, dizendo o que está acontecendo agora, o que já terminou, o que falhou e se o usuário precisa agir. Sem markdown, sem listas." --model "$RESUMO_MODEL"${codex ? ' --sandbox read-only --ephemeral' : ''} 2>/dev/null)`
  );
  P('  if [ -n "$ia" ]; then');
  P('    node "$ENGINE" resumo "$FEATURE" --gravar --origem ia --texto "$ia" >/dev/null 2>&1 || true');
  P(`    printf '\\n📣 resumo (IA): %s\\n' "$ia"`);
  P('  else');
  P('    node "$ENGINE" resumo "$FEATURE" --gravar >/dev/null 2>&1 || true');
  P(`    printf '\\n📣 resumo: %s\\n' "$(node "$ENGINE" resumo "$FEATURE" 2>/dev/null)"`);
  P('  fi');
  P('}');
  P('');
  P('# mata o loop E o sleep filho — senão o sleep herda o stdout e quem chamou');
  P('# o script via pipe fica esperando EOF por até 60s depois do exit');
  P('parar_resumos() {');
  P('  [ -n "$RESUMO_PID" ] || return 0');
  P('  command -v pkill >/dev/null 2>&1 && pkill -P "$RESUMO_PID" 2>/dev/null');
  P('  kill "$RESUMO_PID" 2>/dev/null');
  P('  RESUMO_PID=""');
  P('}');
  P('');
  P('iniciar_resumos() {');
  P('  ( while :; do sleep 60; gerar_resumo; done ) &');
  P('  RESUMO_PID=$!');
  P('  # ao sair: para o loop e grava um último resumo (o estado final, do motor)');
  P(`  trap 'parar_resumos; node "$ENGINE" resumo "$FEATURE" --gravar >/dev/null 2>&1 || true' EXIT`);
  P('}');

  // ── uma função por faixa ────────────────────────────────────────────────
  for (const fx of plan.faixas) {
    const ids = fx.tasks.map((t) => t.id).join(' ');
    P('');
    P(`# ── ${fx.id}: ${ids} ──`);
    P(`executar_${fn(fx.id)}() {`);
    P(`  local WT="$WT_BASE-${fx.id}"`);
    P(`  preparar_worktree ${shq(fx.id)} ${shq(fx.branch)} "$WT" || return 1`);
    P(`  evento --tipo faixa --faixa ${shq(fx.id)} --estado executando --tentativa "$(tentativa ${shq(fx.id)})"`);
    P(`  : > "$LOG_DIR/${fx.id}.log"`);
    P('  (');
    P('    cd "$WT" || exit 9');
    fx.tasks.forEach((t, i) => {
      const cont = i < fx.tasks.length - 1 ? ' &&' : '';
      P(`    rodar_tarefa ${shq(fx.id)} ${shq(t.id)} ${shq(promptTarefa(plan, t))} ${shq(t.model)} ${t.esforcoCli}${cont}`);
    });
    P(`  ) >> "$LOG_DIR/${fx.id}.log" 2>&1`);
    P('  local st=$?');
    P(`  mesclar_faixa ${shq(fx.id)} ${shq(fx.branch)} "$WT" "$st" || return 1`);
    P(`  marcar_concluidas ${ids}`);
    P('  return 0');
    P('}');
  }

  // ── uma função por tarefa sequencial ────────────────────────────────────
  for (const t of plan.sequenciais) {
    P('');
    P(`# ── sequencial ${t.id} (${(t.motivoSeq || 'ordem do tasks.md').replace(/`/g, '')}) ──`);
    P(`executar_seq_${fn(t.id)}() {`);
    P(`  info ${shq(`sequencial ${t.id} — ${t.title}`)}`);
    P(`  if rodar_tarefa seq ${shq(t.id)} ${shq(promptTarefa(plan, t))} ${shq(t.model)} ${t.esforcoCli} >> "$LOG_DIR/seq.log" 2>&1; then`);
    P('    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)');
    P('    if [ -n "$(git status --porcelain)" ]; then');
    P(`      git add -A && git commit -q -m ${shq(`${t.id} ${plan.feature}: ${t.title} (auto-commit do plano)`)}`);
    P('    fi');
    P(`    marcar_concluidas ${t.id}`);
    P(`    verde "✔ ${t.id} concluída"`);
    P('    return 0');
    P('  fi');
    P(`  vermelho "✘ ${t.id} falhou (log: $LOG_DIR/seq.log)"`);
    P(`  amarelo "  reexecute só ela: bash ${plan.baseDir}/executar-tarefas.sh --seq ${t.id}"`);
    P(`  FALHAS="$FALHAS ${t.id}"`);
    P('  return 1');
    P('}');
  }

  // ── gate ────────────────────────────────────────────────────────────────
  P('');
  P('# ── gate: quem decide é a máquina ────────────────────────────────────');
  P('rodar_gate() {');
  P('  echo');
  P('  info "gate: verify + audit --ci"');
  P('  evento --tipo gate --etapa inicio');
  P('  node "$ENGINE" verify "$FEATURE"');
  P('  local v=$?');
  P('  evento --tipo gate --etapa verify --exit "$v"');
  P('  node "$ENGINE" audit --ci');
  P('  AUDIT=$?');
  P('  evento --tipo gate --etapa audit --exit "$AUDIT"');
  P('  # fecha a contabilidade: status das tarefas + prova do verify no git');
  P(`  if [ -n "$(git status --porcelain -- ${shq(plan.specDir)})" ]; then`);
  P(`    git add -A -- ${shq(plan.specDir)}`);
  P('    git commit -q -m "$FEATURE: status das tarefas + prova do verify (plano)"');
  P('    info "status das tarefas e prova do verify commitados"');
  P('  fi');
  P('  return "$AUDIT"');
  P('}');
  P('');
  P('encerrar() { # $1=escopo');
  P('  echo');
  P('  if [ -n "$FALHAS" ]; then vermelho "faixas/tarefas com falha:$FALHAS"; fi');
  P('  # sem gate não existe veredito: NUNCA anunciar alinhamento sem o audit');
  P('  if [ "$COM_GATE" -eq 0 ]; then');
  P('    evento --tipo fim --exit 1 --escopo "$1"');
  P('    if [ -z "$FALHAS" ]; then');
  P('      amarelo "○ trabalho de \'$1\' terminou SEM o gate (--sem-gate) — isto NÃO é prova de nada"');
  P(`      amarelo "  para o veredito: bash ${plan.baseDir}/executar-tarefas.sh --gate"`);
  P('      exit 0');
  P('    fi');
  P('    vermelho "e ainda há falhas — conserte e rode o gate"');
  P('    exit 1');
  P('  fi');
  P('  rodar_gate');
  P('  local audit=$?');
  P('  if [ "$audit" -eq 0 ] && [ -z "$FALHAS" ]; then');
  P('    evento --tipo fim --exit 0 --escopo "$1"');
  P('    verde "✔ plano concluído — especificação e código alinhados (audit exit 0) na branch $BASE_BRANCH"');
  P('    info "próximo passo: revise e leve para a main quando quiser (git merge $BASE_BRANCH)"');
  P('    exit 0');
  P('  fi');
  P('  evento --tipo fim --exit 1 --escopo "$1"');
  P('  vermelho "plano terminou com pendências — leia a saída do audit acima e os logs em $LOG_DIR"');
  P('  amarelo "dica: reexecute só o que falhou (--faixa <id> / --seq <T-xxx>)"');
  P('  exit 1');
  P('}');

  // ── modo: tudo ──────────────────────────────────────────────────────────
  P('');
  P('executar_tudo() {');
  P('  evento --tipo inicio --escopo tudo');
  P('  iniciar_resumos');
  P('  info "logs em: $LOG_DIR"');
  P('  info "resumo geral de andamento: a cada 1 min aqui no terminal (e via: onp-spec resumo)"');
  plan.ondas.forEach((onda, oi) => {
    P(`  # onda ${oi + 1}: ${onda.map((fx) => fx.id).join(' ∥ ')}`);
    P(`  info "onda ${oi + 1}: ${onda.map((fx) => fx.id).join(' ∥ ')} — janelas limpas em paralelo"`);
    for (const fx of onda) {
      P(`  executar_${fn(fx.id)} & PID_${fn(fx.id).toUpperCase()}=$!`);
    }
    for (const fx of onda) {
      P(`  wait "$PID_${fn(fx.id).toUpperCase()}" || true`);
    }
  });
  for (const t of plan.sequenciais) P(`  executar_seq_${fn(t.id)} || true`);
  P('  encerrar tudo');
  P('}');

  // ── dispatcher ──────────────────────────────────────────────────────────
  P('');
  P('listar() {');
  P(`  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"`);
  plan.ondas.forEach((onda, oi) => {
    for (const fx of onda) {
      P(`  echo "  ${fx.id}  onda ${oi + 1}  ${fx.tasks.map((t) => t.id).join(', ')}"`);
    }
  });
  for (const t of plan.sequenciais) P(`  echo "  seq       ${t.id} (sequencial)"`);
  P('  echo');
  P('  echo "reexecutar uma faixa:    --faixa <id>"');
  P('  echo "reexecutar sequencial:   --seq <T-xxx>"');
  P('  echo "só o gate:               --gate"');
  P('}');
  P('');
  P('MODO="tudo"');
  P('ALVO=""');
  P('while [ $# -gt 0 ]; do');
  P('  case "$1" in');
  P('    --listar) MODO="listar" ;;');
  P('    --gate) MODO="gate" ;;');
  P('    --sem-gate) COM_GATE=0 ;;');
  P('    --faixa) MODO="faixa"; ALVO="${2:-}"; shift ;;');
  P('    --seq) MODO="seq"; ALVO="${2:-}"; shift ;;');
  P('    -h|--help) sed -n "2,14p" "$0"; exit 0 ;;');
  P('    *) vermelho "argumento desconhecido: $1"; sed -n "2,14p" "$0"; exit 2 ;;');
  P('  esac');
  P('  shift');
  P('done');
  P('');
  P('if [ "$MODO" = "listar" ]; then listar; exit 0; fi');
  P('');
  P('preparar_ambiente');
  P('');
  P('case "$MODO" in');
  P('  tudo) executar_tudo ;;');
  P('  gate) COM_GATE=1; iniciar_resumos; encerrar gate ;;');
  P('  faixa)');
  P('    case "$ALVO" in');
  for (const fx of plan.faixas) {
    P(`      ${fx.id}) evento --tipo inicio --escopo "faixa:${fx.id}"; iniciar_resumos; executar_${fn(fx.id)} || true; encerrar "faixa:${fx.id}" ;;`);
  }
  P('      *) falhar "faixa desconhecida: \'$ALVO\' — veja as disponíveis com --listar" ;;');
  P('    esac ;;');
  P('  seq)');
  P('    case "$ALVO" in');
  for (const t of plan.sequenciais) {
    P(`      ${t.id}) evento --tipo inicio --escopo "seq:${t.id}"; iniciar_resumos; executar_seq_${fn(t.id)} || true; encerrar "seq:${t.id}" ;;`);
  }
  P(`      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;`);
  P('    esac ;;');
  P('esac');

  return `${L.join('\n')}\n`;
}
// ── artefato: plano-execucao.html (só claude) ──────────────────────────────

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderPlanoHtml(plan) {
  const cmd = `bash ${plan.baseDir}/executar-tarefas.sh`;
  const paralelas = plan.faixas.reduce((n, fx) => n + fx.tasks.length, 0);
  const sequencial = plan.modo === 'sequencial';
  const codexHtml = plan.agent === 'codex';
  const cursorHtml = plan.agent === 'cursor';
  const agenteRotulo = codexHtml ? 'Codex' : cursorHtml ? 'Cursor' : 'Claude Code';
  const cliRotulo = codexHtml
    ? '<code>codex exec</code>'
    : cursorHtml
      ? '<code>agent -p</code> (CLI do Cursor)'
      : '<code>claude -p</code>';
  const card = (t) => `
        <div class="tarefa">
          <span class="tid">${esc(t.id)}</span>
          <span class="ttitulo">${esc(t.title)}</span>
          <span class="meta"><code>${esc(t.model)}</code> · esforço <b>${esc(t.esforcoCli)}</b></span>
          <span class="arquivos">${t.files.map((f) => `<code>${esc(f)}</code>`).join(' ') || `<em>${esc((t.motivoSeq || 'sem arquivos — sequencial').replace(/`/g, ''))}</em>`}</span>
        </div>`;
  const faixaHtml = (fx) => `
      <div class="faixa">
        <h4>${esc(fx.id)} <small>branch <code>${esc(fx.branch)}</code> · worktree <code>${esc(fx.worktree)}</code></small></h4>
        ${fx.tasks.map(card).join('')}
      </div>`;
  const ondasHtml = plan.ondas
    .map(
      (onda, i) => `
    <section class="onda">
      <h3>Onda ${i + 1} <small>${onda.map((fx) => esc(fx.id)).join(' ∥ ')} — em paralelo, janelas limpas</small></h3>
      <div class="grade">${onda.map(faixaHtml).join('')}</div>
    </section>`
    )
    .join('');
  const seqHtml = plan.sequenciais.length
    ? `
    <section class="onda">
      <h3>${sequencial ? 'Ordem de execução <small>uma tarefa após a outra, na árvore principal</small>' : 'Sequenciais <small>após as ondas, na árvore principal</small>'}</h3>
      <div class="grade"><div class="faixa">${plan.sequenciais.map(card).join('')}</div></div>
    </section>`
    : '';
  const avisosHtml = plan.avisos.length
    ? `<div class="avisos">${plan.avisos.map((a) => `<div>⚠ ${esc(a)}</div>`).join('')}</div>`
    : '';

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plano de execução — ${esc(plan.feature)}</title>
<style>
  :root { --bg:#fafafa; --fg:#1a1a1a; --card:#fff; --borda:#e2e2e2; --sub:#666;
          --acc:#0a7c42; --acc-fg:#fff; --aviso:#8a6d00; --aviso-bg:#fff8e1; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --fg:#eaeaea; --card:#1e1e1e; --borda:#333; --sub:#9a9a9a;
            --acc:#17a35c; --aviso:#e0c36a; --aviso-bg:#2a2410; }
  }
  * { box-sizing:border-box }
  body { margin:0; padding:2rem 1rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 system-ui,-apple-system,sans-serif }
  main { max-width:64rem; margin:0 auto }
  h1 { font-size:1.5rem; margin:0 0 .25rem } h3 { margin:1.5rem 0 .5rem }
  h4 { margin:0 0 .5rem } small { color:var(--sub); font-weight:400 }
  .sub { color:var(--sub); margin:0 0 1.25rem }
  code { font:.85em ui-monospace,monospace; background:var(--card);
         border:1px solid var(--borda); border-radius:4px; padding:.05em .35em; overflow-wrap:anywhere }
  .resumo { display:flex; gap:.75rem; flex-wrap:wrap; margin:0 0 1rem }
  .resumo div { background:var(--card); border:1px solid var(--borda); border-radius:8px;
                padding:.5rem .9rem } .resumo b { font-size:1.2rem }
  .executor { background:var(--card); border:1px solid var(--borda); border-radius:10px;
              padding:1rem; margin:0 0 .5rem }
  .executor h2 { margin:0 0 .5rem; font-size:1.05rem }
  .nota { color:var(--sub); font-size:.85rem; margin:.5rem 0 0 }
  #cmd { display:inline-block; margin-top:.6rem }
  .grade { display:grid; grid-template-columns:repeat(auto-fit,minmax(17rem,1fr)); gap:.75rem }
  .faixa { background:var(--card); border:1px solid var(--borda); border-radius:10px; padding: .9rem }
  .tarefa { display:flex; flex-direction:column; gap:.15rem; padding:.6rem 0;
            border-top:1px dashed var(--borda) }
  .tarefa:first-of-type { border-top:0 }
  .tid { font:700 .85rem ui-monospace,monospace; color:var(--acc) }
  .meta,.arquivos { font-size:.85rem; color:var(--sub) }
  .avisos { background:var(--aviso-bg); color:var(--aviso); border-radius:8px;
            padding:.6rem .9rem; margin:0 0 1rem; font-size:.9rem }
  ol li { margin:.25rem 0 }
</style>
<main>
  <h1>Plano de execução — ${esc(plan.feature)}</h1>
  <p class="sub">gerado por <code>onp-spec plano</code> em ${esc(plan.geradoEm)} · regenere após mudar tasks.md</p>
  <div class="resumo">
    ${
      sequencial
        ? `<div><b>${plan.sequenciais.length}</b> tarefa(s), uma após a outra</div>
    <div>modo <b>sequencial</b> (escolha do usuário)</div>`
        : `<div><b>${paralelas}</b> tarefa(s) em paralelo</div>
    <div><b>${plan.faixas.length}</b> faixa(s) · <b>${plan.ondas.length}</b> onda(s)</div>
    <div><b>${plan.sequenciais.length}</b> sequencial(is)</div>${
      plan.paralelizar ? `\n    <div>seleção do usuário: <b>${plan.paralelizar.map(esc).join(', ')}</b></div>` : ''
    }`
    }
    <div>branch <code>${esc(plan.branchTrabalho)}</code></div>
  </div>
  ${avisosHtml}
  <div class="executor">
    <h2>Como executar — via agente</h2>
    <p>Peça ao agente (${agenteRotulo}) para executar o plano. Ele roda:</p>
    <div><code id="cmd">${esc(cmd)}</code></div>
    <p class="nota">Este arquivo é só visualização. ${
      sequencial
        ? `Cada tarefa roda ${cliRotulo} na árvore principal, uma após a outra, com contexto limpo e modelo/esforço já definidos.`
        : `Cada faixa roda ${cliRotulo} num worktree próprio, com contexto limpo, modelo e esforço já definidos.`
    }
    O gate final (verify + audit) roda sozinho; a execução fica em background e, a cada
    1 minuto, o agente posta no chat a <b>tabela de andamento</b>
    (<code>onp-spec resumo ${esc(plan.feature)} --tabela</code>) e o
    <b>resumo geral de andamento</b> (<code>onp-spec resumo ${esc(plan.feature)}</code>).</p>
  </div>
  ${ondasHtml}
  ${seqHtml}
  <section class="onda">
    <h3>Branches e commits</h3>
    <ol>
      <li>tudo parte da branch de trabalho <code>${esc(plan.branchTrabalho)}</code></li>
      ${
        sequencial
          ? `<li>as tarefas rodam nela mesma, na ordem; 1 tarefa = 1 commit <code>T-xxx ${esc(plan.feature)}: título</code></li>`
          : `<li>1 faixa = 1 branch + 1 worktree; 1 tarefa = 1 commit <code>T-xxx ${esc(plan.feature)}: título</code></li>
      <li>merge <code>--no-ff</code> por faixa, na ordem; conflito interrompe e pede você</li>`
      }
      <li>gate final: <code>onp-spec verify ${esc(plan.feature)}</code> + <code>onp-spec audit --ci</code> — exit 0 ou não está pronto</li>
    </ol>
  </section>
</main>
`;
}
