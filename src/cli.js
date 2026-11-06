// CLI onp-spec — dispatch de comandos.

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  montarPlano,
  renderPlanoMd,
  renderPlanoSh,
  renderPlanoMjs,
  renderPlanoJson,
  usaExecutorSh,
  normalizarEsforco,
  AGENTES,
} from './core/plano.js';
import { registrarEvento, lerStream, lerEventos, montarArvore } from './core/ledger.js';
import {
  resumoDeterministico,
  contextoParaIa,
  montarResumoAtual,
  registrarResumo,
  execucaoAlvo,
  tabelaAndamento,
} from './core/resumo.js';
import { TASK_STATUSES } from './parsers/tasks.js';
import { DASH, foldStatus } from './util/text.js';
import { loadConfig, DEFAULT_CONFIG } from './config.js';
import { loadProject } from './core/project.js';
import { auditProject } from './core/audit.js';
import { renderTerminal, renderJson, renderMarkdown } from './core/report.js';
import { runVerify, gitRev } from './core/verify.js';
import { scaffoldTests } from './core/scaffold.js';
import { allAcs } from './parsers/spec.js';
import { carregarSinais, registrarAchados, registrarVerify } from './core/sinais.js';
import {
  carregarLicoes,
  salvarLicoes,
  adicionarLicao,
  listarLicoes,
  penalizarLicao,
  podarLicoes,
  sugerirLicoes,
  LICOES_DEFAULTS,
} from './core/licoes.js';

import { executePlan, listExecutionWorktrees, cleanupExecutionWorktrees, planSourceFingerprint } from './core/executor.js';
import { discoverModels, readQuota, HARNESS_CAPABILITIES } from './core/harness.js';
import { scaffoldGovernance, checkGovernance, recordImpactReview, recordGovernanceDecision, DOCUMENTATION_MARKER, documentLinks } from './core/governance.js';
import { listExecutionPlans } from './core/execution-history.js';
import { installSkill, pathExists } from './core/install.js';
import { reservePlanArtifacts, selectExecutionPlan } from './core/plan-artifacts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// Onde mora a skill: layout do repo (skills/onp-spec-driven) ou layout
// embarcado (este arquivo em <skill>/scripts/lib/src → a skill é ../../..).
// O fallback embarcado só vale se a SKILL.md encontrada for DO agente pedido
// (marcador `agent:` no frontmatter) — senão instalaríamos a skill errada
// anunciando sucesso.
function skillAgentMarker(dir) {
  try {
    const conteudo = readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    const frontmatter = conteudo.split(/^---\s*$/m)[1] || '';
    const m = frontmatter.match(/^\s*agent:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const SKILL_DIR_POR_AGENTE = {
  claude: 'onp-spec-driven',
  antigravity: 'onp-spec-driven-antigravity',
  codex: 'onp-spec-driven-codex',
  cursor: 'onp-spec-driven-cursor',
  opencode: 'onp-spec-driven-opencode',
};

// Diretório de skills de cada agente. Primeira instalação: onp-spec-driven;
// atualizações coexistem em pastas versionadas com name igual à pasta.
const SKILLS_DIR_PROJETO = {
  claude: '.claude',
  antigravity: '.agents',
  codex: '.agents',
  cursor: '.cursor',
  opencode: '.opencode',
};

function resolveSkillDir(agent = 'claude') {
  const dirName = SKILL_DIR_POR_AGENTE[agent] || 'onp-spec-driven';
  const candidates = [
    path.join(__dirname, '..', 'skills', dirName),
    path.join(__dirname, '..', '..', '..'),
  ];
  for (const dir of candidates) {
    if (!existsSync(path.join(dir, 'SKILL.md'))) continue;
    const marker = skillAgentMarker(dir);
    if (marker && marker !== agent) continue; // skill de outro agente — não serve
    return dir;
  }
  return null;
}

const HELP = `onp-spec — desenvolvimento ancorado em especificações

  init [--preset base|lgpd-educacao] [--agents claude|codex|cursor|antigravity|opencode] [--nova-versao]
  new <feature> [--grande] [--cliente "pedido literal"] [--dominios dominio,outro]
  plano <feature> [--agents <harness>] [--paralelizar T-xxx,T-yyy|--sequencial]
        [--modelo <modelo disponível>] [--esforco baixo|medio|alto|xalto|max]
  harness [--agents <harness>]    capacidades, modelos atuais e cota real (JSON)
  executar <feature> [--run <id>] [--faixa <id>|--seq <T-xxx>|--gate|--listar]
  impacto <feature> [--revisao <arquivo.json>|--decisao <arquivo.json>]
  worktrees <feature> [--run <id>] [--limpar --confirmar]
  tarefa <feature> <T-xxx> [status] [--modelo <id>] [--esforco <nível>]
  scaffold <feature> [--force]   cria testes que falham até implementar
  verify <feature>              test runner registra provas
  audit [--ci] [--json] [--md <arquivo>]
  status | assumptions
  resumo [feature] [--tabela] [--global] [--run <id>] [--gravar --texto "..."]
  licoes <add|list|sugerir|penalizar|status>
  version | help

Progresso, perguntas, timers e notificações usam os recursos nativos do harness.
Executor portátil: node .spec/features/<feature>/executar-tarefas.mjs
Cota <=5%: checkpoint, espera e nova consulta antes de continuar.
Sem telemetria inicial, conecte quotaCommand; após limite, preserve a espera até leitura fresca.
Limpeza exige confirmação do usuário; worktrees sujos/ativos/não integrados ficam.`;

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function template(name) {
  return readFileSync(path.join(TEMPLATES_DIR, name), 'utf-8');
}

function fill(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function cmdInit(rootDir, flags) {
  const preset = flags.preset || 'base';
  const presetFile = `constituicao-${preset}.md`;
  if (!existsSync(path.join(TEMPLATES_DIR, presetFile))) {
    console.error(`preset desconhecido: ${preset} (use: base, lgpd-educacao)`);
    return 2;
  }

  if (flags.agents !== undefined && flags.agents !== true && !AGENTES.includes(flags.agents)) {
    console.error(`--agents desconhecido: "${flags.agents}" (use: ${AGENTES.join(', ')})`);
    return 2;
  }
  const config = loadConfig(rootDir);
  const specRoot = path.join(rootDir, config.specDir);
  mkdirSync(path.join(specRoot, 'features'), { recursive: true });
  mkdirSync(path.join(specRoot, 'verification'), { recursive: true });

  const constitutionPath = path.join(specRoot, 'constituicao.md');
  if (pathExists(constitutionPath)) {
    console.log(`· ${config.specDir}/constituicao.md já existe — mantido`);
  } else {
    writeFileSync(constitutionPath, template(presetFile), { flag: 'wx' });
    console.log(`✔ ${config.specDir}/constituicao.md criado (preset: ${preset})`);
  }

  const configPath = path.join(rootDir, 'onpspec.config.json');
  if (pathExists(configPath)) {
    console.log('· onpspec.config.json já existe — mantido');
  } else {
    const cfg = {
      testCommand: 'node --test',
      reporter: 'tap',
      testGlobs: DEFAULT_CONFIG.testGlobs,
      srcGlobs: DEFAULT_CONFIG.srcGlobs,
    };
    writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, { flag: 'wx' });
    console.log('✔ onpspec.config.json criado (testCommand: "node --test" — ajuste à sua stack)');
  }

  const gitignorePath = path.join(specRoot, 'verification', '.gitkeep');
  if (!pathExists(gitignorePath)) writeFileSync(gitignorePath, '', { flag: 'wx' });

  if (flags.agents !== undefined) {
    const agent = flags.agents === true ? 'claude' : flags.agents;
    const rotulo = { claude: 'Claude Code', antigravity: 'Antigravity', codex: 'Codex', cursor: 'Cursor', opencode: 'OpenCode' }[agent];
    // Cada agente lê seu diretório de skills no projeto (.claude, .cursor);
    // Codex e Antigravity leem o MESMO (.agents/skills — o padrão cross-agent
    // que o Codex adota). O marcador `agent:` no frontmatter diz de quem é a
    // skill instalada.
    const destRel = path.join(SKILLS_DIR_PROJETO[agent], 'skills', 'onp-spec-driven');
    const dest = path.join(rootDir, destRel);
    const skillDir = resolveSkillDir(agent);
    const marcadorExistente = skillAgentMarker(dest);
    if (marcadorExistente && marcadorExistente !== agent && !flags['nova-versao']) {
      const nota =
        SKILLS_DIR_PROJETO[agent] === '.agents' ? ' — Codex e Antigravity compartilham esse diretório.' : '.';
      console.error(
        `✘ ${destRel} já contém a skill do agente "${marcadorExistente}"${nota}\n` +
          `  Arquivos preservados. Para instalar uma variante separada: onp-spec init --agents ${agent} --nova-versao`
      );
      return 2;
    }
    if (!skillDir) {
      console.log(
        `· skill para ${rotulo} não encontrada junto a este motor — instale com: npx @onovoprogramador/onp-spec init --agents ${agent}`
      );
    } else if (path.resolve(dest) === path.resolve(skillDir)) {
      console.log(`· skill já instalada em ${destRel} — mantida`);
    } else {
      const installed = installSkill(skillDir, dest, { agent, versioned: Boolean(flags['nova-versao']) });
      const installedRel = path.relative(rootDir, installed.destination);
      console.log(`${installed.reused ? '· skill mantida' : '✔ skill instalada'} em ${installedRel} (${rotulo})`);
      if (installed.destination !== dest) console.log(`· instalação anterior preservada; para usar esta versão, invoque ${installed.name} no harness.`);
    }
    // o Cursor lê .cursor/skills E .agents/skills nativamente (e .claude/
    // .codex por compatibilidade) — duas variantes no mesmo projeto = duas
    // skills com o MESMO nome, e o Cursor pode carregar a errada
    if (agent === 'cursor') {
      for (const outroDir of ['.claude', '.agents']) {
        const marcadorOutro = skillAgentMarker(path.join(rootDir, outroDir, 'skills', 'onp-spec-driven'));
        if (marcadorOutro && marcadorOutro !== 'cursor') {
          console.log(
            `⚠ este projeto também tem a skill do agente "${marcadorOutro}" em ${outroDir}/skills/onp-spec-driven — o Cursor lê esse diretório também e pode carregar a skill errada.\n` +
              `  As duas instalações foram preservadas. Selecione explicitamente a variante do Cursor no harness.`
          );
        }
      }
    }
  }

  console.log('\npróximo passo: onp-spec new <nome-da-feature>');
  return 0;
}

function cmdNew(rootDir, name, flags) {
  if (!name) {
    console.error('uso: onp-spec new <nome-da-feature> (kebab-case, ex.: entrega-dever-casa)');
    return 2;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(`nome inválido: "${name}" — use kebab-case (letras minúsculas, números e hífen)`);
    return 2;
  }
  const config = loadConfig(rootDir);
  const dir = path.join(rootDir, config.specDir, 'features', name);
  if (pathExists(dir)) {
    console.error(`feature "${name}" já existe em ${config.specDir}/features/${name}/ — todos os arquivos foram preservados; use outro nome.`);
    return 2;
  }
  // IDs únicos no projeto: continua a numeração a partir do maior ID existente
  const project = loadProject(config);
  let maxUs = 0;
  let maxAc = 0;
  for (const feature of project.features) {
    if (!feature.spec) continue;
    for (const s of feature.spec.stories) {
      maxUs = Math.max(maxUs, parseInt(s.id.slice(3), 10));
      for (const ac of s.acs) maxAc = Math.max(maxAc, parseInt(ac.id.slice(3), 10));
    }
  }
  const pad = (n) => String(n).padStart(3, '0');
  const titulo = name
    .split('-')
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

  let spec = template('spec.md');
  spec = fill(spec, { TITULO: titulo, FEATURE: name, TITULO_HISTORIA: '[título da história]' });
  spec = spec.replace('US-001', `US-${pad(maxUs + 1)}`).replace('AC-001', `AC-${pad(maxAc + 1)}`);

  let tasks = template('tasks.md');
  tasks = fill(tasks, { TITULO: titulo, FEATURE: name });
  tasks = tasks
    .replace('US-001, AC-001', `US-${pad(maxUs + 1)}, AC-${pad(maxAc + 1)}`);
  const large = Boolean(flags.grande || flags.escopo === 'grande');
  if (large) {
    spec = `${DOCUMENTATION_MARKER}\n\n${spec}\n## Documentos relacionados\n\n${documentLinks('spec.md')}\n`;
    tasks = `${DOCUMENTATION_MARKER}\n\n${tasks}\n## Documentos relacionados\n\n${documentLinks('tasks.md')}\n`;
  }
  mkdirSync(path.dirname(dir), { recursive: true });
  mkdirSync(dir); // criação exclusiva: até uma feature parcial é preservada
  writeFileSync(path.join(dir, 'spec.md'), spec, { flag: 'wx' });
  writeFileSync(path.join(dir, 'tasks.md'), tasks, { flag: 'wx' });
  if (large) {
    scaffoldGovernance(rootDir, name, {
      specDir: config.specDir,
      newFeature: true,
      clientRequest: typeof flags.cliente === 'string' ? flags.cliente : '',
      domains: typeof flags.dominios === 'string' ? flags.dominios.split(',').map((d) => d.trim()).filter(Boolean) : [],
    });
    console.log(`✔ PRD, ADR, TDD (design.md), research e governança: ${path.relative(rootDir, dir)}`);
  }

  console.log(`✔ ${config.specDir}/features/${name}/spec.md`);
  console.log(`✔ ${config.specDir}/features/${name}/tasks.md`);
  console.log(`\npróximos passos:`);
  console.log(`  1. escreva as histórias de usuário e os critérios de aceite (Dado/Quando/Então)`);
  console.log(`     e PREENCHA as seções Suposições e Perguntas em aberto`);
  console.log(`  2. onp-spec scaffold ${name}   # cada critério vira um teste executável`);
  console.log(`  3. onp-spec audit              # veja o que falta`);
  console.log(`  4. onp-spec plano ${name}      # com as tarefas escritas: plano de execução paralela`);
  return 0;
}

// Detecta para qual agente gerar os artefatos do plano: flag explícita vence;
// senão, o marcador `agent:` da própria skill embarcada é a fonte da verdade
// (Codex e Antigravity compartilham .agents/, então o caminho sozinho não
// basta); senão, o caminho do motor; senão, o que estiver instalado no
// projeto; default: claude.
function detectarAgente(rootDir, flag) {
  if (flag !== undefined && flag !== true) {
    if (!AGENTES.includes(flag)) return { erro: `--agents desconhecido: "${flag}" (use: ${AGENTES.join(', ')})` };
    return { agent: flag };
  }
  // motor embarcado: este arquivo mora em <skill>/scripts/lib/src
  const marcadorProprio = skillAgentMarker(path.join(__dirname, '..', '..', '..'));
  if (AGENTES.includes(marcadorProprio)) return { agent: marcadorProprio };
  const segmentos = __dirname.split(path.sep);
  if (segmentos.includes('.codex')) return { agent: 'codex' };
  // só .cursor/skills conta: ~/.cursor/worktrees/<repo> é um checkout comum
  // dos agentes paralelos do Cursor, não uma instalação da skill
  const iCursor = segmentos.indexOf('.cursor');
  if (iCursor !== -1 && segmentos[iCursor + 1] === 'skills') return { agent: 'cursor' };
  if (segmentos.includes('.agents')) return { agent: 'antigravity' };
  if (segmentos.includes('.opencode')) return { agent: 'opencode' };
  if (segmentos.includes('.claude')) return { agent: 'claude' };
  const marcadorOpenCode = skillAgentMarker(path.join(rootDir, '.opencode', 'skills', 'onp-spec-driven'));
  if (marcadorOpenCode === 'opencode') return { agent: 'opencode' };
  const temClaude = existsSync(path.join(rootDir, '.claude', 'skills', 'onp-spec-driven'));
  const marcadorProjeto = skillAgentMarker(path.join(rootDir, '.agents', 'skills', 'onp-spec-driven'));
  if (AGENTES.includes(marcadorProjeto) && !temClaude) return { agent: marcadorProjeto };
  const marcadorCursor = skillAgentMarker(path.join(rootDir, '.cursor', 'skills', 'onp-spec-driven'));
  if (AGENTES.includes(marcadorCursor) && !temClaude) return { agent: marcadorCursor };
  const temAg = existsSync(path.join(rootDir, '.agents', 'skills', 'onp-spec-driven'));
  if (temAg && !temClaude) return { agent: 'antigravity' };
  return { agent: 'claude' };
}

function gerarArtefatosPlano(project, featureName, agent, { sequencial = false, paralelizar, modelo, esforco } = {}) {
  const plan = montarPlano(project, featureName, {
    agent,
    sequencial,
    paralelizar,
    modelo,
    esforco,
    enginePath: process.argv[1],
  });
  if (plan.erro) return plan;
  const reserved = reservePlanArtifacts(project.config.rootDir, plan);
  plan.artifactDir = reserved.artifactDir;
  let planoJson;
  const gerados = [];
  try {
    const write = (name, content, executable = false) => {
      const file = path.join(reserved.directory, name);
      writeFileSync(file, content, { flag: 'wx' });
      if (executable) chmodSync(file, 0o755);
      gerados.push(`${plan.artifactDir}/${name}`);
    };
    write('plano-execucao.md', renderPlanoMd(plan));
    if (usaExecutorSh(plan.agent)) {
      write('executar-tarefas.sh', renderPlanoSh(plan), true);
      write('executar-tarefas.mjs', renderPlanoMjs(plan));
    }
    const planoData = JSON.parse(renderPlanoJson(plan));
    planoData.sourceFingerprint = planSourceFingerprint(project.config.rootDir, planoData);
    planoJson = `${JSON.stringify(planoData, null, 2)}\n`;
    write('plano.json', planoJson); // publica o seletor só após completar os artefatos
  } finally { reserved.release(); }
  // registra a execução no ledger GLOBAL: é assim que o `onp-spec resumo`
  // enxerga este projeto junto com os outros, mesmo antes de qualquer execução
  registrarEvento({
    tipo: 'plano',
    runId: plan.runId,
    projeto: plan.repoName,
    projetoDir: project.config.rootDir,
    feature: plan.feature,
    agent: plan.agent,
    plano: JSON.parse(planoJson),
  });
  plan.gerados = gerados;
  return plan;
}

// `onp-spec evento` — usado pelo executar-tarefas.sh para alimentar o ledger
// global. Interno: não aparece na ajuda principal.
function cmdEvento(flags) {
  if (!flags.run || !flags.tipo) {
    console.error('uso interno: onp-spec evento --run <runId> --tipo <plano|inicio|faixa|tarefa|gate|fim> [...]');
    return 2;
  }
  const num = (v) => (v === undefined || v === true ? undefined : parseInt(v, 10));
  registrarEvento({
    runId: flags.run,
    tipo: flags.tipo,
    faixa: typeof flags.faixa === 'string' ? flags.faixa : undefined,
    tarefa: typeof flags.tarefa === 'string' ? flags.tarefa : undefined,
    estado: typeof flags.estado === 'string' ? flags.estado : undefined,
    etapa: typeof flags.etapa === 'string' ? flags.etapa : undefined,
    stream: typeof flags.stream === 'string' ? flags.stream : undefined,
    escopo: typeof flags.escopo === 'string' ? flags.escopo : undefined,
    exit: num(flags.exit),
    tentativa: num(flags.tentativa),
  });
  return 0;
}

// `onp-spec stream-resumo <runId> <chave>` — uma linha legível no terminal a
// partir do stream NDJSON (o stream completo fica no ledger para diagnóstico)
function cmdStreamResumo(positional) {
  const [runId, chave] = positional;
  if (!runId || !chave) {
    console.error('uso interno: onp-spec stream-resumo <runId> <chave>');
    return 2;
  }
  const { itens, resumo, existe } = lerStream(runId, chave);
  if (!existe) {
    console.log(`  (sem stream gravado para ${chave})`);
    return 0;
  }
  const ferramentas = itens.filter((i) => i.tipo === 'ferramenta');
  const contagem = {};
  for (const f of ferramentas) contagem[f.nome] = (contagem[f.nome] || 0) + 1;
  const usadas = Object.entries(contagem)
    .map(([n, c]) => (c > 1 ? `${n}×${c}` : n))
    .join(', ');
  const partes = [];
  if (resumo) {
    partes.push(resumo.status);
    if (resumo.turnos != null) partes.push(`${resumo.turnos} turno(s)`);
    if (resumo.duracaoMs != null) partes.push(`${(resumo.duracaoMs / 1000).toFixed(1)}s`);
    if (resumo.custoUsd != null) partes.push(`US$ ${resumo.custoUsd.toFixed(4)}`);
  }
  console.log(`  ↳ ${chave}: ${partes.join(' · ') || 'em andamento'}${usadas ? ` · ferramentas: ${usadas}` : ''}`);
  return 0;
}

function cmdPlano(project, positional, flags) {
  const featureName = positional[0];
  if (!featureName) {
    console.error('uso: onp-spec plano <feature> [--agents claude|antigravity|codex|cursor] [--paralelizar T-xxx,T-yyy] [--sequencial]');
    return 2;
  }
  const det = detectarAgente(project.config.rootDir, flags.agents);
  if (det.erro) {
    console.error(det.erro);
    return 2;
  }
  if (flags.sequencial && flags.paralelizar) {
    console.error('erro: use --paralelizar OU --sequencial — os dois juntos não fazem sentido');
    return 2;
  }
  if (det.agent === 'cursor' && typeof flags.esforco === 'string') {
    console.log(
      '⚠ o CLI do Cursor não tem flag de esforço — escolha um identificador de modelo confirmado pelo catálogo do harness'
    );
  }
  if (flags.modelo === true) {
    console.error('erro: --modelo precisa de um valor (use --modelo <id-do-catálogo>)');
    return 2;
  }
  if (flags.esforco === true) {
    console.error('erro: --esforco precisa de um valor (baixo|medio|alto|xalto|max)');
    return 2;
  }
  const paralelizar =
    flags.paralelizar === undefined
      ? undefined
      : flags.paralelizar === true
        ? []
        : String(flags.paralelizar)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
  const plan = gerarArtefatosPlano(project, featureName, det.agent, {
    sequencial: Boolean(flags.sequencial),
    paralelizar,
    modelo: typeof flags.modelo === 'string' ? flags.modelo : undefined,
    esforco: typeof flags.esforco === 'string' ? flags.esforco : undefined,
  });
  if (plan.erro) {
    console.error(`erro: ${plan.erro}`);
    return 2;
  }

  const paralelas = plan.faixas.reduce((n, fx) => n + fx.tasks.length, 0);
  if (plan.modo === 'sequencial') {
    console.log(
      `✔ plano de execução (${det.agent}, SEQUENCIAL — escolha do usuário): ` +
        `${plan.sequenciais.length} tarefa(s), uma após a outra, na árvore principal`
    );
  } else {
    console.log(
      `✔ plano de execução (${det.agent}): ${paralelas + plan.sequenciais.length} tarefa(s) — ` +
        `${paralelas} PODEM RODAR EM PARALELO em ${plan.faixas.length} faixa(s) · ${plan.sequenciais.length} sequencial(is) · ${plan.ondas.length} onda(s)`
    );
    if (plan.paralelizar) {
      console.log(`  (seleção do usuário: ${plan.paralelizar.join(', ')} em paralelo; as demais rodam uma após a outra ao final)`);
    } else {
      console.log(
        '  (o usuário quer escolher? regenere com: onp-spec plano ' +
          featureName +
          ' --paralelizar T-xxx,T-yyy — ou --sequencial para uma após a outra)'
      );
    }
  }
  console.log('\nonde está cada coisa:');
  console.log(`  · plano (leia primeiro): ${plan.gerados[0]}`);
  if (usaExecutorSh(plan.agent)) {
    console.log(`  · executor portátil:     ${plan.artifactDir}/executar-tarefas.mjs`);
  }
  for (const a of plan.avisos) console.log(`  ⚠ ${a}`);
  console.log('\nmodelos/esforços solicitados — confirme custos ainda não autorizados com a ferramenta nativa:');
  for (const t of [...plan.faixas.flatMap((fx) => fx.tasks), ...plan.sequenciais]) {
    console.log(`  · ${t.id} — ${t.model || 'padrão disponível do harness'} · esforço ${t.esforcoCli}`);
  }
  console.log(`  consultar catálogo e cota: onp-spec harness --agents ${det.agent}`);
  console.log(`\npróximo passo: node ${plan.artifactDir}/executar-tarefas.mjs`);
  console.log('  Use o plano/tarefas nativos para acompanhar; ao encerrar, pergunte sobre limpar worktrees.');

  return 0;
}

// `onp-spec resumo` — o RESUMO GERAL DE ANDAMENTO. É o texto que o agente
// consulta sob demanda, sem chamadas periódicas de inferência. Sem flags, imprime
// (IA fresca do ledger > motor determinístico); com --gravar, registra no
// ledger (--texto = escrito pela IA/agente do executor).
function cmdResumo(config, positional, flags) {
  const feature = positional[0] || null;
  const filtro = flags.global ? {} : { projetoDir: config.rootDir, feature };
  const projetos = montarArvore(lerEventos(), filtro);

  if (flags.contexto) {
    console.log(contextoParaIa(projetos));
    return 0;
  }

  // Tabela sob demanda para diagnóstico; o progresso usa ferramentas nativas.
  if (flags.tabela) {
    console.log(tabelaAndamento(projetos));
    return 0;
  }

  if (flags.gravar) {
    const alvo = execucaoAlvo(projetos, { runId: typeof flags.run === 'string' ? flags.run : null });
    if (!alvo) {
      console.error('nenhuma execução no ledger para gravar o resumo — gere um plano primeiro (onp-spec plano <feature>)');
      return 2;
    }
    const temTexto = typeof flags.texto === 'string' && flags.texto.trim();
    const texto = temTexto ? flags.texto : resumoDeterministico(projetos);
    const origem = temTexto ? (flags.origem === 'motor' ? 'motor' : 'ia') : 'motor';
    const r = registrarResumo({ runId: alvo.runId, texto, origem });
    if (r.erro) {
      console.error(`erro: ${r.erro}`);
      return 2;
    }
    console.log(`✔ resumo gravado (origem: ${r.origem}) para "${alvo.feature}"`);
    console.log(r.texto);
    return 0;
  }

  console.log(montarResumoAtual(projetos).texto);
  return 0;
}

// insere ou substitui um campo de lista (- Modelo:/- Esforço:) dentro da
// seção da tarefa em tasks.md — no MESMO formato que o parser lê; é assim
// que o usuário ajusta o custo por tarefa sem editar arquivo na mão
function definirCampoTarefa(linhas, taskId, matcher, rotulo, valor) {
  const reTitulo = new RegExp(`^##\\s+${taskId}\\s*${DASH}\\s*`);
  const inicio = linhas.findIndex((l) => reTitulo.test(l));
  if (inicio === -1) return false;
  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i++) {
    if (/^##\s+/.test(linhas[i])) {
      fim = i;
      break;
    }
  }
  const reCampo = new RegExp(`^\\s*[-*]\\s*${matcher}\\s*:`, 'i');
  for (let i = inicio + 1; i < fim; i++) {
    if (reCampo.test(linhas[i])) {
      linhas[i] = `- ${rotulo}: ${valor}`;
      return true;
    }
  }
  // campo ainda não existe: entra depois da última linha de lista da seção
  let pos = inicio;
  for (let i = inicio + 1; i < fim; i++) {
    if (/^\s*[-*]\s/.test(linhas[i])) pos = i;
  }
  if (pos === inicio) linhas.splice(inicio + 1, 0, '', `- ${rotulo}: ${valor}`);
  else linhas.splice(pos + 1, 0, `- ${rotulo}: ${valor}`);
  return true;
}

function cmdTarefa(config, positional, flags = {}) {
  const [featureName, taskId, statusRaw] = positional;
  const modelo = typeof flags.modelo === 'string' ? flags.modelo : null;
  const esforcoRaw = typeof flags.esforco === 'string' ? flags.esforco : null;
  const USO =
    'uso: onp-spec tarefa <feature> <T-xxx> [pendente|em-andamento|concluida] [--modelo <modelo>] [--esforco baixo|medio|alto|xalto|max]';
  if (!featureName || !taskId || (!statusRaw && !modelo && !esforcoRaw) || flags.modelo === true || flags.esforco === true) {
    console.error(USO);
    return 2;
  }
  let status = null;
  if (statusRaw) {
    status = foldStatus(statusRaw);
    if (!TASK_STATUSES.includes(status)) {
      console.error(`status inválido: "${statusRaw}" (use: ${TASK_STATUSES.join(', ')})`);
      return 2;
    }
  }
  if (esforcoRaw && !normalizarEsforco(esforcoRaw)) {
    console.error(`esforço inválido: "${esforcoRaw}" (use: baixo|medio|alto|xalto|max)`);
    return 2;
  }
  const tasksPath = path.join(config.rootDir, config.specDir, 'features', featureName, 'tasks.md');
  if (!existsSync(tasksPath)) {
    console.error(`não achei ${config.specDir}/features/${featureName}/tasks.md`);
    return 2;
  }
  const original = readFileSync(tasksPath, 'utf-8');
  let conteudo = original;
  // Somente o token de status muda: preserve recuos, CRLF e linhas em branco.
  const re = new RegExp(`^(##[ \t]+${taskId}[ \t]*${DASH}[ \t]*[^\r\n]*?)(?:([ \t]*)\\[[^\\]\r\n]+\\])?([ \t]*)(\r?)$`, 'm');
  if (!re.test(conteudo)) {
    console.error(`tarefa ${taskId} não encontrada em ${config.specDir}/features/${featureName}/tasks.md`);
    return 2;
  }
  const mudancas = [];
  if (status) {
    conteudo = conteudo.replace(re, (_, heading, spacing, trailing, cr) => `${heading}${spacing ?? ' '}[${status}]${trailing}${cr}`);
    mudancas.push(`→ [${status}]`);
  }
  if (modelo || esforcoRaw) {
    const linhas = conteudo.split('\n');
    if (modelo) {
      definirCampoTarefa(linhas, taskId, 'Modelo', 'Modelo', modelo);
      mudancas.push(`Modelo: ${modelo}`);
    }
    if (esforcoRaw) {
      definirCampoTarefa(linhas, taskId, 'Esfor[cç]o', 'Esforço', esforcoRaw);
      mudancas.push(`Esforço: ${esforcoRaw}`);
    }
    conteudo = linhas.join('\n');
  }
  if (conteudo !== original) writeFileSync(tasksPath, conteudo);
  console.log(`✔ ${taskId} ${mudancas.join(' · ')} em ${config.specDir}/features/${featureName}/tasks.md`);
  if (modelo || esforcoRaw) {
    console.log(`· modelo/esforço mudou — crie uma nova versão separada do plano: onp-spec plano ${featureName}`);
  }
  return 0;
}

function cmdStatus(project) {
  if (project.errors.length) {
    for (const e of project.errors) console.error(`erro: ${e}`);
    return 2;
  }
  const testFileSet = new Set(project.testFiles);
  const provenTags = project.annotations.specTags.filter((t) => testFileSet.has(t.file));

  const cols = ['critérios', 'com-teste', 'provados', 'suposições?', 'perguntas?'];
  const header =
    'feature'.padEnd(30) + ' ' + 'status'.padEnd(18) + cols.map((c) => ` ${c}`).join('');
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const feature of project.features) {
    const spec = feature.spec;
    if (!spec) {
      console.log(`${feature.name.padEnd(30)} SEM SPEC`);
      continue;
    }
    const acs = allAcs(spec);
    const withTest = acs.filter((ac) => provenTags.some((t) => t.acId === ac.id)).length;
    const v = project.verifications[feature.name];
    const proven = acs.filter((ac) => v?.results?.[ac.id]?.status === 'pass').length;
    const asmOpen = spec.assumptions.filter((a) => a.status === 'aberta').length;
    const qOpen = spec.questions.filter((q) => q.status === 'aberta').length;
    const vals = [acs.length, withTest, proven, asmOpen, qOpen];
    console.log(
      `${feature.name.padEnd(30)} ${(spec.status || '—').padEnd(18)}` +
        vals.map((v, i) => ` ${String(v).padStart(cols[i].length)}`).join('')
    );
  }
  console.log(
    '\nlegenda: critérios = critérios de aceite · com-teste = têm teste anotado (@spec:) ·' +
      '\n         provados = PASS no último verify · suposições?/perguntas? = ainda abertas'
  );
  return 0;
}

function cmdAssumptions(project) {
  let any = false;
  for (const feature of project.features) {
    if (!feature.spec) continue;
    const { assumptions, questions } = feature.spec;
    if (!assumptions.length && !questions.length) continue;
    any = true;
    console.log(`\n${feature.name}:`);
    for (const a of assumptions) {
      const mark = a.status === 'aberta' ? '⚠' : a.status === 'invalidada' ? '✘' : '✔';
      console.log(`  ${mark} ${a.id} [${a.status}] ${a.text}${a.resolution && a.resolution !== '—' ? ` → ${a.resolution}` : ''}`);
    }
    for (const q of questions) {
      const mark = q.status === 'aberta' ? '?' : '✔';
      console.log(`  ${mark} ${q.id} [${q.status}] ${q.text}${q.answer && q.answer !== '—' ? ` → ${q.answer}` : ''}`);
    }
  }
  if (!any) console.log('nenhuma suposição ou pergunta registrada — isso é suspeito: quase toda feature esconde uma.');
  return 0;
}

const HELP_LICOES = `onp-spec licoes — lições aprendidas com lastro mecânico

O agente entra com o julgamento (frasear a regra geral); o motor valida o
lastro: uma lição só entra se cita um sinal REAL registrado por audit/verify
em .spec/verification/sinais.json. Sem sinal, é opinião — recusada.

subcomandos:
  add --sinal <CODIGO> --feature <feature> --fonte <AC-xxx|arquivo>
      --texto "regra geral em uma frase" [--escopo <dominio>]
                     registra uma lição (candidata); ao recorrer em outra
                     feature, o motor promove a confirmada
  list [--status confirmada|candidata|quarentena|todas] [--escopo <dominio>]
       [--query <termo>] [--limite N]
                     lições para carregar no Especificar/Projetar
                     (default: só confirmadas, no máximo ${LICOES_DEFAULTS.limiteListagem})
  sugerir [--limite N]
                     mineração mecânica: sinais recorrentes em features
                     distintas que ainda não têm lição
  penalizar --id L-xxx
                     a lição foi aplicada e a falha recorreu; 2 penalidades
                     movem para quarentena
  status             contagens por status + caminhos dos arquivos`;

function linhaLicao(l) {
  const escopo = l.escopo ? ` · escopo ${l.escopo}` : '';
  return `${l.id} [${l.status}] (${l.recorrencia} feature(s) · ${l.sinal}${escopo}) ${l.texto}`;
}

function cmdLicoes(config, positional, flags) {
  const specRoot = path.join(config.rootDir, config.specDir);
  if (!existsSync(specRoot)) {
    console.error(`diretório ${config.specDir}/ não encontrado — rode \`onp-spec init\` primeiro`);
    return 2;
  }
  const sub = positional[0];
  const cfg = config.licoes;
  const data = carregarLicoes(specRoot);

  if (!sub || sub === 'help') {
    console.log(HELP_LICOES);
    return 0;
  }

  if (sub === 'add') {
    const sinais = carregarSinais(specRoot);
    const resultado = adicionarLicao(
      data,
      sinais,
      {
        texto: flags.texto,
        sinal: flags.sinal,
        feature: flags.feature,
        fonte: flags.fonte,
        escopo: flags.escopo,
      },
      cfg
    );
    if (resultado.erro) {
      console.error(`erro: ${resultado.erro}`);
      return 2;
    }
    const podadas = podarLicoes(data, cfg);
    salvarLicoes(specRoot, data);
    const { licao, evento } = resultado;
    const rotulo = {
      criada: `✔ ${licao.id} registrada como candidata (1 feature) — vira confirmada ao recorrer em ${cfg.limiarPromocao - 1} outra(s)`,
      reforcada: `✔ ${licao.id} reforçada (${licao.recorrencia} feature(s): ${licao.features.join(', ')})`,
      promovida: `★ ${licao.id} PROMOVIDA a confirmada (${licao.features.join(', ')}) — entra no guia de Especificar/Projetar`,
    }[evento];
    console.log(rotulo);
    if (podadas.length) console.log(`· podadas por estagnação: ${podadas.join(', ')}`);
    return 0;
  }

  if (sub === 'list') {
    const licoes = listarLicoes(data, {
      status: flags.status || 'confirmada',
      escopo: typeof flags.escopo === 'string' ? flags.escopo : null,
      query: typeof flags.query === 'string' ? flags.query : null,
      limite: parseInt(flags.limite, 10) || cfg.limiteListagem,
    });
    if (!licoes.length) {
      console.log(
        flags.status && flags.status !== 'confirmada'
          ? 'nenhuma lição com esse filtro'
          : 'nenhuma lição confirmada ainda — candidatas viram confirmadas ao recorrer em features distintas (onp-spec licoes list --status todas)'
      );
      return 0;
    }
    for (const l of licoes) console.log(linhaLicao(l));
    return 0;
  }

  if (sub === 'sugerir') {
    const sinais = carregarSinais(specRoot);
    const sugestoes = sugerirLicoes(data, sinais, cfg, {
      limite: parseInt(flags.limite, 10) || 5,
    });
    if (!sugestoes.length) {
      console.log(
        `nenhum sinal recorrente em ${cfg.limiarPromocao}+ features distintas — nada digno de lição por ora (caminho limpo não gera lição; isso é correto)`
      );
      return 0;
    }
    console.log('sinais recorrentes — o motor aponta ONDE vale uma lição; o fraseado é seu:');
    for (const s of sugestoes) {
      console.log(
        `  ${s.sinal} — ${s.features.length} feature(s) distintas · ${s.ocorrencias} ocorrência(s) · lições existentes: ${s.licoesExistentes}`
      );
      console.log(`    features: ${s.features.slice(0, 6).join(', ')}${s.features.length > 6 ? ` (+${s.features.length - 6})` : ''}`);
      console.log(`    refs: ${s.refs.join(', ')}`);
    }
    console.log('\nregistre com: onp-spec licoes add --sinal <CODIGO> --feature <f> --fonte <ref> --texto "..."');
    return 0;
  }

  if (sub === 'penalizar') {
    if (typeof flags.id !== 'string') {
      console.error('uso: onp-spec licoes penalizar --id L-xxx');
      return 2;
    }
    const resultado = penalizarLicao(data, flags.id, cfg);
    if (resultado.erro) {
      console.error(`erro: ${resultado.erro}`);
      return 2;
    }
    salvarLicoes(specRoot, data);
    const { licao, evento } = resultado;
    console.log(
      evento === 'quarentenada'
        ? `✘ ${licao.id} movida para QUARENTENA (${licao.penalidades} penalidades) — sai do guia; revisão é do usuário`
        : `⚠ ${licao.id} penalizada (${licao.penalidades}/${cfg.limiarQuarentena}) — mais ${cfg.limiarQuarentena - licao.penalidades} move para quarentena`
    );
    return 0;
  }

  if (sub === 'status') {
    const contagem = { confirmada: 0, candidata: 0, quarentena: 0 };
    for (const l of data.licoes) contagem[l.status] = (contagem[l.status] || 0) + 1;
    const sinais = carregarSinais(specRoot);
    console.log(
      `lições: ${contagem.confirmada} confirmada(s) · ${contagem.candidata} candidata(s) · ${contagem.quarentena} em quarentena`
    );
    console.log(`sinais no histórico: ${Object.keys(sinais.sinais).length} ponto(s) de falha distintos`);
    console.log(`arquivos: ${config.specDir}/licoes.json (canônico) · ${config.specDir}/LICOES.md (leitura)`);
    return 0;
  }

  console.error(`subcomando desconhecido: licoes ${sub}\n`);
  console.log(HELP_LICOES);
  return 2;
}

export async function run(argv) {
  const [command, ...rest] = argv;
  const { flags, positional } = parseFlags(rest);
  const rootDir = process.cwd();

  if (!command || command === 'help' || flags.help) {
    console.log(HELP);
    return 0;
  }

  if (command === 'version' || flags.version) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
      console.log(pkg.version || 'embarcada (skill onp-spec-driven)');
    } catch {
      // motor embarcado na skill não carrega package.json
      console.log('embarcada (skill onp-spec-driven)');
    }
    return 0;
  }

  if (command === 'init') return cmdInit(rootDir, flags);
  if (command === 'new') return cmdNew(rootDir, positional[0], flags);

  const config = loadConfig(rootDir);

  // lições não precisam do projeto carregado — em repos grandes, listar o
  // guia no início do Especificar tem que ser barato
  if (command === 'licoes') return cmdLicoes(config, positional, flags);
  // tarefa idem: edição pontual de status/modelo/esforço no tasks.md
  if (command === 'tarefa') return cmdTarefa(config, positional, flags);
  // comandos internos do executar-tarefas.sh (alimentam/leem o ledger global)
  if (command === 'evento') return cmdEvento(flags);
  if (command === 'stream-resumo') return cmdStreamResumo(positional);
  // resumo geral de andamento: só precisa do ledger, não do projeto carregado
  if (command === 'resumo') return cmdResumo(config, positional, flags);

  if (command === 'harness') {
    const det = detectarAgente(rootDir, flags.agents);
    if (det.erro) throw new Error(det.erro);
    const options = { cwd: rootDir, command: config.paralelo.command, modelsCommand: config.paralelo.modelsCommand, quotaCommand: config.paralelo.quotaCommand };
    const [models, quota] = await Promise.all([discoverModels(det.agent, options), readQuota(det.agent, options)]);
    console.log(JSON.stringify({ harness: det.agent, capabilities: HARNESS_CAPABILITIES[det.agent], models, quota }, null, 2));
    return 0;
  }
  if (command === 'impacto') {
    const feature = positional[0];
    if (!feature) throw new Error('uso: onp-spec impacto <feature> [--revisao arquivo.json|--decisao arquivo.json]');
    if (flags.revisao && flags.decisao) throw new Error('Registre revisão e decisão em comandos separados.');
    if (flags.revisao) recordImpactReview(rootDir, feature, { ...JSON.parse(readFileSync(path.resolve(rootDir, flags.revisao), 'utf8')), specDir: config.specDir });
    if (flags.decisao) recordGovernanceDecision(rootDir, feature, { ...JSON.parse(readFileSync(path.resolve(rootDir, flags.decisao), 'utf8')), specDir: config.specDir });
    const result = checkGovernance(rootDir, feature, { specDir: config.specDir });
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  if (command === 'executar' || command === 'worktrees') {
    const feature = positional[0];
    if (!feature || !/^[a-z0-9][a-z0-9-]*$/.test(feature)) throw new Error('Informe uma feature válida.');
    if (command === 'worktrees') {
      if (flags.run !== undefined && (typeof flags.run !== 'string' || !/^[\w.-]+$/.test(flags.run))) throw new Error('Informe um identificador válido em --run.');
      const owned = listExecutionPlans(rootDir, { feature, onWarning: (message) => console.error(`· ${message}`) });
      const plans = flags.run ? owned.filter((plan) => plan.runId === flags.run) : owned;
      if (flags.run && !plans.length) throw new Error('Execução não encontrada no histórico desta feature.');
      if (flags.limpar) {
        if (plans.length > 1) throw new Error('Há mais de uma execução: liste os worktrees e escolha --run <id> antes de confirmar a limpeza.');
        const result = plans.length
          ? { runId: plans[0].runId, ...cleanupExecutionWorktrees(rootDir, plans[0], { confirmed: flags.confirmar === true }) }
          : { removed: [], preserved: [] };
        console.log(JSON.stringify(result, null, 2));
      } else {
        const items = plans.flatMap((plan) => listExecutionWorktrees(rootDir, plan).map((item) => ({ ...item, runId: plan.runId })));
        console.log(JSON.stringify(items, null, 2));
      }
      return 0;
    }
    const plan = selectExecutionPlan(rootDir, feature, { specDir: config.specDir, runId: flags.run });
    if ([flags.faixa, flags.seq, flags.gate, flags.listar].filter(Boolean).length > 1) throw new Error('Escolha apenas um alvo de execução.');
    const result = await executePlan(rootDir, plan, { lane: flags.faixa, task: flags.seq, gate: flags.gate, list: flags.listar });
    if (flags.listar) console.log(JSON.stringify(result, null, 2));
    return result.code;
  }

  const project = loadProject(config);

  if (command === 'plano') return cmdPlano(project, positional, flags);

  if (command === 'audit') {
    const audit = auditProject(project, { ci: Boolean(flags.ci) });
    if (flags.json) {
      console.log(renderJson(audit));
    } else {
      console.log(renderTerminal(audit));
    }
    if (flags.md) {
      const outPath = typeof flags.md === 'string' ? flags.md : '.spec/AUDITORIA.md';
      writeFileSync(path.join(rootDir, outPath), renderMarkdown(audit));
      console.log(`relatório salvo em ${outPath}`);
    }
    const registrados = registrarAchados(project.specRoot, audit.findings, {
      gitRev: gitRev(rootDir),
      ...config.licoes,
    });
    if (registrados) {
      console.log(
        `${registrados} sinal(is) registrados no histórico — depois de corrigir: onp-spec licoes sugerir`
      );
    }
    return audit.exitCode;
  }

  if (command === 'verify') {
    const featureName = positional[0];
    if (!featureName) {
      console.error('uso: onp-spec verify <feature>');
      return 2;
    }
    const { record, hint } = runVerify(project, featureName);
    const sinaisFalha = registrarVerify(project.specRoot, record, config.licoes);
    const total = Object.keys(record.results).length;
    const passed = Object.values(record.results).filter((r) => r.status === 'pass').length;
    console.log(
      `verify ${featureName}: ${passed}/${total} critério(s) de aceite com prova PASS · ${record.testsParsed} teste(s) lidos · exit ${record.exitCode}`
    );
    for (const [acId, r] of Object.entries(record.results)) {
      const mark = r.status === 'pass' ? '✔' : r.status === 'skip' ? '○ SKIP (não é prova)' : '✘';
      console.log(`  ${mark} ${acId} ${r.testName ? `— ${r.testName}` : ''}`);
    }
    if (hint) console.log(`  dica: ${hint}`);
    const principles = Object.entries(record.principles || {});
    if (principles.length) {
      console.log('  princípios:');
      for (const [pId, r] of principles) {
        console.log(`  ${r.status === 'pass' ? '✔' : '✘'} ${pId} — ${r.testName}`);
      }
    }
    if (sinaisFalha) {
      console.log(`  ${sinaisFalha} sinal(is) de falha/skip registrados no histórico`);
    }
    console.log(`prova gravada em .spec/verification/${featureName}.json — rode \`onp-spec audit\``);
    return passed === total && total > 0 ? 0 : 1;
  }

  if (command === 'scaffold') {
    const featureName = positional[0];
    if (!featureName) {
      console.error('uso: onp-spec scaffold <feature> [--force]');
      return 2;
    }
    const result = scaffoldTests(project, featureName, { force: Boolean(flags.force) });
    if (result.created) {
      console.log(`✔ ${result.created} criado com ${result.pending} teste(s)-esqueleto (todos FALHAM até você implementar)`);
      console.log(`  critérios cobertos: ${result.acIds.join(', ')}`);
    } else {
      console.log(result.message);
    }
    return 0;
  }

  if (command === 'status') return cmdStatus(project);
  if (command === 'assumptions') return cmdAssumptions(project);

  console.error(`comando desconhecido: ${command}\n`);
  console.log(HELP);
  return 2;
}
