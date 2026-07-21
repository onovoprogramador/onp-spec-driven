// scaffold — o DoD nasce executável.
// Para cada AC sem teste anotado, gera um esqueleto de teste que FALHA
// até ser implementado. O título carrega @spec:AC-xxx; o corpo carrega
// o Dado/Quando/Então da spec como roteiro.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { allAcs } from '../parsers/spec.js';

function detectStyle(config) {
  const cmd = config.testCommand || '';
  if (cmd.includes('vitest')) return 'vitest';
  if (cmd.includes('jest')) return 'jest';
  if (cmd.includes('pytest')) return 'pytest';
  return 'node';
}

function jsHeader(style) {
  if (style === 'vitest') {
    return `import { test } from 'vitest';\n`;
  }
  if (style === 'jest') {
    return '';
  }
  return `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n`;
}

function jsFail(style, message) {
  if (style === 'vitest' || style === 'jest') {
    return `  throw new Error('${message}');`;
  }
  return `  assert.fail('${message}');`;
}

function renderJsTest(style, story, ac) {
  const lines = [];
  lines.push(`// ${story.id} — ${story.title}`);
  lines.push(`test('${ac.id}: ${ac.title.replace(/'/g, "\\'")} @spec:${ac.id}', () => {`);
  for (const g of ac.given) lines.push(`  // Dado: ${g}`);
  for (const w of ac.when) lines.push(`  // Quando: ${w}`);
  for (const t of ac.then) lines.push(`  // Então: ${t}`);
  lines.push(jsFail(style, `critério de aceite ${ac.id} ainda não provado — implemente este teste`));
  lines.push('});');
  return lines.join('\n');
}

function renderPyTest(story, ac) {
  const fn = ac.id.toLowerCase().replace(/-/g, '_');
  const lines = [];
  lines.push(`# ${story.id} — ${story.title}`);
  lines.push(`def test_${fn}():`);
  lines.push(`    """${ac.id}: ${ac.title} @spec:${ac.id}"""`);
  for (const g of ac.given) lines.push(`    # Dado: ${g}`);
  for (const w of ac.when) lines.push(`    # Quando: ${w}`);
  for (const t of ac.then) lines.push(`    # Então: ${t}`);
  lines.push(`    raise AssertionError("critério de aceite ${ac.id} ainda não provado — implemente este teste")`);
  return lines.join('\n');
}

export function scaffoldTests(project, featureName, { force = false } = {}) {
  const { config } = project;
  const feature = project.features.find((f) => f.name === featureName);
  if (!feature?.spec) {
    throw new Error(`feature "${featureName}" não encontrada ou sem spec.md`);
  }

  const testFileSet = new Set(project.testFiles);
  const tagged = new Set(
    project.annotations.specTags.filter((t) => testFileSet.has(t.file)).map((t) => t.acId)
  );

  const style = detectStyle(config);
  const ext = style === 'pytest' ? 'py' : 'js';
  const fileName =
    style === 'pytest' ? `test_spec_${featureName.replace(/-/g, '_')}.py` : `${featureName}.spec.test.${ext}`;
  const outDir = path.join(config.rootDir, style === 'pytest' ? 'tests' : 'test');
  const outPath = path.join(outDir, fileName);

  const pending = [];
  for (const story of feature.spec.stories) {
    for (const ac of story.acs) {
      if (!tagged.has(ac.id)) pending.push({ story, ac });
    }
  }

  // princípios [DEVE]/[RECOMENDADO] com verificação(teste) sem tag ainda:
  // o esqueleto nasce junto — senão o gate exige um teste que nenhum passo cria
  const taggedPrinciples = new Set(
    project.annotations.principleTags.filter((t) => testFileSet.has(t.file)).map((t) => t.principleId)
  );
  const pendingPrinciples = [];
  for (const p of project.constitution?.principles || []) {
    for (const check of p.checks) {
      if (check.kind === 'teste' && !taggedPrinciples.has(check.principleTag)) {
        pendingPrinciples.push({ principle: p, tag: check.principleTag });
      }
    }
  }

  if (pending.length === 0 && pendingPrinciples.length === 0) {
    return { created: null, pending: 0, message: 'todos os critérios de aceite (e princípios) já têm teste anotado' };
  }
  if (existsSync(outPath) && !force) {
    throw new Error(
      `${path.relative(config.rootDir, outPath)} já existe — use --force para sobrescrever ou anote os testes existentes`
    );
  }

  let content;
  if (style === 'pytest') {
    content = `# Testes de spec da feature ${featureName} — gerados por onp-spec scaffold\n\n`;
    content += pending.map(({ story, ac }) => renderPyTest(story, ac)).join('\n\n');
    content += pendingPrinciples
      .map(({ principle, tag }) => `\n\n${renderPyPrinciple(principle, tag)}`)
      .join('');
    content += '\n';
  } else {
    content = `// Testes de spec da feature ${featureName} — gerados por onp-spec scaffold\n${jsHeader(style)}\n`;
    content += pending.map(({ story, ac }) => renderJsTest(style, story, ac)).join('\n\n');
    content += pendingPrinciples
      .map(({ principle, tag }) => `\n\n${renderJsPrinciple(style, principle, tag)}`)
      .join('');
    content += '\n';
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, content);

  return {
    created: path.relative(config.rootDir, outPath),
    pending: pending.length + pendingPrinciples.length,
    acIds: [
      ...pending.map((p) => p.ac.id),
      ...pendingPrinciples.map((p) => p.tag),
    ],
  };
}

function renderJsPrinciple(style, principle, tag) {
  const lines = [];
  lines.push(`// ${principle.id} [${principle.level}] — ${principle.title}`);
  lines.push(
    `test('${principle.id}: ${principle.title.replace(/'/g, "\\'")} @principle:${tag}', () => {`
  );
  lines.push(jsFail(style, `princípio ${principle.id} ainda não provado — implemente este teste`));
  lines.push('});');
  return lines.join('\n');
}

function renderPyPrinciple(principle, tag) {
  const fn = tag.toLowerCase().replace(/-/g, '_');
  const lines = [];
  lines.push(`# ${principle.id} [${principle.level}] — ${principle.title}`);
  lines.push(`def test_${fn}():`);
  lines.push(`    """${principle.id}: ${principle.title} @principle:${tag}"""`);
  lines.push(`    raise AssertionError("princípio ${principle.id} ainda não provado — implemente este teste")`);
  return lines.join('\n');
}
