import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, allAcs } from '../src/parsers/spec.js';
import { parseTasks } from '../src/parsers/tasks.js';
import { parseConstitution } from '../src/parsers/constitution.js';
import { globToRegExp } from '../src/util/text.js';

const SPEC_OK = `# Spec: Entrega de dever

> feature: entrega-dever
> status: em-implementacao

## Histórias

### US-001 — Aluno entrega dever

Como aluno, quero enviar meu dever, para que o professor corrija.

#### AC-001 — Entrega no prazo

- **Dado** um aluno autenticado com tarefa aberta
- **Quando** ele envia o arquivo antes do prazo
- **Então** a entrega é registrada com status "no prazo"

#### AC-002 — Entrega atrasada

- **Dado** um aluno autenticado com tarefa aberta
- **Quando** ele envia depois do prazo
- **Então** a entrega é marcada como "atrasada"
- **E** o aluno vê um aviso de atraso

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-001 | Não pode reenviar após correção | aberta | — |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-001 | Fuso do prazo? | respondida | America/Sao_Paulo |
`;

test('parseSpec extrai feature, status, US, AC com Dado/Quando/Então', () => {
  const spec = parseSpec(SPEC_OK);
  assert.equal(spec.feature, 'entrega-dever');
  assert.equal(spec.status, 'em-implementacao');
  assert.equal(spec.stories.length, 1);
  assert.equal(spec.stories[0].id, 'US-001');
  const acs = allAcs(spec);
  assert.equal(acs.length, 2);
  assert.deepEqual(acs.map((a) => a.id), ['AC-001', 'AC-002']);
  assert.equal(acs[0].given.length, 1);
  assert.equal(acs[0].when.length, 1);
  assert.equal(acs[0].then.length, 1);
});

test('parseSpec: cláusula "E" continua a última cláusula (Então)', () => {
  const spec = parseSpec(SPEC_OK);
  const ac2 = allAcs(spec)[1];
  assert.equal(ac2.then.length, 2);
});

test('parseSpec extrai suposições e perguntas com status', () => {
  const spec = parseSpec(SPEC_OK);
  assert.equal(spec.assumptions.length, 1);
  assert.deepEqual(spec.assumptions[0], {
    id: 'ASM-001',
    text: 'Não pode reenviar após correção',
    status: 'aberta',
    resolution: '—',
    line: spec.assumptions[0].line,
  });
  assert.equal(spec.questions.length, 1);
  assert.equal(spec.questions[0].status, 'respondida');
  assert.equal(spec.questions[0].answer, 'America/Sao_Paulo');
});

test('parseSpec: seções com e sem acento funcionam (Suposições/Suposicoes)', () => {
  const noAccent = SPEC_OK.replace('## Suposições', '## Suposicoes').replace(
    '## Perguntas em aberto',
    '## Perguntas em Aberto'
  );
  const spec = parseSpec(noAccent);
  assert.equal(spec.assumptions.length, 1);
  assert.equal(spec.questions.length, 1);
});

test('parseSpec sinaliza AC fora de US', () => {
  const spec = parseSpec(`# Spec: X\n\n#### AC-001 — Solto\n\n- **Dado** x\n- **Quando** y\n- **Então** z\n`);
  assert.equal(spec.parseIssues.length, 1);
  assert.equal(spec.parseIssues[0].code, 'AC_FORA_DE_US');
});

test('parseTasks extrai id, status, refs e arquivos', () => {
  const tasks = parseTasks(`# Tasks

## T-001 — Modelo de entrega [concluida]

- Refs: US-001, AC-001
- Arquivos: src/models/entrega.js, src/routes/entrega.js

## T-002 — Aviso de atraso [pendente]

- Refs: AC-002
- Arquivos: src/ui/aviso.js
`);
  assert.equal(tasks.tasks.length, 2);
  assert.equal(tasks.tasks[0].status, 'concluida');
  assert.deepEqual(tasks.tasks[0].refs, ['US-001', 'AC-001']);
  assert.deepEqual(tasks.tasks[0].files, ['src/models/entrega.js', 'src/routes/entrega.js']);
  assert.equal(tasks.tasks[1].status, 'pendente');
});

test('parseTasks: task sem status vira pendente com aviso', () => {
  const tasks = parseTasks(`## T-001 — Sem status\n- Refs: AC-001\n`);
  assert.equal(tasks.tasks[0].status, 'pendente');
  assert.equal(tasks.parseIssues[0].code, 'TASK_SEM_STATUS');
});

test('parseConstitution extrai princípios, níveis e verificações', () => {
  const c = parseConstitution(`# Constituição — v1.2.0

## P-001 [DEVE] Nota nunca exposta a outro aluno

Texto do princípio.

- verificação(teste): @principle:P-001
- verificação(proibido): \`SELECT \\* FROM notas\` em \`src/**/*.js\`

## P-007 [PODE] Exclusão a pedido
`);
  assert.equal(c.version, '1.2.0');
  assert.equal(c.principles.length, 2);
  assert.equal(c.principles[0].level, 'DEVE');
  assert.equal(c.principles[0].checks.length, 2);
  assert.equal(c.principles[0].checks[0].kind, 'teste');
  assert.equal(c.principles[0].checks[1].kind, 'proibido');
  assert.equal(c.principles[0].checks[1].glob, 'src/**/*.js');
  assert.equal(c.principles[1].level, 'PODE');
});

test('globToRegExp: ** casa diretórios, * não atravessa /', () => {
  assert.ok(globToRegExp('src/**').test('src/a/b/c.js'));
  assert.ok(globToRegExp('src/**/*.js').test('src/a/b/c.js'));
  assert.ok(globToRegExp('src/**/*.js').test('src/c.js'));
  assert.ok(!globToRegExp('src/*.js').test('src/a/c.js'));
  assert.ok(globToRegExp('test/**').test('test/x.test.js'));
  assert.ok(!globToRegExp('src/**').test('lib/x.js'));
});
