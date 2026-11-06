// Garante que o motor embarcado em CADA skill (claude, antigravity, codex e
// cursor e opencode) está sincronizado com src/ e templates/ — mata o drift silencioso
// (SK-5). Se este teste falhar: node tools/build-skill.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENTRY, SKILLS, RUNTIME_PACKAGE } from '../tools/build-skill.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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

  test(`[${skill}] formato ESM explícito funciona sem depender do package.json do projeto`, () => {
    assert.equal(readFileSync(path.join(SCRIPTS, 'lib', 'package.json'), 'utf8'), RUNTIME_PACKAGE);
  });

  test(`[${skill}] entrypoint onp-spec.mjs é o gerado pelo build`, () => {
    assert.equal(readFileSync(path.join(SCRIPTS, 'onp-spec.mjs'), 'utf-8'), ENTRY);
  });
}

// Instalação usa o mesmo nome público e marcador de harness para evitar que
// uma variante sobrescreva outra. Todos os pacotes devem permanecer completos.
test('SKILL.md: cinco variantes instaláveis, marcadores e versões alinhadas', () => {
  const agents = ['claude', 'antigravity', 'codex', 'cursor', 'opencode'];
  assert.equal(SKILLS.length, agents.length);
  const versions = new Set();
  for (const [index, skill] of SKILLS.entries()) {
    const frontmatter = readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf-8').split('---')[1];
    assert.match(frontmatter, /^name: onp-spec-driven$/m);
    assert.match(frontmatter, /^description: .+/m);
    assert.equal(frontmatter.match(/^\s*agent:\s*(\S+)/m)?.[1], agents[index]);
    versions.add(frontmatter.match(/^\s*version:\s*(\S+)/m)?.[1]);
  }
  assert.equal(versions.size, 1);
  assert.ok(!versions.has(undefined));
});

test('SKILL.md: referências locais resolvem em cada pacote autossuficiente', () => {
  for (const skill of SKILLS) {
    const base = path.join(ROOT, 'skills', skill);
    for (const rel of ['SKILL.md', ...walk(path.join(base, 'references')).map(f => `references/${f}`)]) {
      const file = path.join(base, rel);
      const content = readFileSync(file, 'utf-8');
      for (const [, target] of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        if (/^(?:https?:|#)/.test(target)) continue;
        assert.ok(existsSync(path.resolve(path.dirname(file), target.split('#')[0])), `${skill}/${rel}: link local quebrado ${target}`);
      }
    }
  }
});

// Contratos que não podem sumir na atualização das instruções distribuídas.
test('SKILL.md: prova, autorização e encerramento preservados nos cinco harnesses', () => {
  for (const skill of SKILLS) {
    const content = readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf-8');
    assert.match(content, /Nunca enfraqueça, pule ou apague um teste/);
    assert.match(content, /skip\/todo\) não é prova/);
    assert.match(content, /PROVA FRACA \(auditoria manual\)/);
    assert.match(content, /audit --ci` sai com código 0/);
    assert.match(content, /não aumente custo nem troque provedor silenciosamente/);
    assert.match(content, /5% ou menos/);
    assert.match(content, /consulte novamente e só retome com limite liberado/);
    assert.match(content, /Ao final de cada sessão/);
    assert.match(content, /Sem resposta, preserve tudo/);
    assert.match(content, /design.md.*TDD/s);
    assert.doesNotMatch(content, /claude-(?:sonnet|haiku|opus)-\d|gpt-\d|--modelo composer/);
  }
});
