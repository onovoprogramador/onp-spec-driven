import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldTests } from '../src/core/scaffold.js';

function fixture(t, manifest, testManifest) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onp-scaffold-modules-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (manifest !== null) writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  if (testManifest) {
    mkdirSync(path.join(root, 'test'));
    writeFileSync(path.join(root, 'test/package.json'), JSON.stringify(testManifest));
  }
  const project = {
    config: { rootDir: root, testCommand: 'node --test' },
    features: [{ name: 'boleto', spec: { stories: [{
      id: 'US-001', title: 'Emitir boleto', acs: [{ id: 'AC-001', title: 'Boleto emitido',
        given: ['um pedido válido'], when: ['o cliente solicita boleto'], then: ['o boleto é exibido'] }],
    }] } }],
    testFiles: [], annotations: { specTags: [], principleTags: [] },
    constitution: { principles: [{ id: 'P-001', title: 'Cobrança única', level: 'DEVE', checks: [{ kind: 'teste', principleTag: 'P-001' }] }] },
  };
  return { root, project };
}

for (const scenario of [
  { name: 'sem package.json', manifest: null, module: false },
  { name: 'package sem type', manifest: { name: 'fixture' }, module: false },
  { name: 'CommonJS explícito', manifest: { type: 'commonjs' }, module: false },
  { name: 'ESM explícito', manifest: { type: 'module' }, module: true },
  { name: 'test/ CommonJS dentro de projeto ESM', manifest: { type: 'module' }, testManifest: { type: 'commonjs' }, module: false },
  { name: 'test/ ESM dentro de projeto CommonJS', manifest: { type: 'commonjs' }, testManifest: { type: 'module' }, module: true },
]) {
  test(`scaffold Node: ${scenario.name} executa os ACs e falha por ausência de prova`, (t) => {
    const { root, project } = fixture(t, scenario.manifest, scenario.testManifest);
    const result = scaffoldTests(project, 'boleto');
    assert.equal(result.created, path.join('test', 'boleto.spec.test.js'));
    const filename = path.join(root, result.created);
    const content = readFileSync(filename, 'utf8');
    assert.equal(content.includes("import { test } from 'node:test'"), scenario.module);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // runner filho é uma execução independente
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', filename], { cwd: root, encoding: 'utf8', env });
    const output = `${run.stdout}\n${run.stderr}`;
    assert.equal(run.status, 1, output);
    assert.match(output, /not ok \d+ - AC-001: Boleto emitido @spec:AC-001/);
    assert.match(output, /critério de aceite AC-001 ainda não provado/);
    assert.match(output, /not ok \d+ - P-001: Cobrança única @principle:P-001/);
    assert.match(output, /princípio P-001 ainda não provado/);
    assert.doesNotMatch(output, /SyntaxError|Cannot use import|require is not defined|ERR_REQUIRE_ESM/);
  });
}
