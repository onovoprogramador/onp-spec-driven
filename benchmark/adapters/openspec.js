// Adaptador OpenSpec: materializa a MESMA feature no formato OpenSpec
// (specs/<id>/spec.md com Purpose/Requirements/Scenario e frases SHALL) e roda
// o `openspec validate --specs <id> --strict` REAL, capturando o veredito.
//
// Onde a classe de defeito é inexprimível no modelo do OpenSpec (testes,
// suposições, privacidade, código órfão), a spec materializada valida "limpa" —
// e isso é exatamente o ponto: a ferramenta não tem como enxergar o defeito.

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// caminho para o binário do OpenSpec: variável de ambiente ou o vendorizado
// por benchmark/setup.sh em benchmark/.vendor/OpenSpec/bin/openspec.js.
const vendored = path.join(__dirname, '..', '.vendor', 'OpenSpec', 'bin', 'openspec.js');
export const OPENSPEC_BIN =
  process.env.OPENSPEC_BIN || (existsSync(vendored) ? vendored : null);

function renderOpenSpecSpec(f) {
  const lines = [`# ${f.feature} Specification`, '', '## Purpose', '', f.purpose, '', '## Requirements', ''];
  for (const s of f.stories) {
    for (const ac of s.acs) {
      lines.push(`### Requirement: ${ac.title}`, '');
      // frase normativa SHALL derivada do Então (ou vazia se incompleto)
      if (ac.then) {
        lines.push(`O sistema SHALL garantir que, ${ac.given}, quando ${ac.when}, então ${ac.then}.`, '');
      } else {
        // requisito incompleto: sem frase normativa clara
        lines.push(`O sistema trata ${ac.title.toLowerCase()}.`, '');
      }
      // cenário — omitido se o defeito é "incompleto/sem comportamento"
      if (ac.then) {
        lines.push(`#### Scenario: ${ac.title}`, '');
        lines.push(`- **WHEN** ${ac.when}`);
        lines.push(`- **THEN** ${ac.then}`, '');
      }
    }
  }
  return lines.join('\n');
}

export function runOpenSpec(scenario, workDir) {
  if (!OPENSPEC_BIN || !existsSync(OPENSPEC_BIN)) {
    return { available: false, detected: false, note: 'binário do OpenSpec não encontrado' };
  }
  const f = scenario.feature;
  const root = path.join(workDir, 'openspec');
  rmSync(root, { recursive: true, force: true });
  const specDir = path.join(root, 'openspec', 'specs', f.feature);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(path.join(specDir, 'spec.md'), renderOpenSpecSpec(f));

  const proc = spawnSync('node', [OPENSPEC_BIN, 'validate', '--specs', f.feature, '--strict'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, OPENSPEC_TELEMETRY: '0', NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: undefined },
  });
  const out = `${proc.stdout || ''}\n${proc.stderr || ''}`;
  // OpenSpec imprime "failed" quando a validação estrutural falha
  const failed = /\d+ failed/.test(out) && !/0 failed/.test(out);
  const invalid = /is not valid|✗/.test(out);
  const detected = failed || invalid;
  return { available: true, detected, exitCode: proc.status, out: out.trim() };
}
