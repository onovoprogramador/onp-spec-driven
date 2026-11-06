import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSkill, pathExists } from '../src/core/install.js';

function fixture(t, agent = 'codex', version = '4.0.0') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onp install '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  mkdirSync(path.join(source, 'references'), { recursive: true });
  writeFileSync(path.join(source, 'SKILL.md'), `---\nname: onp-spec-driven\ndescription: fixture\nmetadata:\n  version: ${version}\n  agent: ${agent}\n---\n\n# Skill\n\nname: exemplo-no-corpo\n`);
  writeFileSync(path.join(source, 'references', 'regra.md'), 'Não apagar as customizações do usuário.\n');
  return { root, source, canonical: path.join(root, '.agents/skills/onp-spec-driven') };
}

function capture(root) {
  const entries = [];
  function visit(filename, rel) {
    const stat = lstatSync(filename, { bigint: true });
    const kind = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'dir' : 'file';
    entries.push({ rel, kind, mtime: stat.mtimeNs, value: kind === 'link' ? readlinkSync(filename) : kind === 'file' ? readFileSync(filename) : null });
    if (kind === 'dir') for (const name of readdirSync(filename).sort()) visit(path.join(filename, name), path.join(rel, name));
  }
  visit(root, '.');
  return entries;
}

test('instalação canônica é exclusiva e repetir preserva bytes/mtime, incluindo arquivos extras', (t) => {
  const { source, canonical } = fixture(t);
  const original = capture(source);
  const first = installSkill(source, canonical, { agent: 'codex' });
  assert.equal(first.destination, canonical);
  assert.equal(first.name, 'onp-spec-driven');
  assert.equal(first.reused, false);
  writeFileSync(path.join(canonical, 'minhas-notas.md'), 'Arquivo adicional do usuário.');
  const before = capture(canonical);
  const second = installSkill(source, canonical, { agent: 'codex' });
  assert.equal(second.destination, canonical);
  assert.equal(second.reused, true);
  assert.equal(second.preserved, true);
  assert.deepEqual(capture(canonical), before);
  assert.deepEqual(capture(source), original);
});

test('customização existente permanece intacta; cópia versionada muda somente seu frontmatter name', (t) => {
  const { source, canonical } = fixture(t);
  installSkill(source, canonical, { agent: 'codex' });
  writeFileSync(path.join(canonical, 'references/regra.md'), 'Minha instrução customizada.\r\n');
  const original = capture(canonical);
  const sourceBefore = capture(source);
  const result = installSkill(source, canonical, { agent: 'codex' });
  assert.equal(result.name, 'onp-spec-driven-codex-v4-0-0');
  assert.equal(result.destination, path.join(path.dirname(canonical), result.name));
  assert.equal(result.preserved, true);
  assert.equal(result.reused, false);
  const content = readFileSync(path.join(result.destination, 'SKILL.md'), 'utf8');
  assert.match(content, /^name: onp-spec-driven-codex-v4-0-0$/m);
  assert.match(content, /^name: exemplo-no-corpo$/m, 'o corpo não é reescrito');
  assert.deepEqual(capture(canonical), original);
  assert.deepEqual(capture(source), sourceBefore);
  const installed = capture(result.destination);
  assert.equal(installSkill(source, canonical, { agent: 'codex' }).reused, true);
  assert.deepEqual(capture(result.destination), installed);
});

test('candidata versionada customizada leva ao próximo sufixo sem sobrescrever nenhuma instalação', (t) => {
  const { source, canonical } = fixture(t);
  installSkill(source, canonical, { agent: 'codex' });
  const first = installSkill(source, canonical, { agent: 'codex', versioned: true });
  writeFileSync(path.join(first.destination, 'SKILL.md'), 'Customização da candidata existente.\n');
  const before = capture(first.destination);
  const canonicalBefore = capture(canonical);
  const next = installSkill(source, canonical, { agent: 'codex', versioned: true });
  assert.equal(next.name, 'onp-spec-driven-codex-v4-0-0-2');
  assert.match(readFileSync(path.join(next.destination, 'SKILL.md'), 'utf8'), /^name: onp-spec-driven-codex-v4-0-0-2$/m);
  assert.deepEqual(capture(first.destination), before);
  assert.deepEqual(capture(canonical), canonicalBefore);
  assert.equal(installSkill(source, canonical, { agent: 'codex', versioned: true }).destination, next.destination);
});

test('outro harness pode coexistir em versão paralela sem modificar a skill canônica', (t) => {
  const { root, source, canonical } = fixture(t, 'antigravity');
  installSkill(source, canonical, { agent: 'antigravity' });
  const previous = capture(canonical);
  const other = path.join(root, 'codex-source');
  mkdirSync(other);
  writeFileSync(path.join(other, 'SKILL.md'), '---\nname: onp-spec-driven\ndescription: Codex\nmetadata:\n  version: "4.1.0-beta+local"\n  agent: codex\n---\n');
  const result = installSkill(other, canonical, { agent: 'codex', versioned: true });
  assert.equal(result.name, 'onp-spec-driven-codex-v4-1-0-beta-local');
  assert.deepEqual(capture(canonical), previous);
  assert.match(readFileSync(path.join(result.destination, 'SKILL.md'), 'utf8'), /agent: codex/);
});

test('origem versionada instala name canônico em outro projeto e repetir preserva ambas', (t) => {
  const { root, source, canonical } = fixture(t);
  const alias = installSkill(source, canonical, { agent: 'codex', versioned: true });
  assert.equal(alias.name, 'onp-spec-driven-codex-v4-0-0');
  const aliasBefore = capture(alias.destination);
  const otherCanonical = path.join(root, 'outro-projeto/.agents/skills/onp-spec-driven');
  const installed = installSkill(alias.destination, otherCanonical, { agent: 'codex' });
  assert.equal(installed.destination, otherCanonical);
  assert.equal(installed.name, 'onp-spec-driven');
  assert.equal(installed.reused, false);
  assert.match(readFileSync(path.join(otherCanonical, 'SKILL.md'), 'utf8'), /^name: onp-spec-driven$/m);
  assert.match(readFileSync(path.join(otherCanonical, 'SKILL.md'), 'utf8'), /^name: exemplo-no-corpo$/m);
  const installedBefore = capture(otherCanonical);
  const reused = installSkill(alias.destination, otherCanonical, { agent: 'codex' });
  assert.equal(reused.name, 'onp-spec-driven');
  assert.equal(reused.reused, true);
  assert.equal(reused.destination, otherCanonical);
  assert.deepEqual(capture(otherCanonical), installedBefore);
  assert.deepEqual(capture(alias.destination), aliasBefore);
  assert.equal(installSkill(alias.destination, alias.destination, { agent: 'codex' }).name, alias.name, 'mesmo local preserva nome da instalação versionada');
});

test('symlinks existentes e seus alvos são preservados, inclusive destino canônico pendente', (t) => {
  const { root, source, canonical } = fixture(t);
  mkdirSync(path.dirname(canonical), { recursive: true });
  symlinkSync('destino-inexistente', canonical, process.platform === 'win32' ? 'junction' : undefined);
  assert.equal(pathExists(canonical), true, 'lstat detecta symlink pendente');
  const canonicalBefore = capture(canonical);
  const result = installSkill(source, canonical, { agent: 'codex' });
  assert.notEqual(result.destination, canonical);
  assert.deepEqual(capture(canonical), canonicalBefore);
  const protectedDir = path.join(root, 'protegido');
  mkdirSync(protectedDir);
  writeFileSync(path.join(protectedDir, 'regra.md'), 'Preservar alvo externo.');
  const link = path.join(result.destination, 'references/extra-do-usuario');
  symlinkSync(protectedDir, link, process.platform === 'win32' ? 'junction' : undefined);
  const targetBefore = capture(protectedDir);
  const installedBefore = capture(result.destination);
  assert.equal(installSkill(source, canonical, { agent: 'codex' }).reused, true);
  assert.deepEqual(capture(protectedDir), targetBefore);
  assert.deepEqual(capture(result.destination), installedBefore);
});

test('origem já instalada é reutilizada e copiar symlink de referência não altera o link original', (t) => {
  const { source, canonical } = fixture(t);
  const alias = path.join(source, 'references/regra-link.md');
  // Em Windows, link de arquivo pode exigir privilégio; a referência é um
  // diretório junction, que não requer habilitar modo de desenvolvedor.
  const target = process.platform === 'win32' ? path.join(source, 'references') : 'regra.md';
  const destinationLink = process.platform === 'win32' ? path.join(source, 'reference-alias') : alias;
  symlinkSync(target, destinationLink, process.platform === 'win32' ? 'junction' : undefined);
  const before = capture(source);
  const installed = installSkill(source, canonical, { agent: 'codex' });
  const rel = path.relative(source, destinationLink);
  assert.equal(readlinkSync(path.join(installed.destination, rel)), readlinkSync(destinationLink));
  assert.deepEqual(capture(source), before);
  assert.equal(installSkill(canonical, canonical, { agent: 'codex' }).reused, true);
});
