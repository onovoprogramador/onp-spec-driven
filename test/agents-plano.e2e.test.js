// E2E dos pontos multi-agente: init --agents (claude | antigravity | inválido),
// plano gerando os artefatos certos por agente (sh com sintaxe bash válida,
// html somente leitura, modo sequencial) e o comando tarefa.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');

const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-agents-'));
// ledger em pasta própria: teste NUNCA escreve no ~/.onp-spec do usuário
const homeOnp = path.join(root, '.onp-home');
after(() => rmSync(root, { recursive: true, force: true }));

function cli(...args) {
  const proc = spawnSync('node', [BIN, ...args], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  return { code: proc.status, out: `${proc.stdout}\n${proc.stderr}` };
}

test('init --agents inválido falha alto (exit 2), nada instalado', () => {
  const { code, out } = cli('init', '--agents', 'cursor');
  assert.equal(code, 2, out);
  assert.match(out, /--agents desconhecido/);
  assert.ok(!existsSync(path.join(root, '.claude')) && !existsSync(path.join(root, '.agents')));
});

test('init --agents claude instala a skill do Claude em .claude/skills/', () => {
  const { code, out } = cli('init', '--agents', 'claude');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.claude', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  assert.match(readFileSync(skillMd, 'utf-8'), /agent: claude/);
});

test('init --agents antigravity instala a skill do Antigravity em .agents/skills/', () => {
  const { code, out } = cli('init', '--agents', 'antigravity');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const conteudo = readFileSync(skillMd, 'utf-8');
  assert.match(conteudo, /agent: antigravity/);
  assert.match(conteudo, /Antigravity/);
});

test('motor embarcado de uma skill NÃO instala a skill do outro agente como se fosse a certa', () => {
  // o motor embarcado da skill claude (fallback ../../..) não pode servir a
  // skill claude quando pedem antigravity — tem que avisar e instruir
  const embarcado = path.join(root, '.claude', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs');
  rmSync(path.join(root, '.agents'), { recursive: true, force: true });
  const proc = spawnSync('node', [embarcado, 'init', '--agents', 'antigravity'], {
    cwd: root,
    encoding: 'utf-8',
  });
  const out = `${proc.stdout}\n${proc.stderr}`;
  assert.equal(proc.status, 0, out);
  assert.match(out, /skill para Antigravity não encontrada/);
  assert.ok(!existsSync(path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md')));
});

const SPEC = `# Spec: Pagamentos

> feature: pagamentos
> status: em-implementacao

## Histórias

### US-001 — Cobrança do mês

Como financeiro, quero cobrança automática, para receber em dia.

#### AC-001 — Cobrança criada

- **Dado** um aluno ativo
- **Quando** o mês vira
- **Então** a cobrança aparece para o aluno

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
`;

const TASKS = `# Tasks: Pagamentos

> feature: pagamentos

## T-001 — Modelo de cobrança [pendente]

- Refs: US-001, AC-001
- Arquivos: src/models/cobranca.js

## T-002 — Envio de recibo [pendente]

- Refs: AC-001
- Arquivos: src/services/recibo.js
- Modelo: claude-opus-5
- Esforço: alto

## T-003 — Rota de cobrança [pendente]

- Refs: AC-001
- Arquivos: src/models/cobranca.js, src/routes/cobranca.js
`;

test('plano (claude): gera md + sh executável com bash válido + html somente leitura', () => {
  cli('new', 'pagamentos');
  const dir = path.join(root, '.spec', 'features', 'pagamentos');
  writeFileSync(path.join(dir, 'spec.md'), SPEC);
  writeFileSync(path.join(dir, 'tasks.md'), TASKS);

  const { code, out } = cli('plano', 'pagamentos', '--agents', 'claude');
  assert.equal(code, 0, out);
  assert.match(out, /PODEM RODAR EM PARALELO em 2 faixa\(s\)/);
  assert.match(out, /onde está cada coisa/);
  // a escolha é do usuário: a saída ensina a rota sequencial
  assert.match(out, /--sequencial/);
  // acompanhamento é o resumo — servidor/painel não existe mais
  assert.match(out, /resumo geral de andamento/i);
  assert.doesNotMatch(out, /painel/);

  const md = readFileSync(path.join(dir, 'plano-execucao.md'), 'utf-8');
  assert.match(md, /faixa-1/);
  assert.match(md, /T-001[\s\S]*T-003/); // mesma faixa (arquivo compartilhado)

  const shPath = path.join(dir, 'executar-tarefas.sh');
  assert.ok(statSync(shPath).mode & 0o100, 'script precisa ser executável');
  const bashN = spawnSync('bash', ['-n', shPath], { encoding: 'utf-8' });
  assert.equal(bashN.status, 0, `bash -n falhou: ${bashN.stderr}`);
  const sh = readFileSync(shPath, 'utf-8');
  assert.match(sh, /rodar_tarefa 'faixa-2' 'T-002' '[\s\S]*?' 'claude-opus-5' high/); // T-002 sobrescreve
  assert.match(sh, /--output-format stream-json/); // stream do modelo p/ o painel
  assert.match(sh, /audit --ci/);

  // o dispatcher precisa aceitar reexecução por faixa de verdade
  const listar = spawnSync('bash', [shPath, '--listar'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(listar.status, 0, listar.stderr);
  assert.match(listar.stdout, /faixa-1\s+onda 1\s+T-001, T-003/);
  assert.match(listar.stdout, /faixa-2\s+onda 1\s+T-002/);
  assert.match(listar.stdout, /reexecutar uma faixa/);

  const html = readFileSync(path.join(dir, 'plano-execucao.html'), 'utf-8');
  assert.doesNotMatch(html, /<button/, 'execução é via agente — html sem botão');
  assert.match(html, /via agente/);

  const planoJson = JSON.parse(readFileSync(path.join(dir, 'plano.json'), 'utf-8'));
  assert.equal(planoJson.agent, 'claude');
  assert.equal(planoJson.modo, 'paralelo');
  assert.equal(planoJson.faixas.length, 2);
});

test('plano --sequencial (claude): uma tarefa após a outra, sh válido, sem faixas', () => {
  const dir = path.join(root, '.spec', 'features', 'pagamentos');
  const { code, out } = cli('plano', 'pagamentos', '--agents', 'claude', '--sequencial');
  assert.equal(code, 0, out);
  assert.match(out, /SEQUENCIAL — escolha do usuário/);
  assert.match(out, /uma após a outra/);

  const planoJson = JSON.parse(readFileSync(path.join(dir, 'plano.json'), 'utf-8'));
  assert.equal(planoJson.modo, 'sequencial');
  assert.deepEqual(planoJson.faixas, []);
  assert.deepEqual(planoJson.sequenciais.map((t) => t.id), ['T-001', 'T-002', 'T-003']);

  const shPath = path.join(dir, 'executar-tarefas.sh');
  const bashN = spawnSync('bash', ['-n', shPath], { encoding: 'utf-8' });
  assert.equal(bashN.status, 0, `bash -n falhou: ${bashN.stderr}`);
  const listar = spawnSync('bash', [shPath, '--listar'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(listar.status, 0, listar.stderr);
  assert.match(listar.stdout, /seq\s+T-001/);
  assert.doesNotMatch(listar.stdout, /faixa-1/);

  // volta o plano paralelo para os testes seguintes
  assert.equal(cli('plano', 'pagamentos', '--agents', 'claude').code, 0);
});

test('plano (antigravity): md com prompts por faixa, sem sh/html novos e sem claude -p', () => {
  const dir = path.join(root, '.spec', 'features', 'pagamentos');
  rmSync(path.join(dir, 'executar-tarefas.sh'));
  rmSync(path.join(dir, 'plano-execucao.html'));

  const { code, out } = cli('plano', 'pagamentos', '--agents', 'antigravity');
  assert.equal(code, 0, out);
  assert.match(out, /agente novo \(janela limpa\) por faixa/);
  const md = readFileSync(path.join(dir, 'plano-execucao.md'), 'utf-8');
  assert.match(md, /Prompt — faixa-1/);
  assert.match(md, /Antigravity/);
  assert.doesNotMatch(md, /claude -p/);
  assert.ok(!existsSync(path.join(dir, 'executar-tarefas.sh')), 'antigravity não gera o sh');
  assert.ok(!existsSync(path.join(dir, 'plano-execucao.html')), 'antigravity não gera o html');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'plano.json'), 'utf-8')).agent, 'antigravity');
});

test('tarefa atualiza o status no tasks.md (e valida entrada)', () => {
  const { code, out } = cli('tarefa', 'pagamentos', 'T-002', 'concluida');
  assert.equal(code, 0, out);
  const tasks = readFileSync(path.join(root, '.spec', 'features', 'pagamentos', 'tasks.md'), 'utf-8');
  assert.match(tasks, /## T-002 — Envio de recibo \[concluida\]/);

  assert.equal(cli('tarefa', 'pagamentos', 'T-099', 'concluida').code, 2);
  assert.equal(cli('tarefa', 'pagamentos', 'T-001', 'meio-feita').code, 2);
});

test('upgrade: plano de versão anterior (sem runId) é registrado no ledger em vez de sumir', () => {
  const planoPath = path.join(root, '.spec', 'features', 'pagamentos', 'plano.json');
  // simula o artefato de uma versão que não tinha ledger
  const antigo = JSON.parse(readFileSync(planoPath, 'utf-8'));
  delete antigo.runId;
  writeFileSync(planoPath, JSON.stringify(antigo, null, 2));

  // regenerar o plano registra a execução no ledger global (fonte do resumo)
  const r = cli('plano', 'pagamentos');
  assert.equal(r.code, 0, r.out);
  const novo = JSON.parse(readFileSync(planoPath, 'utf-8'));
  assert.ok(novo.runId, 'plano regenerado ganha identificador de execução');

  // e o ledger passa a conhecer essa execução
  const ledger = readFileSync(path.join(homeOnp, 'painel', 'ledger.jsonl'), 'utf-8');
  assert.ok(ledger.includes(novo.runId), 'execução registrada no ledger global');
  assert.ok(ledger.includes('"tipo":"plano"'));
});

test('plano detecta o agente pelo que está instalado quando não há flag', () => {
  // este root tem só .claude/skills → default claude gera o sh
  const { code, out } = cli('plano', 'pagamentos');
  assert.equal(code, 0, out);
  assert.match(out, /plano de execução \(claude\)/);
});
