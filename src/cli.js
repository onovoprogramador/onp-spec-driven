// CLI onp-spec — dispatch de comandos.

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, DEFAULT_CONFIG } from './config.js';
import { loadProject } from './core/project.js';
import { auditProject } from './core/audit.js';
import { renderTerminal, renderJson, renderMarkdown } from './core/report.js';
import { runVerify } from './core/verify.js';
import { scaffoldTests } from './core/scaffold.js';
import { allAcs } from './parsers/spec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const SKILL_DIR = path.join(__dirname, '..', 'skills', 'onp-spec-driven');

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
    copyDirIfExists(SKILL_DIR, dest);
    console.log('✔ skill instalada em .claude/skills/onp-spec-driven (Claude Code)');
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

export async function run(argv) {
  const [command, ...rest] = argv;
  const { flags, positional } = parseFlags(rest);
  const rootDir = process.cwd();

  if (!command || command === 'help' || flags.help) {
    console.log(HELP);
    return 0;
  }

  if (command === 'version' || flags.version) {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    console.log(pkg.version);
    return 0;
  }

  if (command === 'init') return cmdInit(rootDir, flags);
  if (command === 'new') return cmdNew(rootDir, positional[0], flags);

  const config = loadConfig(rootDir);
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
    return audit.exitCode;
  }

  if (command === 'verify') {
    const featureName = positional[0];
    if (!featureName) {
      console.error('uso: onp-spec verify <feature>');
      return 2;
    }
    const { record } = runVerify(project, featureName);
    const total = Object.keys(record.results).length;
    const passed = Object.values(record.results).filter((r) => r.status === 'pass').length;
    console.log(
      `verify ${featureName}: ${passed}/${total} AC(s) com prova PASS · ${record.testsParsed} teste(s) lidos · exit ${record.exitCode}`
    );
    for (const [acId, r] of Object.entries(record.results)) {
      console.log(`  ${r.status === 'pass' ? '✔' : '✘'} ${acId} ${r.testName ? `— ${r.testName}` : ''}`);
    }
    const principles = Object.entries(record.principles || {});
    if (principles.length) {
      console.log('  princípios:');
      for (const [pId, r] of principles) {
        console.log(`  ${r.status === 'pass' ? '✔' : '✘'} ${pId} — ${r.testName}`);
      }
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
