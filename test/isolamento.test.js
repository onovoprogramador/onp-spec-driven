// Guarda-corpo: rodar `npm test` não pode sujar a máquina de quem clonou o
// repositório. O ledger é global por natureza (~/.onp-spec), então todo teste
// que invoca o CLI precisa apontar ONP_SPEC_HOME para uma pasta temporária.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { existsSync, statSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');
const HOME_REAL = path.join(os.homedir(), '.onp-spec');

function fotografar(dir) {
  if (!existsSync(dir)) return null;
  const arquivos = [];
  const andar = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) andar(full);
      else arquivos.push(`${path.relative(dir, full)}:${statSync(full).size}`);
    }
  };
  andar(dir);
  return arquivos.sort().join('|');
}

test('ONP_SPEC_HOME redireciona o ledger e deixa o home real intocado', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-iso-'));
  try {
    const antes = fotografar(HOME_REAL);
    const r = spawnSync('node', [BIN, 'evento', '--run', 'teste-isolamento', '--tipo', 'inicio'], {
      encoding: 'utf-8',
      env: { ...process.env, ONP_SPEC_HOME: tmp },
    });
    assert.equal(r.status, 0, r.stderr);
    const ledger = path.join(tmp, 'painel', 'ledger.jsonl');
    assert.ok(existsSync(ledger), 'ledger foi escrito no ONP_SPEC_HOME');
    assert.match(readFileSync(ledger, 'utf-8'), /teste-isolamento/);
    assert.equal(fotografar(HOME_REAL), antes, 'o ~/.onp-spec do usuário não foi tocado');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('nenhuma execução de teste vazou para o ledger do usuário', () => {
  const ledger = path.join(HOME_REAL, 'painel', 'ledger.jsonl');
  if (!existsSync(ledger)) return; // máquina limpa: nada a checar
  const vazados = readFileSync(ledger, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return {};
      }
    })
    .filter(
      (e) =>
        // repo na raiz do mkdtemp: o prefixo aparece no nome do projeto;
        // repo em subpasta (<tmp>/projeto, caso dos testes reexec): o
        // prefixo só aparece no CAMINHO — sem olhar projetoDir, um
        // vazamento dos testes reexec passaria despercebido
        /^onpspec-(agents|reexec|iso|painel|ledger|ui|e2e)-/.test(e.projeto || '') ||
        /onpspec-(agents|reexec|iso|painel|ledger|ui|e2e)-/.test(e.projetoDir || '')
    )
    .map((e) => e.runId);
  assert.deepEqual(
    vazados,
    [],
    `execuções de teste no ledger do usuário — algum teste esqueceu ONP_SPEC_HOME:\n${vazados.join('\n')}`
  );
});
