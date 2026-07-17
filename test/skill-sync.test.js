// Garante que o motor embarcado na skill (skills/onp-spec-driven/scripts/)
// está sincronizado com src/ e templates/ — mata o drift silencioso (SK-5).
// Se este teste falhar: node tools/build-skill.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENTRY } from '../tools/build-skill.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'onp-spec-driven', 'scripts');

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

test('skill embarcada existe (rode: node tools/build-skill.mjs)', () => {
  assert.ok(existsSync(SCRIPTS), 'skills/onp-spec-driven/scripts/ não existe');
});

test('scripts/lib/src espelha src/ byte a byte', () => {
  const srcFiles = walk(path.join(ROOT, 'src'));
  const libFiles = walk(path.join(SCRIPTS, 'lib', 'src'));
  assert.deepEqual(libFiles, srcFiles, 'lista de arquivos diverge — regenere o build');
  for (const rel of srcFiles) {
    assert.equal(
      readFileSync(path.join(SCRIPTS, 'lib', 'src', rel), 'utf-8'),
      readFileSync(path.join(ROOT, 'src', rel), 'utf-8'),
      `conteúdo diverge: ${rel} — rode node tools/build-skill.mjs`
    );
  }
});

test('scripts/lib/templates espelha templates/ (sem agents/)', () => {
  const tplFiles = walk(path.join(ROOT, 'templates')).filter((f) => !f.startsWith('agents/'));
  const libFiles = walk(path.join(SCRIPTS, 'lib', 'templates'));
  assert.deepEqual(libFiles, tplFiles);
  for (const rel of tplFiles) {
    assert.equal(
      readFileSync(path.join(SCRIPTS, 'lib', 'templates', rel), 'utf-8'),
      readFileSync(path.join(ROOT, 'templates', rel), 'utf-8'),
      `template diverge: ${rel}`
    );
  }
});

test('entrypoint onp-spec.mjs é o gerado pelo build', () => {
  assert.equal(readFileSync(path.join(SCRIPTS, 'onp-spec.mjs'), 'utf-8'), ENTRY);
});
