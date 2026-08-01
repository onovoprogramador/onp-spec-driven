// CLI onp-spec — dispatch de comandos.

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, chmodSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  montarPlano,
  renderPlanoMd,
  renderPlanoSh,
  renderPlanoHtml,
  renderPlanoJson,
  usaExecutorSh,
  normalizarEsforco,
  AGENTES,
} from './core/plano.js';
import { registrarEvento, podarLedger, lerStream, lerEventos, montarArvore } from './core/ledger.js';
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
};

// diretório de skills que cada agente lê DENTRO do projeto (o nome da pasta
// da skill instalada é sempre onp-spec-driven — no Cursor o `name:` do
// frontmatter TEM que ser igual ao nome da pasta)
const SKILLS_DIR_PROJETO = {
  claude: '.claude',
  antigravity: '.agents',
  codex: '.agents',
  cursor: '.cursor',
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

const HELP = `onp-spec — spec-anchored development (a especificação que continua verdadeira)

uso: onp-spec <comando> [opções]

comandos:
  init [--preset base|lgpd-educacao] [--agents claude|antigravity|codex|cursor]
                      cria .spec/, constituição e config no diretório atual
                      (--agents também instala a skill do agente escolhido)
  new <feature>       cria .spec/features/<feature>/ com spec.md e tasks.md
  plano <feature> [--agents claude|antigravity|codex|cursor] [--paralelizar T-xxx,T-yyy]
                  [--sequencial] [--modelo <modelo>] [--esforco <nível>]
                      plano de execução. Default: agrupa tarefas em faixas
                      PARALELAS (arquivos disjuntos → 1 worktree + 1 branch +
                      1 janela limpa por faixa). Com --paralelizar: só as
                      tarefas ESCOLHIDAS entram nas faixas (o resto roda uma
                      após a outra, ao final). Com --sequencial: tudo uma
                      tarefa após a outra, na árvore principal. QUAIS tarefas
                      paralelizar é escolha do USUÁRIO (o agente pergunta
                      antes de executar).
                      · sempre: plano-execucao.md (faixas/ordem, branches,
                        commits) + plano.json
                      · claude: executar-tarefas.sh (claude -p headless com
                        --model/--effort por tarefa e resumo de andamento a
                        cada 1 min no terminal) + plano-execucao.html (visual)
                      · codex: executar-tarefas.sh (codex exec headless com
                        --json, sandbox e --model/model_reasoning_effort por
                        tarefa) + plano-execucao.html (visual)
                      · cursor: executar-tarefas.sh (CLI do Cursor headless:
                        agent -p com --model por tarefa, stream-json e
                        --force; esforço vai no slug do modelo) +
                        plano-execucao.html (visual)
                      · antigravity: prompts prontos p/ os agentes nativos
                        (não depende de CLI nenhum)
                      Custo é escolha do USUÁRIO: --modelo/--esforco travam
                      modelo e esforço de TODAS as tarefas (vencem tasks.md e
                      config) — o agente confirma modelos/esforços com o
                      usuário ANTES de executar
  resumo [feature] [--tabela] [--global] [--run <runId>]
         [--gravar [--texto "..."] [--origem ia|motor]]
                      o RESUMO GERAL DE ANDAMENTO em texto: o que está
                      rodando agora, o que terminou, o que falhou. É o texto
                      que o agente posta no chat a cada ~1 min enquanto houver
                      execução. --tabela imprime a TABELA de andamento em
                      markdown (uma linha por tarefa: onde roda, status e
                      última ação) — pronta para colar no chat junto com o
                      texto. --gravar registra no ledger (com --texto, é a
                      IA/agente escrevendo; sem, vale o do motor).
  tarefa <feature> <T-xxx> [status] [--modelo <modelo>] [--esforco <nível>]
                      atualiza a tarefa no tasks.md: status (pendente |
                      em-andamento | concluida) e/ou o custo dela (--modelo e
                      --esforco definem Modelo:/Esforço: — regenere o plano
                      depois)
  audit [--ci] [--json] [--md <arquivo>]
                      audita especificação ↔ tarefas ↔ testes ↔ código ↔ constituição
                      exit 1 se houver erro (use no CI)
  verify <feature>    roda os testes e grava a prova de cada critério de aceite
                      (quem decide é o test runner)
  scaffold <feature> [--force]
                      gera esqueleto de teste (que falha) para cada critério
                      de aceite ainda sem teste
  status              visão geral: features, critérios provados, suposições e
                      perguntas abertas
  assumptions         lista todas as suposições e perguntas com status
  licoes <add|list|sugerir|penalizar|status>
                      lições aprendidas COM LASTRO: só entra lição ancorada em
                      sinal real do audit/verify; promoção mecânica ao recorrer
                      em features distintas (detalhes: onp-spec licoes)
  help                esta ajuda

fluxo típico:
  onp-spec init --preset lgpd-educacao
  onp-spec new entrega-dever-casa      # escreva histórias, critérios, suposições e perguntas
  onp-spec scaffold entrega-dever-casa # cada critério vira um teste que falha
  onp-spec plano entrega-dever-casa    # tarefas em faixas paralelas + artefatos de execução
  ... execute o plano (ou implemente à mão) até os testes passarem ...
  onp-spec verify entrega-dever-casa   # o test runner grava a prova
  onp-spec audit --ci                  # 0 = especificação e código alinhados`;

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

  const specRoot = path.join(rootDir, '.spec');
  mkdirSync(path.join(specRoot, 'features'), { recursive: true });
  mkdirSync(path.join(specRoot, 'verification'), { recursive: true });

  const constitutionPath = path.join(specRoot, 'constituicao.md');
  if (existsSync(constitutionPath)) {
    console.log('· .spec/constituicao.md já existe — mantido');
  } else {
    writeFileSync(constitutionPath, template(presetFile));
    console.log(`✔ .spec/constituicao.md criado (preset: ${preset})`);
  }

  const configPath = path.join(rootDir, 'onpspec.config.json');
  if (existsSync(configPath)) {
    console.log('· onpspec.config.json já existe — mantido');
  } else {
    const cfg = {
      testCommand: 'node --test',
      reporter: 'tap',
      testGlobs: DEFAULT_CONFIG.testGlobs,
      srcGlobs: DEFAULT_CONFIG.srcGlobs,
    };
    writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
    console.log('✔ onpspec.config.json criado (testCommand: "node --test" — ajuste à sua stack)');
  }

  const gitignorePath = path.join(specRoot, 'verification', '.gitkeep');
  if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, '');

  if (flags.agents !== undefined) {
    const agent = flags.agents === true ? 'claude' : flags.agents;
    if (!AGENTES.includes(agent)) {
      console.error(`--agents desconhecido: "${flags.agents}" (use: ${AGENTES.join(', ')})`);
      return 2;
    }
    const rotulo = { claude: 'Claude Code', antigravity: 'Antigravity', codex: 'Codex', cursor: 'Cursor' }[agent];
    // Cada agente lê seu diretório de skills no projeto (.claude, .cursor);
    // Codex e Antigravity leem o MESMO (.agents/skills — o padrão cross-agent
    // que o Codex adota). O marcador `agent:` no frontmatter diz de quem é a
    // skill instalada.
    const destRel = path.join(SKILLS_DIR_PROJETO[agent], 'skills', 'onp-spec-driven');
    const dest = path.join(rootDir, destRel);
    const skillDir = resolveSkillDir(agent);
    const marcadorExistente = skillAgentMarker(dest);
    if (marcadorExistente && marcadorExistente !== agent) {
      const nota =
        SKILLS_DIR_PROJETO[agent] === '.agents' ? ' — Codex e Antigravity compartilham esse diretório.' : '.';
      console.error(
        `✘ ${destRel} já contém a skill do agente "${marcadorExistente}"${nota}\n` +
          `  Para trocar de agente, remova a pasta antes: rm -rf ${destRel}`
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
      copyDirIfExists(skillDir, dest);
      console.log(`✔ skill instalada em ${destRel} (${rotulo})`);
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
              `  Se este projeto é do Cursor, remova a outra: rm -rf ${outroDir}/skills/onp-spec-driven`
          );
        }
      }
    }
  }

  console.log('\npróximo passo: onp-spec new <nome-da-feature>');
  return 0;
}

function copyDirIfExists(src, dest) {
  if (!existsSync(src)) return;
  cpSync(src, dest, { recursive: true });
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
  const dir = path.join(rootDir, '.spec', 'features', name);
  if (existsSync(path.join(dir, 'spec.md'))) {
    console.error(`feature "${name}" já existe em .spec/features/${name}/`);
    return 2;
  }
  mkdirSync(dir, { recursive: true });

  // IDs únicos no projeto: continua a numeração a partir do maior ID existente
  const config = loadConfig(rootDir);
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
  writeFileSync(path.join(dir, 'spec.md'), spec);

  let tasks = template('tasks.md');
  tasks = fill(tasks, { TITULO: titulo, FEATURE: name });
  tasks = tasks
    .replace('US-001, AC-001', `US-${pad(maxUs + 1)}, AC-${pad(maxAc + 1)}`);
  writeFileSync(path.join(dir, 'tasks.md'), tasks);

  console.log(`✔ .spec/features/${name}/spec.md`);
  console.log(`✔ .spec/features/${name}/tasks.md`);
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
  if (segmentos.includes('.claude')) return { agent: 'claude' };
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
  const dir = path.join(project.config.rootDir, plan.baseDir);
  writeFileSync(path.join(dir, 'plano-execucao.md'), renderPlanoMd(plan));
  const planoJson = renderPlanoJson(plan);
  writeFileSync(path.join(dir, 'plano.json'), planoJson);
  const gerados = [`${plan.baseDir}/plano-execucao.md`, `${plan.baseDir}/plano.json`];
  if (usaExecutorSh(plan.agent)) {
    const sh = path.join(dir, 'executar-tarefas.sh');
    writeFileSync(sh, renderPlanoSh(plan));
    chmodSync(sh, 0o755);
    writeFileSync(path.join(dir, 'plano-execucao.html'), renderPlanoHtml(plan));
    gerados.push(`${plan.baseDir}/executar-tarefas.sh`, `${plan.baseDir}/plano-execucao.html`);
  }
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
  podarLedger();
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
      '⚠ o CLI do Cursor não tem flag de esforço — o valor fica registrado no plano, mas o nível vai no slug do modelo (ex.: gpt-5.6-terra-high)'
    );
  }
  if (flags.modelo === true) {
    console.error('erro: --modelo precisa de um valor (ex.: --modelo gpt-5.6-luna)');
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
    console.log(`  · executor headless:     ${plan.baseDir}/executar-tarefas.sh`);
    console.log(`  · visual (leitura):      ${plan.baseDir}/plano-execucao.html`);
  }
  for (const a of plan.avisos) console.log(`  ⚠ ${a}`);
  // custo é do usuário: no codex e no cursor, o agente apresenta modelo (e
  // esforço, quando o CLI o aceita) por tarefa e CONFIRMA antes de executar
  // (licença barata torra tokens fácil)
  if (det.agent === 'codex') {
    console.log('\nmodelos e esforços deste plano — CONFIRME com o usuário antes de executar (os tokens são dele):');
    const todas = [...plan.faixas.flatMap((fx) => fx.tasks), ...plan.sequenciais];
    for (const t of todas) console.log(`  · ${t.id} — ${t.model} · esforço ${t.esforcoCli}`);
    console.log(
      `  quer gastar menos? tudo: onp-spec plano ${featureName} --modelo gpt-5.6-luna --esforco baixo` +
        `\n  por tarefa: onp-spec tarefa ${featureName} T-xxx --modelo <m> --esforco <nível> (e regenere o plano)`
    );
  }
  if (det.agent === 'cursor') {
    console.log('\nmodelos deste plano — CONFIRME com o usuário antes de executar (os tokens são dele):');
    const todas = [...plan.faixas.flatMap((fx) => fx.tasks), ...plan.sequenciais];
    for (const t of todas) console.log(`  · ${t.id} — ${t.model}`);
    console.log(
      '  (esforço no Cursor vai embutido no slug do modelo, ex.: gpt-5.6-terra-high — não existe flag)' +
        `\n  quer gastar menos? tudo: onp-spec plano ${featureName} --modelo composer (uso incluído nos planos pagos do Cursor)` +
        `\n  por tarefa: onp-spec tarefa ${featureName} T-xxx --modelo <m> (e regenere o plano)`
    );
  }
  console.log('\npróximo passo:');
  if (usaExecutorSh(plan.agent)) {
    console.log(`  · executar: bash ${plan.baseDir}/executar-tarefas.sh`);
    console.log('    (enquanto roda, o resumo geral de andamento sai a cada 1 min — repasse ao usuário)');
  } else {
    console.log(`  · abra um agente novo (janela limpa) por faixa e cole o prompt correspondente`);
    console.log(`    do plano-execucao.md — depois merge + verify + audit, como descrito lá`);
  }
  return 0;
}

// `onp-spec resumo` — o RESUMO GERAL DE ANDAMENTO. É o texto que o agente
// posta no chat a cada ~1 minuto enquanto houver execução. Sem flags, imprime
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

  // a TABELA de andamento (markdown) — o agente cola no chat a cada ~1 min
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
  let conteudo = readFileSync(tasksPath, 'utf-8');
  const re = new RegExp(`^(##\\s+${taskId}\\s*${DASH}\\s*.*?)(\\s*\\[[^\\]]+\\])?\\s*$`, 'm');
  if (!re.test(conteudo)) {
    console.error(`tarefa ${taskId} não encontrada em ${config.specDir}/features/${featureName}/tasks.md`);
    return 2;
  }
  const mudancas = [];
  if (status) {
    conteudo = conteudo.replace(re, `$1 [${status}]`);
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
  writeFileSync(tasksPath, conteudo);
  console.log(`✔ ${taskId} ${mudancas.join(' · ')} em ${config.specDir}/features/${featureName}/tasks.md`);
  if (modelo || esforcoRaw) {
    console.log(`· modelo/esforço mudou — regenere o plano: onp-spec plano ${featureName}`);
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
      console.log(pkg.version);
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
