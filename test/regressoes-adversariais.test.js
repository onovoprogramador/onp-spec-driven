// Regressões da bateria adversarial de 17/07/2026 (docs/ACHADOS-teste-exaustivo.md).
// Cada teste corresponde a um achado CR-x / AL-x / MD-x que DEVE permanecer corrigido.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/config.js';
import { loadProject } from '../src/core/project.js';
import { auditProject } from '../src/core/audit.js';
import { parseTap, parseJsonReport, resultsByTag } from '../src/core/verify.js';
import { parseTasks } from '../src/parsers/tasks.js';
import { parseSpec, allAcs } from '../src/parsers/spec.js';
import { parseConstitution } from '../src/parsers/constitution.js';
import { grepPattern } from '../src/parsers/annotations.js';

const roots = [];
function tracked(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-adv-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
function audit(root, opts = {}) {
  return auditProject(loadProject(loadConfig(root)), opts);
}
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const SPEC_MIN = `# Spec: F

> feature: f
> status: rascunho

## Histórias

### US-001 — H

Como dev, quero.

#### AC-001 — C

- **Dado** x
- **Quando** y
- **Então** z

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
`;

// ---------- CR-1: skip/todo nunca é prova ----------

test('CR-1: TAP "# SKIP" não conta como pass', () => {
  const tests = parseTap(`TAP version 13\nok 1 - AC-001: pulado @spec:AC-001 # SKIP motivo\n1..1\n`);
  assert.equal(tests.length, 1);
  assert.equal(tests[0].pass, false);
  assert.equal(tests[0].skip, true);
  const { acResults } = resultsByTag(tests);
  assert.equal(acResults['AC-001'].status, 'skip');
});

test('CR-1: TAP "# TODO" não conta como pass', () => {
  const tests = parseTap(`ok 1 - AC-002: futuro @spec:AC-002 # TODO depois\n`);
  assert.equal(tests[0].skip, true);
});

test('CR-1: JSON reporter com status skipped/pending/todo não é prova', () => {
  const tests = parseJsonReport(
    JSON.stringify({
      testResults: [
        {
          assertionResults: [
            { title: 'a @spec:AC-001', status: 'skipped' },
            { title: 'b @spec:AC-002', status: 'pending' },
            { title: 'c @spec:AC-003', status: 'todo' },
            { title: 'd @spec:AC-004', status: 'passed' },
          ],
        },
      ],
    })
  );
  const { acResults } = resultsByTag(tests);
  assert.equal(acResults['AC-001'].status, 'skip');
  assert.equal(acResults['AC-002'].status, 'skip');
  assert.equal(acResults['AC-003'].status, 'skip');
  assert.equal(acResults['AC-004'].status, 'pass');
});

test('CR-1: skip + pass do mesmo AC → pass; skip + fail → fail', () => {
  const both = resultsByTag([
    { title: 'a @spec:AC-001', pass: false, skip: true },
    { title: 'b @spec:AC-001', pass: true, skip: false },
  ]);
  assert.equal(both.acResults['AC-001'].status, 'pass');
  const failing = resultsByTag([
    { title: 'a @spec:AC-001', pass: false, skip: true },
    { title: 'b @spec:AC-001', pass: false, skip: false },
  ]);
  assert.equal(failing.acResults['AC-001'].status, 'fail');
});

test('CR-1: prova "skip" gravada em verify vira AC_SEM_PROVA erro no audit', () => {
  const root = tracked({
    '.spec/features/f/spec.md': SPEC_MIN,
    'test/f.test.js': `test('AC-001: pulado @spec:AC-001', () => {});`,
    '.spec/verification/f.json': JSON.stringify({
      feature: 'f',
      timestamp: new Date(Date.now() + 60000).toISOString(),
      results: { 'AC-001': { status: 'skip', testName: 'AC-001: pulado @spec:AC-001 # SKIP', method: 'tap' } },
    }),
  });
  const result = audit(root);
  const f = result.findings.find((x) => x.code === 'AC_SEM_PROVA');
  assert.ok(f, 'AC_SEM_PROVA deve existir');
  assert.equal(f.severity, 'erro');
  assert.match(f.message, /PULADO|skip/i);
});

// ---------- CR-2: status de task com acento/maiúscula ----------

test('CR-2: "[concluída]" e "[Concluida]" contam como concluida (gate preservado)', () => {
  const t1 = parseTasks(`## T-001 — X [concluída]\n- Refs: AC-001\n`);
  assert.equal(t1.tasks[0].status, 'concluida');
  const t2 = parseTasks(`## T-002 — Y [Concluida]\n- Refs: AC-001\n`);
  assert.equal(t2.tasks[0].status, 'concluida');
  const t3 = parseTasks(`## T-003 — Z [Em-Andamento]\n`);
  assert.equal(t3.tasks[0].status, 'em-andamento');
});

test('CR-2: status desconhecido vira TASK_STATUS_INVALIDO (nunca pendente em silêncio)', () => {
  const t = parseTasks(`## T-001 — X [feita]\n- Refs: AC-001\n`);
  assert.equal(t.parseIssues[0].code, 'TASK_STATUS_INVALIDO');
});

test('CR-2 e2e: task [concluída] sem prova gera TASK_CONCLUIDA_SEM_PROVA', () => {
  const root = tracked({
    '.spec/features/f/spec.md': SPEC_MIN,
    '.spec/features/f/tasks.md': `## T-001 — X [concluída]\n\n- Refs: AC-001\n`,
  });
  const result = audit(root);
  assert.ok(result.findings.some((f) => f.code === 'TASK_CONCLUIDA_SEM_PROVA'));
});

// ---------- CR-4: ReDoS na constituição ----------

test('CR-4: regex patológica é morta por timeout e vira erro legível', () => {
  const root = tracked({ 'src/payload.js': 'a'.repeat(64) + 'X' });
  const t0 = Date.now();
  const { error } = grepPattern(root, '(a+)+$', 'src/**/*.js', []);
  const dt = Date.now() - t0;
  assert.ok(dt < 10000, `grep deveria ser morto em <10s (levou ${dt}ms)`);
  assert.ok(error && /excedeu/.test(error), `erro deveria citar timeout: ${error}`);
});

// ---------- CR-5: caminho feliz fecha ----------

test('CR-5: constituição base (gate) não exige teste meta — kind gate satisfaz DEVE', () => {
  const c = parseConstitution(`# Constituição — v1.1.0\n\n## P-001 [DEVE] Prova executável\n\n- verificação(gate): intrínseca ao audit\n`);
  assert.equal(c.principles[0].checks[0].kind, 'gate');
  const root = tracked({
    '.spec/constituicao.md': `# Constituição — v1.1.0\n\n## P-001 [DEVE] Prova executável\n\n- verificação(gate): intrínseca ao audit\n`,
  });
  const result = audit(root);
  assert.ok(!result.findings.some((f) => f.code === 'PRINCIPIO_SEM_VERIFICACAO'));
  assert.ok(!result.findings.some((f) => f.code === 'PRINCIPIO_VIOLADO'));
});

// ---------- AL-1: NFD ----------

test('AL-1: spec em NFD (macOS) parseia sem AC_INCOMPLETO falso', () => {
  const spec = parseSpec(SPEC_MIN.normalize('NFD'));
  const acs = allAcs(spec);
  assert.equal(acs.length, 1);
  assert.equal(acs[0].then.length, 1, 'Então em NFD deve casar');
});

// ---------- AL-2: caminho com espaço ----------

test('AL-2: Arquivos: separa por vírgula — caminho com espaço sobrevive', () => {
  const t = parseTasks(`## T-001 — X [pendente]\n- Arquivos: src/meu arquivo.js, src/outro.js\n`);
  assert.deepEqual(t.tasks[0].files, ['src/meu arquivo.js', 'src/outro.js']);
});

// ---------- AL-3: GWT indentado e case ----------

test('AL-3: GWT indentado (2 espaços) e **dado** minúsculo são aceitos', () => {
  const spec = parseSpec(
    SPEC_MIN.replace('- **Dado** x', '  - **dado** x').replace('- **Quando** y', '  * **Quando** y')
  );
  const ac = allAcs(spec)[0];
  assert.equal(ac.given.length, 1);
  assert.equal(ac.when.length, 1);
  assert.equal(ac.then.length, 1);
});

// ---------- AL-4: glob sem arquivos ----------

test('AL-4: verificação(obrigatório) com glob que casa 0 arquivos → GLOB_SEM_ARQUIVOS', () => {
  const root = tracked({
    '.spec/constituicao.md': `# Constituição — v1.0.0\n\n## P-010 [DEVE] Auth em toda rota\n\n- verificação(obrigatório): \`checarAuth\\(\` em \`src/rotas-typo/**/*.js\`\n`,
  });
  const result = audit(root);
  assert.ok(result.findings.some((f) => f.code === 'GLOB_SEM_ARQUIVOS'));
});

test('AL-4b: regex inválida é acusada mesmo com glob que casa 0 arquivos', () => {
  const root = tracked({
    '.spec/constituicao.md': `# Constituição — v1.0.0\n\n## P-001 [DEVE] Regex quebrada\n\n- verificação(proibido): \`([invalida\` em \`src/**/*.js\`\n`,
  });
  const result = audit(root);
  assert.ok(result.findings.some((f) => f.code === 'VERIFICACAO_MALFORMADA'));
});

// ---------- AL-5: nível desconhecido ----------

test('AL-5: nível [OBRIGATORIO] gera NIVEL_INVALIDO e princípio NÃO some', () => {
  const c = parseConstitution(`# Constituição — v1.0.0\n\n## P-001 [OBRIGATORIO] Nível errado\n\n- verificação(teste): @principle:P-001\n`);
  assert.ok(c.parseIssues.some((i) => i.code === 'NIVEL_INVALIDO'));
  assert.equal(c.principles.length, 1, 'princípio deve ser registrado mesmo assim');
  assert.equal(c.principles[0].checks.length, 1);
});

// ---------- AL-6: seções obrigatórias ausentes ----------

test('AL-6: spec sem Suposições/Perguntas → SECAO_AUSENTE (erro quando madura)', () => {
  const bare = `# Spec: F\n\n> feature: f\n> status: implementada\n\n## Histórias\n\n### US-001 — H\n\n#### AC-001 — C\n\n- **Dado** x\n- **Quando** y\n- **Então** z\n`;
  const root = tracked({
    '.spec/features/f/spec.md': bare,
    'test/f.test.js': `test('AC-001 @spec:AC-001', () => {});`,
  });
  const result = audit(root);
  const secoes = result.findings.filter((f) => f.code === 'SECAO_AUSENTE');
  assert.equal(secoes.length, 2, 'Suposições E Perguntas ausentes');
  assert.ok(secoes.every((f) => f.severity === 'erro'), 'erro com status implementada');
});

// ---------- AL-7/MD-6: exitcode restrito a AC anotado ----------
// (coberto via runVerify no cli.e2e; aqui garantimos o aviso PROVA_FRACA)

test('MD-6: prova via exitcode gera PROVA_FRACA no audit', () => {
  const root = tracked({
    '.spec/features/f/spec.md': SPEC_MIN,
    'test/f.test.js': `test('AC-001: x @spec:AC-001', () => {});`,
    '.spec/verification/f.json': JSON.stringify({
      feature: 'f',
      timestamp: new Date(Date.now() + 60000).toISOString(),
      results: { 'AC-001': { status: 'pass', testName: null, method: 'exitcode' } },
    }),
  });
  const result = audit(root);
  assert.ok(result.findings.some((f) => f.code === 'PROVA_FRACA'));
});

// ---------- MD-1: refs globais ----------

test('MD-1: ref cruzada entre features NÃO é REF_QUEBRADA e cobre o AC', () => {
  const specB = SPEC_MIN.replace('US-001', 'US-002').replace('AC-001', 'AC-002').replace('feature: f', 'feature: b');
  const root = tracked({
    '.spec/features/a/spec.md': SPEC_MIN.replace('feature: f', 'feature: a'),
    '.spec/features/b/spec.md': specB,
    '.spec/features/b/tasks.md': `## T-001 — Usa AC de a [pendente]\n\n- Refs: AC-001, AC-002\n- Arquivos: src/x.js\n`,
    'src/x.js': '// impl',
  });
  const result = audit(root);
  assert.ok(!result.findings.some((f) => f.code === 'REF_QUEBRADA'), 'AC-001 existe globalmente');
  assert.ok(!result.findings.some((f) => f.code === 'AC_SEM_TASK'), 'ambos cobertos');
});

test('MD-1: ref para AC inexistente em QUALQUER spec continua REF_QUEBRADA', () => {
  const root = tracked({
    '.spec/features/f/spec.md': SPEC_MIN,
    '.spec/features/f/tasks.md': `## T-001 — X [pendente]\n\n- Refs: AC-999\n`,
  });
  const result = audit(root);
  assert.ok(result.findings.some((f) => f.code === 'REF_QUEBRADA'));
});

// ---------- MD-2: feature divergente ----------

test('MD-2: "> feature:" diferente do diretório → FEATURE_DIVERGENTE', () => {
  const root = tracked({
    '.spec/features/nome-do-dir/spec.md': SPEC_MIN, // > feature: f
  });
  const result = audit(root);
  assert.ok(result.findings.some((f) => f.code === 'FEATURE_DIVERGENTE'));
});

// ---------- MD-3: IDs curtos ----------

test('MD-3: US-1/AC-1 (menos de 3 dígitos) geram dica ID_CURTO', () => {
  const spec = parseSpec(`# Spec: F\n\n## Histórias\n\n### US-1 — H\n\n#### AC-1 — C\n`);
  const shorts = spec.parseIssues.filter((i) => i.code === 'ID_CURTO');
  assert.equal(shorts.length, 2);
  assert.match(shorts[0].message, /US-001/);
});
