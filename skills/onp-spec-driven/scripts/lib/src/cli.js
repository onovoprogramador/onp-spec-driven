// CLI onp-spec — dispatch de comandos.

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
// embarcado (este arquivo em <skill>/scripts/lib/src → a skill é ../../..)
function resolveSkillDir() {
  const candidates = [
    path.join(__dirname, '..', 'skills', 'onp-spec-driven'),
    path.join(__dirname, '..', '..', '..'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'SKILL.md'))) return dir;
  }
  return null;
}
const SKILL_DIR = resolveSkillDir();

const HELP = `onp-spec — spec-anchored development (a spec que continua verdadeira)

uso: onp-spec <comando> [opções]

comandos:
  init [--preset base|lgpd-educacao] [--agents claude]
                      cria .spec/, constituição e config no diretório atual
  new <feature>       cria .spec/features/<feature>/ com spec.md e tasks.md
  audit [--ci] [--json] [--md <arquivo>]
                      audita spec ↔ tasks ↔ testes ↔ código ↔ constituição
                      exit 1 se houver erro (use no CI)
  verify <feature>    roda os testes e grava a prova por AC (quem decide é o runner)
  scaffold <feature> [--force]
                      gera esqueleto de teste (que falha) para cada AC sem teste
  status              painel: features, ACs provados, suposições/perguntas abertas
  assumptions         lista todas as suposições e perguntas com status
  licoes <add|list|sugerir|penalizar|status>
                      lições aprendidas COM LASTRO: só entra lição ancorada em
                      sinal real do audit/verify; promoção mecânica ao recorrer
                      em features distintas (detalhes: onp-spec licoes)
  help                esta ajuda

fluxo típico:
  onp-spec init --preset lgpd-educacao
  onp-spec new entrega-dever-casa     # escreva a spec (US/AC/ASM/Q)
  onp-spec scaffold entrega-dever-casa # DoD vira teste que falha
  ... implemente até os testes passarem ...
  onp-spec verify entrega-dever-casa  # runner grava a prova
  onp-spec audit --ci                 # 0 = spec e código alinhados`;

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

  if (flags.agents === 'claude' || flags.agents === true) {
    const dest = path.join(rootDir, '.claude', 'skills', 'onp-spec-driven');
    if (!SKILL_DIR) {
      console.log('· skill não encontrada junto ao motor — nada a instalar');
    } else if (path.resolve(dest) === path.resolve(SKILL_DIR)) {
      console.log('· skill já instalada em .claude/skills/onp-spec-driven — mantida');
    } else {
      copyDirIfExists(SKILL_DIR, dest);
      console.log('✔ skill instalada em .claude/skills/onp-spec-driven (Claude Code)');
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
  console.log(`\npróximos passos:\n  1. escreva US/AC (Dado/Quando/Então) e PREENCHA Suposições e Perguntas`);
  console.log(`  2. onp-spec scaffold ${name}   # DoD vira teste executável`);
  console.log(`  3. onp-spec audit              # veja o que falta`);
  return 0;
}

function cmdStatus(project) {
  if (project.errors.length) {
    for (const e of project.errors) console.error(`erro: ${e}`);
    return 2;
  }
  const testFileSet = new Set(project.testFiles);
  const provenTags = project.annotations.specTags.filter((t) => testFileSet.has(t.file));

  console.log('feature                        status             ACs teste  prova  ASM?  Q?');
  console.log('─'.repeat(88));
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
    console.log(
      `${feature.name.padEnd(30)} ${(spec.status || '—').padEnd(18)} ${String(acs.length).padStart(3)} ` +
        `${String(withTest).padStart(5)} ${String(proven).padStart(6)} ${String(asmOpen).padStart(4)} ${String(qOpen).padStart(3)}`
    );
  }
  console.log('\nlegenda: teste = ACs com @spec:tag · prova = PASS no último verify · ASM?/Q? = abertas');
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

  const project = loadProject(config);

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
      `verify ${featureName}: ${passed}/${total} AC(s) com prova PASS · ${record.testsParsed} teste(s) lidos · exit ${record.exitCode}`
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
      console.log(`  ACs: ${result.acIds.join(', ')}`);
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
