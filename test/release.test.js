import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPresentation, checkPackage } from '../tools/check-release.mjs';
import { SKILLS } from '../tools/build-skill.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('apresentação pública usa a marca do projeto e preserva autoria', () => {
  const documents = Object.fromEntries(['README.md', 'LICENSE', 'docs/PUBLICAR-NPM.md', `docs/ATUALIZACOES-${pkg.version}.svg`, `docs/ATUALIZACOES-${pkg.version}.md`].map(file => [file, read(file)]));
  assert.doesNotThrow(() => checkPresentation(pkg, documents));
});

test('gate rejeita referências de autoria/apresentação fora do escopo aprovado', () => {
  assert.throws(() => checkPresentation({ ...pkg, keywords: [...pkg.keywords, 'codex'] }, {}), /metadados públicos/);
  assert.throws(() => checkPresentation(pkg, { 'README.md': 'Generated with Claude' }), /README.md/);
  assert.throws(() => checkPresentation(pkg, { 'README.md': 'Co-authored-by: assistant' }), /README.md/);
  assert.throws(() => checkPresentation({ ...pkg, author: 'Outro autor' }, {}), /autoria/);
});

function archive() {
  const paths = ['package.json', 'README.md', 'LICENSE', 'bin/onp-spec.js', 'src/index.js', 'docs/GUIA-DE-INTEGRACOES.md', `docs/ATUALIZACOES-${pkg.version}.svg`, `docs/ATUALIZACOES-${pkg.version}.md`];
  for (const skill of SKILLS) paths.push(...['SKILL.md', 'scripts/onp-spec.mjs', 'scripts/lib/package.json', 'scripts/lib/src/cli.js', 'references/preservacao.md'].map(file => `skills/${skill}/${file}`));
  return { name: pkg.name, version: pkg.version, files: paths.map(file => ({ path: file })) };
}

test('o gate do pacote mantém integrações e falha se um motor ficar ausente', () => {
  assert.doesNotThrow(() => checkPackage(pkg, archive()));
  const incomplete = archive();
  incomplete.files = incomplete.files.filter(file => file.path !== `skills/${SKILLS[2]}/scripts/lib/src/cli.js`);
  assert.throws(() => checkPackage(pkg, incomplete), /Arquivo obrigatório ausente/);
  assert.throws(() => checkPackage(pkg, { ...archive(), version: '0.9.0' }), /Identidade/);
});

test('o gate do pacote rejeita arquivos de autenticação que não pertencem à distribuição', () => {
  const leaked = archive(); leaked.files.push({ path: '.npmrc' });
  assert.throws(() => checkPackage(pkg, leaked), /Arquivo local indevido/);
});
