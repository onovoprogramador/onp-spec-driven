// verify — roda o comando de teste do projeto, extrai o resultado POR TESTE
// e cruza com os ACs da feature via tag @spec:AC-xxx no título do teste.
// Grava .spec/verification/<feature>.json — a "prova" que o audit consome.
//
// O agente (ou o dev) não decide se o AC passou. O test runner decide.

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { allAcs } from '../parsers/spec.js';

const RE_SPEC_TAG = /@spec:(AC-\d{3,})/g;
const RE_PRINCIPLE_TAG = /@principle:(P-\d{3,})/g;

// ---------- parsers de saída ----------

// TAP (node:test, tape, etc.): "ok 1 - título" / "not ok 2 - título".
// Diretivas "# SKIP"/"# TODO" chegam como "ok" no TAP mas NÃO são prova:
// um teste pulado não pode provar um AC (senão skip = bypass do gate).
export function parseTap(output) {
  const tests = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^\s*(not )?ok\s+\d+\s*(?:-\s*)?(.*)$/);
    if (!m) continue;
    let title = m[2].trim();
    let skip = false;
    const directive = title.match(/^(.*?)\s+#\s*(SKIP|TODO)\b.*$/i);
    if (directive) {
      title = directive[1].trim();
      skip = true;
    }
    // ignora linhas de resumo de suíte do node:test (duplicam subtests)
    if (/^tests \d+$/.test(title)) continue;
    tests.push({ title, pass: !m[1] && !skip, skip });
  }
  return tests;
}

// vitest --reporter=json / jest --json (mesmo shape de assertionResults).
// "skipped"/"pending"/"todo"/"disabled" não são prova.
export function parseJsonReport(jsonText) {
  const data = JSON.parse(jsonText);
  const tests = [];
  for (const suite of data.testResults || []) {
    for (const t of suite.assertionResults || []) {
      tests.push({
        title: [t.fullName, t.title].filter(Boolean).join(' '),
        pass: t.status === 'passed',
        skip: t.status !== 'passed' && t.status !== 'failed',
      });
    }
  }
  return tests;
}

export function extractTags(title) {
  const acs = [...title.matchAll(RE_SPEC_TAG)].map((m) => m[1]);
  const principles = [...title.matchAll(RE_PRINCIPLE_TAG)].map((m) => m[1]);
  return { acs, principles };
}

// Reduz a lista de testes a um veredito por tag.
// Regra: falha domina passe, passe domina skip. Um AC só provado por testes
// pulados fica "skip" — que NUNCA conta como prova.
const STATUS_RANK = { fail: 3, pass: 2, skip: 1 };

export function resultsByTag(tests) {
  const acResults = {}; // AC-xxx -> {status, testName}
  const principleResults = {};

  const merge = (map, id, t) => {
    const status = t.skip ? 'skip' : t.pass ? 'pass' : 'fail';
    const prev = map[id];
    if (!prev || STATUS_RANK[status] > STATUS_RANK[prev.status]) {
      map[id] = { status, testName: t.title };
    }
  };

  for (const t of tests) {
    const { acs, principles } = extractTags(t.title);
    for (const acId of acs) merge(acResults, acId, t);
    for (const pId of principles) merge(principleResults, pId, t);
  }

  return { acResults, principleResults };
}

export function gitRev(rootDir) {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// ---------- execução ----------

export function runVerify(project, featureName) {
  const { config } = project;
  const feature = project.features.find((f) => f.name === featureName);
  if (!feature) {
    throw new Error(
      `feature "${featureName}" não encontrada em ${config.specDir}/features/`
    );
  }
  if (!feature.spec) {
    throw new Error(`feature "${featureName}" não tem spec.md`);
  }
  if (!config.testCommand) {
    throw new Error(
      'defina "testCommand" em onpspec.config.json (ex.: "node --test" ou "npx vitest run --reporter=json --outputFile=.spec/verification/raw.json")'
    );
  }

  // Ambiente limpo: se o verify roda dentro de outro test runner (CI, ou os
  // próprios testes da lib), variáveis como NODE_TEST_CONTEXT/NODE_OPTIONS
  // fariam o `node --test` filho trocar o protocolo de saída e não emitir TAP.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;

  const proc = spawnSync(config.testCommand, {
    cwd: config.rootDir,
    shell: true,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    env: childEnv,
  });
  const output = `${proc.stdout || ''}\n${proc.stderr || ''}`;

  let tests = [];
  if (config.reporter === 'tap') {
    tests = parseTap(output);
  } else if (config.reporter === 'vitest-json' || config.reporter === 'jest-json') {
    let jsonText = null;
    if (config.reporterOutputFile) {
      const p = path.join(config.rootDir, config.reporterOutputFile);
      if (existsSync(p)) jsonText = readFileSync(p, 'utf-8');
    }
    if (jsonText === null) {
      // tenta achar o JSON no stdout (jest --json escreve no stdout)
      const start = (proc.stdout || '').indexOf('{');
      if (start >= 0) jsonText = (proc.stdout || '').slice(start);
    }
    if (jsonText === null) {
      throw new Error(
        `reporter ${config.reporter}: não achei o JSON — configure "reporterOutputFile" ou garanta o JSON no stdout`
      );
    }
    tests = parseJsonReport(jsonText);
  } else if (config.reporter === 'exitcode') {
    tests = []; // sem granularidade por teste
  } else {
    throw new Error(`reporter desconhecido: ${config.reporter}`);
  }

  const { acResults, principleResults } = resultsByTag(tests);

  // ACs com teste anotado (tag @spec em arquivo de teste) — o reporter
  // exitcode só concede prova a esses; sem isso, exit 0 provaria até AC
  // sem teste nenhum.
  const testFileSet = new Set(project.testFiles);
  const annotatedAcs = new Set(
    project.annotations.specTags.filter((t) => testFileSet.has(t.file)).map((t) => t.acId)
  );

  const results = {};
  const featureAcs = allAcs(feature.spec);
  for (const ac of featureAcs) {
    if (acResults[ac.id]) {
      results[ac.id] = { ...acResults[ac.id], method: config.reporter };
    } else if (config.reporter === 'exitcode' && annotatedAcs.has(ac.id)) {
      // sem per-teste: só o exit code global prova (fraco, mas explícito)
      results[ac.id] = {
        status: proc.status === 0 ? 'pass' : 'fail',
        testName: null,
        method: 'exitcode',
      };
    }
    // sem tag correspondente → sem entrada → audit acusa AC_SEM_PROVA
  }

  // dica de UX: rodou testes mas nenhum título carrega tag de AC da feature
  const anyTagMatched = featureAcs.some((ac) => acResults[ac.id]);
  const hint =
    tests.length > 0 && !anyTagMatched && config.reporter !== 'exitcode'
      ? `nenhum título de teste contém @spec:${featureAcs[0]?.id || 'AC-xxx'} — a tag vai no TÍTULO do teste`
      : null;

  const record = {
    feature: featureName,
    timestamp: new Date().toISOString(),
    gitRev: gitRev(config.rootDir),
    command: config.testCommand,
    reporter: config.reporter,
    exitCode: proc.status,
    testsParsed: tests.length,
    results,
    principles: principleResults,
  };

  const outDir = path.join(project.specRoot, 'verification');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, `${featureName}.json`),
    `${JSON.stringify(record, null, 2)}\n`
  );

  return { record, rawOutput: output, hint };
}
