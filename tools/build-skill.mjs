// Gera o motor embarcado da skill: copia src/ e templates/ para dentro de
// skills/onp-spec-driven/scripts/ e escreve o entrypoint.
//
// A skill é AUTOSSUFICIENTE: copiar a pasta skills/onp-spec-driven para
// .claude/skills/ é a instalação inteira (sem npm, sem npx, sem CLI global).
// test/skill-sync.test.js falha se scripts/ divergir do que este build gera.

import { cpSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['onp-spec-driven', 'onp-spec-driven-antigravity', 'onp-spec-driven-codex', 'onp-spec-driven-cursor'];
export const ENTRY = `#!/usr/bin/env node
// Entrypoint do motor embarcado da skill onp-spec-driven.
// Uso (a partir da RAIZ do projeto do usuário):
//   node <dir-da-skill>/scripts/onp-spec.mjs <comando> [opções]
// Gerado por tools/build-skill.mjs — não edite à mão; edite src/ e regenere.
import { run } from './lib/src/cli.js';

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(\`erro: \${err.message}\`);
    process.exitCode = 2;
  }
);
`;

export function buildSkillDir(scriptsDir) {
  rmSync(scriptsDir, { recursive: true, force: true });
  mkdirSync(path.join(scriptsDir, 'lib'), { recursive: true });
  cpSync(path.join(ROOT, 'src'), path.join(scriptsDir, 'lib', 'src'), { recursive: true });
  cpSync(path.join(ROOT, 'templates'), path.join(scriptsDir, 'lib', 'templates'), {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}agents`),
  });
  writeFileSync(path.join(scriptsDir, 'onp-spec.mjs'), ENTRY);
  return scriptsDir;
}

export function buildSkill() {
  return SKILLS.map((skill) => buildSkillDir(path.join(ROOT, 'skills', skill, 'scripts')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outs = buildSkill();
  for (const out of outs) {
    console.log(`✔ motor embarcado gerado em ${path.relative(ROOT, out)}/`);
  }
}
