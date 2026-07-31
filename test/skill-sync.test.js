// Garante que o motor embarcado em CADA skill (claude e antigravity) está
// sincronizado com src/ e templates/ — mata o drift silencioso (SK-5).
// Se este teste falhar: node tools/build-skill.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENTRY } from '../tools/build-skill.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['onp-spec-driven', 'onp-spec-driven-antigravity', 'onp-spec-driven-codex'];

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

for (const skill of SKILLS) {
  const SCRIPTS = path.join(ROOT, 'skills', skill, 'scripts');

  test(`[${skill}] motor embarcado existe (rode: node tools/build-skill.mjs)`, () => {
    assert.ok(existsSync(SCRIPTS), `skills/${skill}/scripts/ não existe`);
  });

  test(`[${skill}] scripts/lib/src espelha src/ byte a byte`, () => {
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

  test(`[${skill}] scripts/lib/templates espelha templates/ (sem agents/)`, () => {
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

  test(`[${skill}] entrypoint onp-spec.mjs é o gerado pelo build`, () => {
    assert.equal(readFileSync(path.join(SCRIPTS, 'onp-spec.mjs'), 'utf-8'), ENTRY);
  });
}

// A SKILL.md de cada skill declara seu agente (o init usa o marcador para não
// instalar a skill errada) e todas mantêm a MESMA versão (política: bump junto).
test('SKILL.md: marcador agent correto e versões alinhadas', () => {
  const frontmatter = (skill) =>
    readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf-8').split('---')[1];
  const claude = frontmatter('onp-spec-driven');
  const ag = frontmatter('onp-spec-driven-antigravity');
  const codex = frontmatter('onp-spec-driven-codex');
  assert.match(claude, /^\s*agent:\s*claude\s*$/m);
  assert.match(ag, /^\s*agent:\s*antigravity\s*$/m);
  assert.match(codex, /^\s*agent:\s*codex\s*$/m);
  const versao = (fm) => fm.match(/^\s*version:\s*(\S+)/m)?.[1];
  assert.equal(versao(claude), versao(ag), 'versões das skills divergem — bump junto');
  assert.equal(versao(claude), versao(codex), 'versões das skills divergem — bump junto');
});

// As regras anti-fraude do contrato são sagradas: nenhuma skill pode perder
// "nunca enfraqueça/pule/apague teste" nem a degradação graciosa (PROVA FRACA).
test('SKILL.md: contrato e degradação graciosa presentes nas três skills', () => {
  for (const skill of SKILLS) {
    const conteudo = readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf-8');
    assert.match(conteudo, /Nunca enfraqueça, pule ou apague um teste/, `${skill}: regra 6 do contrato sumiu`);
    assert.match(conteudo, /skip\/todo\) não é prova/, `${skill}: "skip não é prova" sumiu`);
    assert.match(conteudo, /PROVA FRACA \(auditoria manual\)/, `${skill}: degradação graciosa sumiu`);
    assert.match(conteudo, /audit --ci` sai com código 0/, `${skill}: gate do audit sumiu`);
  }
});
