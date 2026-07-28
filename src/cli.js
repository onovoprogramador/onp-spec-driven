// CLI onp-spec — dispatch de comandos.

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, chmodSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { montarPlano, renderPlanoMd, renderPlanoSh, renderPlanoHtml } from './core/plano.js';
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

function resolveSkillDir(agent = 'claude') {
  const dirName = agent === 'antigravity' ? 'onp-spec-driven-antigravity' : 'onp-spec-driven';
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
  init [--preset base|lgpd-educacao] [--agents claude|antigravity]
                      cria .spec/, constituição e config no diretório atual
                      (--agents também instala a skill do agente escolhido)
  new <feature>       cria .spec/features/<feature>/ com spec.md e tasks.md
  plano <feature> [--agents claude|antigravity]
                      plano de execução: agrupa tarefas em faixas PARALELAS
                      (arquivos disjuntos → 1 worktree + 1 branch + 1 janela
                      limpa por faixa) e gera os artefatos de execução
                      · sempre: plano-execucao.md (faixas, branches, commits)
                      · claude: executar-tarefas.sh (claude -p headless com
                        --model/--effort por tarefa) + plano-execucao.html
                        (visual, botão "Executar todas as tarefas...")
                      · antigravity: prompts prontos por faixa p/ os agentes
                        paralelos nativos (não depende do CLI do Claude)
  tarefa <feature> <T-xxx> <status>
                      atualiza o status da tarefa no tasks.md
                      (pendente | em-andamento | concluida)
  audit [--ci] [--json] [--md <arquivo>]
                      audita especificação ↔ tarefas ↔ testes ↔ código ↔ constituição
                      exit 1 se houver erro (use no CI)
  verify <feature>    roda os testes e grava a prova de cada critério de aceite
                      (quem decide é o test runner)
  scaffold <feature> [--force]
                      gera esqueleto de teste (que falha) para cada critério
                      de aceite ainda sem teste
  status              painel: features, critérios provados, suposições e
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
    if (agent !== 'claude' && agent !== 'antigravity') {
      console.error(`--agents desconhecido: "${flags.agents}" (use: claude, antigravity)`);
      return 2;
    }
    const rotulo = agent === 'claude' ? 'Claude Code' : 'Antigravity';
    const destRel = path.join(agent === 'claude' ? '.claude' : '.agents', 'skills', 'onp-spec-driven');
    const dest = path.join(rootDir, destRel);
    const skillDir = resolveSkillDir(agent);
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
// senão, o próprio caminho do motor embarcado denuncia (.claude/ vs .agents/);
// senão, o que estiver instalado no projeto; default: claude.
function detectarAgente(rootDir, flag) {
  if (flag !== undefined && flag !== true) {
    if (flag !== 'claude' && flag !== 'antigravity') return { erro: `--agents desconhecido: "${flag}" (use: claude, antigravity)` };
    return { agent: flag };
  }
  const segmentos = __dirname.split(path.sep);
  if (segmentos.includes('.agents')) return { agent: 'antigravity' };
  if (segmentos.includes('.claude')) return { agent: 'claude' };
  const temAg = existsSync(path.join(rootDir, '.agents', 'skills', 'onp-spec-driven'));
  const temClaude = existsSync(path.join(rootDir, '.claude', 'skills', 'onp-spec-driven'));
  if (temAg && !temClaude) return { agent: 'antigravity' };
  return { agent: 'claude' };
}

function cmdPlano(project, positional, flags) {
  const featureName = positional[0];
  if (!featureName) {
    console.error('uso: onp-spec plano <feature> [--agents claude|antigravity]');
    return 2;
  }
  const det = detectarAgente(project.config.rootDir, flags.agents);
  if (det.erro) {
    console.error(det.erro);
    return 2;
  }
  const plan = montarPlano(project, featureName, {
    agent: det.agent,
    enginePath: process.argv[1],
  });
  if (plan.erro) {
    console.error(`erro: ${plan.erro}`);
    return 2;
  }

  const dir = path.join(project.config.rootDir, plan.baseDir);
  writeFileSync(path.join(dir, 'plano-execucao.md'), renderPlanoMd(plan));
  const gerados = [`${plan.baseDir}/plano-execucao.md`];
  if (plan.agent === 'claude') {
    const sh = path.join(dir, 'executar-tarefas.sh');
    writeFileSync(sh, renderPlanoSh(plan));
    chmodSync(sh, 0o755);
    writeFileSync(path.join(dir, 'plano-execucao.html'), renderPlanoHtml(plan));
    gerados.push(`${plan.baseDir}/executar-tarefas.sh`, `${plan.baseDir}/plano-execucao.html`);
  }

  const paralelas = plan.faixas.reduce((n, fx) => n + fx.tasks.length, 0);
  console.log(
    `✔ plano de execução (${det.agent}): ${paralelas + plan.sequenciais.length} tarefa(s) — ` +
      `${paralelas} em ${plan.faixas.length} faixa(s) paralela(s) · ${plan.sequenciais.length} sequencial(is) · ${plan.ondas.length} onda(s)`
  );
  console.log('\nonde está cada coisa:');
  console.log(`  · plano (leia primeiro): ${gerados[0]}`);
  if (plan.agent === 'claude') {
    console.log(`  · executor headless:     ${gerados[1]}`);
    console.log(`  · visual com botão:      ${gerados[2]}`);
  }
  for (const a of plan.avisos) console.log(`  ⚠ ${a}`);
  console.log('\npróximo passo:');
  if (plan.agent === 'claude') {
    console.log(`  bash ${plan.baseDir}/executar-tarefas.sh`);
    console.log(`  (ou abra o plano-execucao.html e use o botão — ele copia esse comando)`);
  } else {
    console.log(`  abra um agente novo (janela limpa) por faixa e cole o prompt correspondente`);
    console.log(`  do plano-execucao.md — depois merge + verify + audit, como descrito lá`);
  }
  return 0;
}

function cmdTarefa(config, positional) {
  const [featureName, taskId, statusRaw] = positional;
  if (!featureName || !taskId || !statusRaw) {
    console.error('uso: onp-spec tarefa <feature> <T-xxx> <pendente|em-andamento|concluida>');
    return 2;
  }
  const status = foldStatus(statusRaw);
  if (!TASK_STATUSES.includes(status)) {
    console.error(`status inválido: "${statusRaw}" (use: ${TASK_STATUSES.join(', ')})`);
    return 2;
  }
  const tasksPath = path.join(config.rootDir, config.specDir, 'features', featureName, 'tasks.md');
  if (!existsSync(tasksPath)) {
    console.error(`não achei ${config.specDir}/features/${featureName}/tasks.md`);
    return 2;
  }
  const conteudo = readFileSync(tasksPath, 'utf-8');
  const re = new RegExp(`^(##\\s+${taskId}\\s*${DASH}\\s*.*?)(\\s*\\[[^\\]]+\\])?\\s*$`, 'm');
  if (!re.test(conteudo)) {
    console.error(`tarefa ${taskId} não encontrada em ${config.specDir}/features/${featureName}/tasks.md`);
    return 2;
  }
  writeFileSync(tasksPath, conteudo.replace(re, `$1 [${status}]`));
  console.log(`✔ ${taskId} → [${status}] em ${config.specDir}/features/${featureName}/tasks.md`);
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
  // tarefa idem: edição pontual de status no tasks.md (usada pelo executor)
  if (command === 'tarefa') return cmdTarefa(config, positional);

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
