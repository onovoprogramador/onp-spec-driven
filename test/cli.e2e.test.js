// Teste ponta-a-ponta do fluxo real:
// init → new → escrever spec → scaffold → verify (testes falham) →
// implementar → verify (passa) → audit --ci limpo.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');

const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-e2e-'));
after(() => rmSync(root, { recursive: true, force: true }));

function cli(...args) {
  const proc = spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf-8' });
  return { code: proc.status, out: `${proc.stdout}\n${proc.stderr}` };
}

const SPEC = `# Spec: Entrega de dever

> feature: entrega-dever
> status: em-implementacao

## Histórias

### US-001 — Aluno entrega dever

Como aluno, quero enviar meu dever, para que o professor corrija.

#### AC-001 — Entrega no prazo

- **Dado** um aluno com tarefa aberta
- **Quando** envia antes do prazo
- **Então** status é "no prazo"

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-001 | Sem reenvio | confirmada | ok |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
`;

test('init cria .spec, constituição preset e config', () => {
  const { code, out } = cli('init', '--preset', 'lgpd-educacao');
  assert.equal(code, 0, out);
  assert.ok(existsSync(path.join(root, '.spec', 'constituicao.md')));
  assert.ok(existsSync(path.join(root, 'onpspec.config.json')));
  const constitution = readFileSync(path.join(root, '.spec', 'constituicao.md'), 'utf-8');
  assert.match(constitution, /LGPD/);
  assert.match(constitution, /P-001 \[DEVE\]/);
});

test('new cria feature com templates', () => {
  const { code, out } = cli('new', 'entrega-dever');
  assert.equal(code, 0, out);
  assert.ok(existsSync(path.join(root, '.spec', 'features', 'entrega-dever', 'spec.md')));
});

test('audit acusa AC_SEM_TESTE antes do scaffold', () => {
  writeFileSync(path.join(root, '.spec', 'features', 'entrega-dever', 'spec.md'), SPEC);
  // remove tasks do template pra não poluir este passo
  rmSync(path.join(root, '.spec', 'features', 'entrega-dever', 'tasks.md'));
  const { code, out } = cli('audit');
  assert.equal(code, 1);
  assert.match(out, /AC_SEM_TESTE/);
});

test('scaffold gera teste que falha com a tag @spec', () => {
  const { code, out } = cli('scaffold', 'entrega-dever');
  assert.equal(code, 0, out);
  const testFile = path.join(root, 'test', 'entrega-dever.spec.test.js');
  assert.ok(existsSync(testFile));
  const content = readFileSync(testFile, 'utf-8');
  assert.match(content, /@spec:AC-001/);
  assert.match(content, /Dado: um aluno com tarefa aberta/);
});

test('verify com teste falhando registra fail e sai 1', () => {
  const { code, out } = cli('verify', 'entrega-dever');
  assert.equal(code, 1, out);
  const record = JSON.parse(
    readFileSync(path.join(root, '.spec', 'verification', 'entrega-dever.json'), 'utf-8')
  );
  assert.equal(record.results['AC-001'].status, 'fail');
});

test('após implementar, verify passa e audit --ci fecha o ciclo', () => {
  // "implementa": teste real que passa + tasks + testes de princípio da constituição
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'entrega.js'),
    `export function statusEntrega(enviadoEm, prazo) {\n  return enviadoEm <= prazo ? 'no prazo' : 'atrasada';\n}\n`
  );
  writeFileSync(
    path.join(root, 'test', 'entrega-dever.spec.test.js'),
    `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusEntrega } from '../src/entrega.js';

test('AC-001: entrega no prazo @spec:AC-001', () => {
  assert.equal(statusEntrega(1, 2), 'no prazo');
});
test('nota nunca exposta @principle:P-001', () => { assert.ok(true); });
test('acesso a nota registrado @principle:P-002', () => { assert.ok(true); });
test('menores com base legal @principle:P-003', () => { assert.ok(true); });
`
  );
  writeFileSync(
    path.join(root, '.spec', 'features', 'entrega-dever', 'tasks.md'),
    `# Tasks\n\n## T-001 — Função de status [concluida]\n\n- Refs: US-001, AC-001\n- Arquivos: src/entrega.js\n`
  );

  const verify = cli('verify', 'entrega-dever');
  assert.equal(verify.code, 0, verify.out);

  const audit = cli('audit', '--ci');
  assert.equal(audit.code, 0, audit.out);
  assert.match(audit.out, /auditoria limpa/);
});

test('drift é pego: renomear AC na spec quebra o audit', () => {
  const drifted = SPEC.replace(/AC-001/g, 'AC-050');
  writeFileSync(path.join(root, '.spec', 'features', 'entrega-dever', 'spec.md'), drifted);
  const { code, out } = cli('audit', '--ci');
  assert.equal(code, 1);
  assert.match(out, /TESTE_ORFAO/); // teste aponta pra AC-001 que não existe mais
  assert.match(out, /AC_SEM_TESTE/); // AC-050 novo não tem teste
  // restaura
  writeFileSync(path.join(root, '.spec', 'features', 'entrega-dever', 'spec.md'), SPEC);
});

test('status e assumptions rodam sem erro', () => {
  assert.equal(cli('status').code, 0);
  assert.equal(cli('assumptions').code, 0);
});
