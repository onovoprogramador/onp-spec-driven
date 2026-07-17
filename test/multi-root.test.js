// Cobertura de T-001 (feature portal-dever-casa, repo dever-casa): o motor
// precisa auditar código que mora FORA de rootDir, referenciado por globs
// com `../` (ex.: `../automacao-wpp-onp/src/**`). Sem isso, Q-005 não tem
// como ser resolvida com "spec e auditoria únicas neste repo".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { walkFiles } from '../src/parsers/annotations.js';
import { loadConfig } from '../src/config.js';
import { loadProject } from '../src/core/project.js';

function makeDir(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-multiroot-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

test('walkFiles: glob com ../ enxerga arquivos fora de rootDir', () => {
  const outerRepo = makeDir({ 'src/thing.test.js': '// @spec:AC-001 dummy\n' });
  const rootDir = makeDir({ 'src/main.js': '// nada\n' });
  const outerName = path.basename(outerRepo);

  const files = walkFiles(rootDir, {
    includeGlobs: ['src/**', `../${outerName}/src/**/*.test.*`],
    ignoreGlobs: ['node_modules/**'],
  });

  assert.ok(files.includes('src/main.js'));
  assert.ok(files.includes(`../${outerName}/src/thing.test.js`));
});

test('walkFiles: raiz externa inexistente degrada graciosamente (sem crash)', () => {
  const rootDir = makeDir({ 'src/main.js': '// nada\n' });
  const files = walkFiles(rootDir, {
    includeGlobs: ['src/**', '../onp-spec-driven-repo-que-nao-existe/src/**'],
    ignoreGlobs: [],
  });
  assert.deepEqual(files, ['src/main.js']);
});

test('walkFiles: raiz externa não duplica arquivos quando globs se sobrepõem', () => {
  const outerRepo = makeDir({ 'src/a.js': '', 'src/b.test.js': '' });
  const rootDir = makeDir({});
  const outerName = path.basename(outerRepo);

  const files = walkFiles(rootDir, {
    includeGlobs: [`../${outerName}/src/**`, `../${outerName}/src/**/*.test.*`],
    ignoreGlobs: [],
  });

  assert.deepEqual(files, [`../${outerName}/src/a.js`, `../${outerName}/src/b.test.js`]);
});

test('loadProject: srcFiles/testFiles/annotations cobrem raiz externa do config', () => {
  const outerRepo = makeDir({
    'src/services/thing.js': 'export const thing = 1;\n',
    'src/services/thing.test.js': "test('@spec:AC-001 soma', () => {});\n",
  });
  const outerName = path.basename(outerRepo);

  const rootDir = makeDir({
    '.spec/features/foo/spec.md': [
      '# Spec: Foo',
      '',
      '> feature: foo',
      '> status: em-implementacao',
      '',
      '## Histórias',
      '',
      '### US-001 — Uma história',
      '',
      'Como alguém, quero algo, para algo.',
      '',
      '#### AC-001 — Um critério',
      '',
      '- **Dado** algo',
      '- **Quando** algo',
      '- **Então** algo',
      '',
      '## Suposições',
      '',
      'Nenhuma.',
      '',
      '## Perguntas em aberto',
      '',
      'Nenhuma.',
      '',
    ].join('\n'),
  });

  const config = {
    ...loadConfig(rootDir),
    testGlobs: ['test/**', `../${outerName}/src/**/*.test.*`],
    srcGlobs: ['src/**', `../${outerName}/src/**`],
  };
  const project = loadProject(config);

  assert.ok(project.testFiles.includes(`../${outerName}/src/services/thing.test.js`));
  assert.ok(project.srcFiles.includes(`../${outerName}/src/services/thing.js`));
  assert.ok(
    !project.srcFiles.includes(`../${outerName}/src/services/thing.test.js`),
    'arquivo de teste não deve contar como código-fonte (dupla contagem)'
  );

  const tag = project.annotations.specTags.find((t) => t.acId === 'AC-001');
  assert.ok(tag, 'esperava achar @spec:AC-001 no arquivo de teste da raiz externa');
  assert.equal(tag.file, `../${outerName}/src/services/thing.test.js`);
});
