// Plano de execução — transforma as tarefas pendentes de tasks.md em FAIXAS:
// tarefas com `Arquivos:` disjuntos podem rodar em PARALELO (1 faixa = 1
// git worktree + 1 branch + 1 janela de contexto limpa); tarefas que
// compartilham arquivo caem na MESMA faixa (sequência dentro dela); tarefa
// sem `Arquivos:` tem pegada desconhecida → roda ao final, uma a uma, na
// árvore principal.
//
// O CÁLCULO do plano é agnóstico de agente. Os ARTEFATOS variam:
//   claude      → plano-execucao.md + executar-tarefas.sh (claude -p headless,
//                 com --model e --effort por tarefa) + plano-execucao.html
//                 (visual, com o botão "Executar todas as tarefas...")
//   antigravity → plano-execucao.md com comandos de worktree e um PROMPT
//                 pronto por faixa, para os agentes paralelos nativos do
//                 Antigravity (nunca depende do CLI do Claude)

import path from 'path';
import { foldStatus } from '../util/text.js';

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

function intersecta(setA, arrB) {
  return arrB.some((f) => setA.has(f));
}

function normFile(f) {
  return f.split('\\').join('/').replace(/^\.\//, '');
}

// ── cálculo ────────────────────────────────────────────────────────────────

export function montarPlano(project, featureName, opts = {}) {
  const agent = opts.agent === 'antigravity' ? 'antigravity' : 'claude';
  const feature = project.features.find((f) => f.name === featureName);
  if (!feature) return { erro: `feature "${featureName}" não encontrada em ${project.config.specDir}/features/` };
  if (!feature.tasks || !feature.tasks.tasks.length) {
    return { erro: `feature "${featureName}" não tem tarefas em tasks.md — escreva as tarefas (T-xxx) primeiro` };
  }

  const cfg = project.config.paralelo;
  const avisos = [];

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
    const esforcoRaw = t.esforco || cfg.esforco;
    const esforcoCli = normalizarEsforco(esforcoRaw);
    if (!esforcoCli) {
      avisos.push(`${t.id}: esforço "${esforcoRaw}" desconhecido — usando "medium" (aceitos: baixo|medio|alto|xalto|max)`);
    }
    pendentes.push({
      ...t,
      files: t.files.map(normFile),
      model: t.model || cfg.model,
      esforcoCli: esforcoCli || 'medium',
      acs: t.refs.filter((r) => r.startsWith('AC-')),
    });
  }

  if (!pendentes.length) {
    return { erro: `todas as tarefas de "${featureName}" já estão [concluida] — nada a planejar` };
  }

  // agrupa por conflito de arquivos: componentes conexos viram faixas
  const comArquivos = pendentes.filter((t) => t.files.length);
  const sequenciais = pendentes.filter((t) => !t.files.length);
  for (const t of sequenciais) {
    avisos.push(`${t.id} não lista Arquivos: — pegada desconhecida, vai rodar sozinha ao final (sem paralelismo)`);
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

  // como invocar o motor a partir da raiz do projeto
  let engine = opts.enginePath || 'onp-spec';
  if (path.isAbsolute(engine)) {
    const rel = path.relative(project.config.rootDir, engine);
    if (!rel.startsWith('..')) engine = rel.split(path.sep).join('/');
  }

  return {
    agent,
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

// ── artefato: plano.json (leitura de máquina — alimenta o painel ao vivo) ──

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

export function renderPlanoMd(plan) {
  const L = [];
  const paralelas = plan.faixas.reduce((n, fx) => n + fx.tasks.length, 0);
  L.push(`# Plano de execução — ${plan.feature}`);
  L.push('');
  L.push(`> gerado por \`onp-spec plano\` em ${plan.geradoEm} — NÃO edite à mão;`);
  L.push(`> mudou tasks.md ou a config? Regenere: \`onp-spec plano ${plan.feature}\``);
  L.push('');
  L.push('## Resumo — o que vai acontecer');
  L.push('');
  L.push(`- **${paralelas + plan.sequenciais.length} tarefa(s) pendente(s)**: ${paralelas} em ${plan.faixas.length} faixa(s) paralela(s) + ${plan.sequenciais.length} sequencial(is)${plan.concluidas.length ? ` (${plan.concluidas.length} já concluída(s): ${plan.concluidas.map((t) => t.id).join(', ')})` : ''}`);
  L.push(`- **1 faixa = 1 worktree + 1 branch + 1 janela de contexto limpa** — faixas não compartilham nenhum arquivo entre si`);
  L.push(`- tudo acontece na branch de trabalho \`${plan.branchTrabalho}\`; mesclagens voltam para ela; levar para a main é decisão sua`);
  if (plan.avisos.length) {
    L.push('');
    L.push('### Avisos');
    L.push('');
    for (const a of plan.avisos) L.push(`- ⚠ ${a}`);
  }
  L.push('');
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
  if (plan.sequenciais.length) {
    L.push('## Tarefas sequenciais (após as ondas, na árvore principal)');
    L.push('');
    L.push('| tarefa | título | modelo | esforço | por que sequencial |');
    L.push('|---|---|---|---|---|');
    for (const t of plan.sequenciais) {
      L.push(`| ${t.id} | ${t.title} | \`${t.model}\` | ${t.esforcoCli} | sem \`Arquivos:\` — pegada desconhecida |`);
    }
    L.push('');
  }
  L.push('## Gestão de branches e commits');
  L.push('');
  L.push(`1. branch de trabalho \`${plan.branchTrabalho}\` criada do ponto atual (se ainda não existir)`);
  L.push('2. cada faixa nasce dela como branch própria e roda no seu worktree — **1 tarefa = 1 commit** (`T-xxx feature: título`)');
  L.push('3. terminou a onda → merge `--no-ff` de cada faixa de volta, na ordem; conflito interrompe a faixa e pede resolução humana');
  L.push('4. faixa mesclada → worktree removido, branch apagada, tarefa marcada `[concluida]` no tasks.md');
  L.push(`5. gate final na branch de trabalho: \`onp-spec verify ${plan.feature}\` + \`onp-spec audit --ci\` — **exit 0 ou não está pronto**`);
  L.push('');
  L.push('## Como executar');
  L.push('');
  if (plan.agent === 'claude') {
    L.push('### ▶ Automático — Claude Code headless (recomendado)');
    L.push('');
    L.push('```bash');
    L.push(`bash ${plan.baseDir}/executar-tarefas.sh`);
    L.push('```');
    L.push('');
    L.push(`Ou abra \`${plan.baseDir}/plano-execucao.html\` no navegador e use o botão`);
    L.push('**“Executar todas as tarefas em janelas limpas e paralelas”** (copia o comando acima).');
    L.push('');
    L.push('Cada faixa roda `claude -p` com **janela de contexto limpa**, `--model` e `--effort` já');
    L.push(`definidos por tarefa, permissões \`${plan.cfg.permissionMode}\`. Os prompts exatos estão`);
    L.push('embutidos no script — quer rodar uma faixa na mão, é só copiá-los de lá.');
    L.push(`Logs: \`../onp-worktrees/${plan.repoName}-${plan.feature}-logs/\`.`);
    L.push('');
    L.push('### 👀 Acompanhe ao vivo, sem digitar comandos');
    L.push('');
    L.push('```bash');
    L.push(`onp-spec painel ${plan.feature}`);
    L.push('```');
    L.push('');
    L.push('Abre um painel no navegador com as faixas em tempo real, o log de cada uma');
    L.push('rolando ao vivo, o veredito do gate — e o botão **"Executar todas as tarefas');
    L.push('em janelas limpas e paralelas"** que aqui executa DE VERDADE (o servidor é');
    L.push('local, então pode disparar o script por você).');
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
    L.push(`6. **Acompanhe ao vivo** (opcional): \`onp-spec painel ${plan.feature}\` abre um`);
    L.push('   painel no navegador refletindo tasks.md, as provas do verify e o gate em');
    L.push('   tempo real enquanto os agentes trabalham — sem digitar mais nada.');
  }
  L.push('');
  return `${L.join('\n')}\n`;
}
// ── artefato: executar-tarefas.sh (só claude) ──────────────────────────────
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
// Cada tarefa roda `claude -p --output-format stream-json`: o NDJSON cru vai
// para o stream da tarefa no ledger global, que é o que o painel mostra ao
// vivo (ferramentas, raciocínio, saídas, custo).

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
  P(`# acompanhe ao vivo: onp-spec painel ${plan.feature}`);
  P('set -u');
  P('set -o pipefail');
  P('');
  P(`RUN_ID=${shq(plan.runId)}`);
  P(`FEATURE=${shq(plan.feature)}`);
  P(`BASE_BRANCH=${shq(plan.branchTrabalho)}`);
  P(`ENGINE=${shq(plan.engine)}`);
  P(`CLAUDE_FLAGS=(--permission-mode ${plan.cfg.permissionMode} --allowedTools ${shq(allowedTools(plan))})`);
  P('STREAM_FLAGS=(--output-format stream-json --verbose)');
  P('FALHAS=""');
  P('COM_GATE=1');
  P('');
  P(`verde()    { printf '\\033[32m%s\\033[0m\\n' "$*"; }`);
  P(`vermelho() { printf '\\033[31m%s\\033[0m\\n' "$*"; }`);
  P(`amarelo()  { printf '\\033[33m%s\\033[0m\\n' "$*"; }`);
  P(`info()     { printf '· %s\\n' "$*"; }`);
  P('falhar()   { vermelho "✘ $*"; exit 1; }');
  P('');
  P('# eventos vão para o ledger GLOBAL (~/.onp-spec/painel/ledger.jsonl):');
  P('# um arquivo para todos os projetos, é o que o painel lê');
  P('evento() { node "$ENGINE" evento --run "$RUN_ID" "$@" >/dev/null 2>&1 || true; }');
  P('');
  P('# ── ambiente (todos os modos passam por aqui) ────────────────────────');
  P('preparar_ambiente() {');
  P('  command -v git >/dev/null 2>&1 || falhar "git não encontrado"');
  P('  command -v node >/dev/null 2>&1 || falhar "node não encontrado"');
  P('  command -v claude >/dev/null 2>&1 || falhar "Claude Code CLI (claude) não encontrado — instale-o ou siga o modo manual em plano-execucao.md"');
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
  P('tentativa() { # $1=faixa — conta reexecuções para o painel mostrar');
  P('  local arq="$LOG_DIR/.tentativa-$1"');
  P('  local n=1');
  P('  [ -f "$arq" ] && n=$(( $(cat "$arq") + 1 ))');
  P('  printf "%s" "$n" > "$arq"');
  P('  printf "%s" "$n"');
  P('}');
  P('');
  P('# uma tarefa = uma sessão claude headless com contexto limpo.');
  P('# o NDJSON do stream-json vira o stream da tarefa (o painel mostra ao vivo)');
  P('rodar_tarefa() { # $1=escopo(faixa|seq) $2=T-xxx $3=prompt $4=modelo $5=esforço');
  P('  local chave="$1--$2"');
  P('  local stream="$STREAMS_DIR/$chave.jsonl"');
  P('  evento --tipo tarefa --tarefa "$2" --faixa "$1" --estado executando --stream "$chave"');
  P('  info "$2 — claude -p ($4 · $5) · stream: $chave"');
  P('  if claude -p "$3" --model "$4" --effort "$5" "${STREAM_FLAGS[@]}" "${CLAUDE_FLAGS[@]}" > "$stream" 2>>"$LOG_DIR/$1.log"; then');
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
    P(`# ── sequencial ${t.id} (sem Arquivos: — pegada desconhecida) ──`);
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
  P(`  amarelo "dica: reexecute só o que falhou (--faixa <id> / --seq <T-xxx>) e acompanhe em: onp-spec painel ${plan.feature}"`);
  P('  exit 1');
  P('}');

  // ── modo: tudo ──────────────────────────────────────────────────────────
  P('');
  P('executar_tudo() {');
  P('  evento --tipo inicio --escopo tudo');
  P('  info "logs por faixa em: $LOG_DIR"');
  P(`  info "acompanhe ao vivo: onp-spec painel ${plan.feature}"`);
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
  P('  gate) COM_GATE=1; encerrar gate ;;');
  P('  faixa)');
  P('    case "$ALVO" in');
  for (const fx of plan.faixas) {
    P(`      ${fx.id}) evento --tipo inicio --escopo "faixa:${fx.id}"; executar_${fn(fx.id)} || true; encerrar "faixa:${fx.id}" ;;`);
  }
  P('      *) falhar "faixa desconhecida: \'$ALVO\' — veja as disponíveis com --listar" ;;');
  P('    esac ;;');
  P('  seq)');
  P('    case "$ALVO" in');
  for (const t of plan.sequenciais) {
    P(`      ${t.id}) evento --tipo inicio --escopo "seq:${t.id}"; executar_seq_${fn(t.id)} || true; encerrar "seq:${t.id}" ;;`);
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
  const card = (t) => `
        <div class="tarefa">
          <span class="tid">${esc(t.id)}</span>
          <span class="ttitulo">${esc(t.title)}</span>
          <span class="meta"><code>${esc(t.model)}</code> · esforço <b>${esc(t.esforcoCli)}</b></span>
          <span class="arquivos">${t.files.map((f) => `<code>${esc(f)}</code>`).join(' ') || '<em>sem arquivos — sequencial</em>'}</span>
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
      <h3>Sequenciais <small>após as ondas, na árvore principal</small></h3>
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
  button { background:var(--acc); color:var(--acc-fg); border:0; border-radius:8px;
           padding:.8rem 1.2rem; font:600 1rem system-ui; cursor:pointer; max-width:100% }
  button:hover { filter:brightness(1.1) }
  .nota { color:var(--sub); font-size:.85rem; margin:.5rem 0 0 }
  #cmd { display:inline-block; margin-top:.6rem }
  #toast { visibility:hidden; margin-left:.75rem; color:var(--acc); font-weight:600 }
  #toast.on { visibility:visible }
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
    <div><b>${paralelas}</b> tarefa(s) em paralelo</div>
    <div><b>${plan.faixas.length}</b> faixa(s) · <b>${plan.ondas.length}</b> onda(s)</div>
    <div><b>${plan.sequenciais.length}</b> sequencial(is)</div>
    <div>branch <code>${esc(plan.branchTrabalho)}</code></div>
  </div>
  ${avisosHtml}
  <div class="executor">
    <button onclick="copiar()">▶ Executar todas as tarefas em janelas limpas e paralelas</button>
    <span id="toast">comando copiado ✔ — cole no terminal</span>
    <div><code id="cmd">${esc(cmd)}</code></div>
    <p class="nota">Este arquivo é estático: o botão copia o comando; cole no terminal, na raiz
    do projeto. Cada faixa roda <code>claude -p</code> num worktree próprio, com contexto limpo,
    modelo e esforço já definidos. O gate final (verify + audit) roda sozinho.
    <b>Quer acompanhar ao vivo e executar com um clique de verdade?</b> Rode
    <code>onp-spec painel ${esc(plan.feature)}</code> — abre a versão viva deste painel.</p>
  </div>
  ${ondasHtml}
  ${seqHtml}
  <section class="onda">
    <h3>Branches e commits</h3>
    <ol>
      <li>tudo parte da branch de trabalho <code>${esc(plan.branchTrabalho)}</code></li>
      <li>1 faixa = 1 branch + 1 worktree; 1 tarefa = 1 commit <code>T-xxx ${esc(plan.feature)}: título</code></li>
      <li>merge <code>--no-ff</code> por faixa, na ordem; conflito interrompe e pede você</li>
      <li>gate final: <code>onp-spec verify ${esc(plan.feature)}</code> + <code>onp-spec audit --ci</code> — exit 0 ou não está pronto</li>
    </ol>
  </section>
</main>
<script>
  async function copiar() {
    var cmd = document.getElementById('cmd').textContent;
    try { await navigator.clipboard.writeText(cmd); }
    catch (e) {
      var ta = document.createElement('textarea');
      ta.value = cmd; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    var t = document.getElementById('toast');
    t.classList.add('on'); setTimeout(function(){ t.classList.remove('on'); }, 2500);
  }
</script>
`;
}
