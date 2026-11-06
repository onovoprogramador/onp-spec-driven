#!/usr/bin/env node
// Validação local de publicação: não autentica nem envia o pacote ao registry.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkill, SKILLS } from './build-skill.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function checkPresentation(pkg, documents) {
  const metadata = JSON.stringify({ name: pkg.name, description: pkg.description, keywords: pkg.keywords, author: pkg.author, contributors: pkg.contributors, repository: pkg.repository, homepage: pkg.homepage, bugs: pkg.bugs });
  for (const [name, content] of [['metadados públicos', metadata], ...Object.entries(documents)]) {
    if (/claude|codex|co-authored-by|generated (?:by|with)\s+(?:an?\s+)?ai|gerad[oa] (?:por|com)\s+(?:uma?\s+)?ia/i.test(content)) {
      throw new Error(`Apresentação pública fora do padrão de autoria do projeto: ${name}`);
    }
  }
  if (pkg.author !== 'Vitor Manoel — O Novo Programador') throw new Error('Confira a autoria do projeto antes de publicar.');
  if (pkg.publishConfig?.access !== 'public' || pkg.publishConfig?.registry !== 'https://registry.npmjs.org/') throw new Error('Destino público de publicação não configurado.');
}

function node(args, { capture = false } = {}) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', shell: false, stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Validação falhou (exit ${result.status ?? 'signal'}).${capture ? `\n${result.stderr || result.stdout}` : ''}`);
  return result.stdout;
}

export function checkPackage(pkg, archive) {
  if (archive.name !== pkg.name || archive.version !== pkg.version) throw new Error('Identidade do pacote diverge do manifesto.');
  const files = new Set(archive.files.map((item) => item.path));
  const required = ['package.json', 'README.md', 'LICENSE', 'bin/onp-spec.js', 'src/index.js', 'docs/GUIA-DE-INTEGRACOES.md', `docs/ATUALIZACOES-${pkg.version}.svg`, `docs/ATUALIZACOES-${pkg.version}.md`];
  for (const skill of SKILLS) {
    required.push(...['SKILL.md', 'scripts/onp-spec.mjs', 'scripts/lib/package.json', 'scripts/lib/src/cli.js', 'references/preservacao.md'].map((rel) => `skills/${skill}/${rel}`));
  }
  for (const file of required) if (!files.has(file)) throw new Error(`Arquivo obrigatório ausente no pacote: ${file}`);
  for (const file of files) {
    if (/(?:^|\/)(?:\.git|node_modules|\.npmrc|\.env(?:\.[^/]*)?)(?:\/|$)/i.test(file)) throw new Error(`Arquivo local indevido no pacote: ${file}`);
  }
}

export function checkRelease() {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const documents = Object.fromEntries(['README.md', 'LICENSE', `docs/ATUALIZACOES-${pkg.version}.svg`, `docs/ATUALIZACOES-${pkg.version}.md`]
    .map((file) => [file, readFileSync(path.join(root, file), 'utf8')]));
  checkPresentation(pkg, documents);
  buildSkill();
  node([path.join(root, 'tools/test.mjs')]);
  // npm_execpath vem do próprio npm run, evitando diferenças entre shims de OS.
  const npm = process.env.npm_execpath;
  if (!npm || !existsSync(npm)) throw new Error('Execute pela interface npm: npm run release:check');
  // O build já ocorreu; ignorar hooks nesta inspeção impede recursão de prepack.
  const [archive] = JSON.parse(node([npm, 'pack', '--dry-run', '--ignore-scripts', '--json'], { capture: true }));
  checkPackage(pkg, archive);
  console.log(`✔ ${pkg.name}@${pkg.version}: apresentação pública, build, testes e ${archive.entryCount} arquivos validados. Nenhuma publicação realizada.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkRelease(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
