// Adaptador onp-spec-driven: materializa o cenário no formato .spec/, roda
// `onp-spec audit --ci` de verdade e devolve os códigos de achado detectados.

import { mkdirSync, writeFileSync, rmSync, cpSync } from 'fs';
import path from 'path';
import { loadConfig } from '../../src/config.js';
import { loadProject } from '../../src/core/project.js';
import { auditProject } from '../../src/core/audit.js';
import { runVerify } from '../../src/core/verify.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, '..', '..', 'templates');

function renderSpec(f) {
  const lines = [`# Spec: ${f.title}`, '', `> feature: ${f.feature}`, `> status: ${f.status || 'em-implementacao'}`, '', '## Contexto', '', f.purpose, '', '## Histórias', ''];
  for (const s of f.stories) {
    lines.push(`### ${s.id} — ${s.title}`, '', `Como ${s.as}, quero ${s.want}, para que ${s.so}.`, '');
    for (const ac of s.acs) {
      lines.push(`#### ${ac.id} — ${ac.title}`, '');
      if (ac.given) lines.push(`- **Dado** ${ac.given}`);
      if (ac.when) lines.push(`- **Quando** ${ac.when}`);
      if (ac.then) lines.push(`- **Então** ${ac.then}`);
      lines.push('');
    }
  }
  lines.push('## Suposições', '', '| ID | Suposição | Status | Resolução |', '|---|---|---|---|');
  for (const a of f.assumptions) lines.push(`| ${a.id} | ${a.text} | ${a.status} | ${a.resolution} |`);
  lines.push('', '## Perguntas em aberto', '', '| ID | Pergunta | Status | Resposta |', '|---|---|---|---|');
  for (const q of f.questions || []) lines.push(`| ${q.id} | ${q.text} | ${q.status} | ${q.answer || '—'} |`);
  lines.push('');
  return lines.join('\n');
}

function renderTasks(f) {
  const lines = [`# Tasks: ${f.title}`, '', `> feature: ${f.feature}`, ''];
  let t = 1;
  for (const s of f.stories) {
    for (const ac of s.acs) {
      const status = f.__taskConcluidaComFalha?.includes(ac.id) ? 'concluida' : 'pendente';
      const refs = [ac.id];
      if (f.__refQuebrada && t === 1) refs.push(f.__refQuebrada);
      lines.push(`## T-${String(t).padStart(3, '0')} — Implementar ${ac.title} [${status}]`, '', `- Refs: ${refs.join(', ')}`, `- Arquivos: src/${f.feature}.js`, '');
      t++;
    }
  }
  return lines.join('\n');
}

// Gera um teste anotado por AC (menos os que o cenário quer sem teste),
// e o vazamento de privacidade / código órfão quando aplicável.
function renderTestFile(f) {
  const semTeste = new Set(f.__semTeste || []);
  const lines = [`import { test } from 'node:test';`, `import assert from 'node:assert/strict';`, ''];
  for (const s of f.stories) {
    for (const ac of s.acs) {
      if (semTeste.has(ac.id)) continue;
      // teste órfão: título usa o ID antigo mesmo com a spec renomeada
      const tagId = f.__testeOrfao && ac.id === f.__testeOrfao.specId ? f.__testeOrfao.testId : ac.id;
      const passa = !(f.__taskConcluidaComFalha?.includes(ac.id));
      lines.push(`test('${ac.id}: ${ac.title} @spec:${tagId}', () => {`);
      lines.push(passa ? `  assert.ok(true);` : `  assert.fail('ainda não implementado');`);
      lines.push(`});`, '');
    }
  }
  // testes de princípio: a constituição base exige @principle:P-001;
  // o preset LGPD exige também P-002 e P-003.
  const principios = f.constitution ? ['P-001', 'P-002', 'P-003'] : ['P-001'];
  for (const p of principios) {
    lines.push(`test('princípio ${p} @principle:${p}', () => { assert.ok(true); });`, '');
  }
  return lines.join('\n');
}

export async function runOnpSpec(scenario, workDir) {
  const f = scenario.feature;
  const root = path.join(workDir, 'onpspec');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, '.spec', 'features', f.feature), { recursive: true });
  mkdirSync(path.join(root, '.spec', 'verification'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'test'), { recursive: true });

  // config
  writeFileSync(path.join(root, 'onpspec.config.json'), JSON.stringify({ testCommand: 'node --test', reporter: 'tap' }, null, 2));

  // constituição (preset LGPD para feature de notas)
  const presetFile = f.constitution ? 'constituicao-lgpd-educacao.md' : 'constituicao-base.md';
  cpSync(path.join(TEMPLATES, presetFile), path.join(root, '.spec', 'constituicao.md'));

  // spec + tasks
  writeFileSync(path.join(root, '.spec', 'features', f.feature, 'spec.md'), renderSpec(f));
  writeFileSync(path.join(root, '.spec', 'features', f.feature, 'tasks.md'), renderTasks(f));

  // código de implementação
  let src = `export function impl(){ return true; }\n`;
  if (f.__vazamento) src += `export function lerNota(nota){ ${f.__vazamento} return nota; }\n`;
  writeFileSync(path.join(root, 'src', `${f.feature}.js`), src);
  if (f.__codigoOrfao) {
    const p = path.join(root, f.__codigoOrfao);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, `export const secreto = () => 'coleta não mapeada';\n`);
  }

  // testes
  writeFileSync(path.join(root, 'test', `${f.feature}.spec.test.js`), renderTestFile(f));

  // roda verify (grava prova) — pra distinguir AC_SEM_PROVA de PASS real,
  // e detectar PRONTO_PREMATURO (task concluída com teste falhando)
  const config = loadConfig(root);
  let project = loadProject(config);
  try {
    runVerify(project, f.feature);
  } catch {
    // sem testes/verify — segue; o audit acusa o que faltar
  }

  // recarrega após verify e audita em modo CI
  project = loadProject(loadConfig(root));
  const audit = auditProject(project, { ci: true });
  const codes = [...new Set(audit.findings.filter((x) => x.severity === 'erro').map((x) => x.code))];
  return { detectedCodes: codes, ok: audit.ok, allFindings: audit.findings };
}
