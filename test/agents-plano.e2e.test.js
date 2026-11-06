// E2E: instalação por harness, plano Node portátil, seleção e governança.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { selectExecutionPlan } from '../src/core/plan-artifacts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');

const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-agents-'));
// ledger em pasta própria: teste NUNCA escreve no ~/.onp-spec do usuário
const homeOnp = path.join(root, '.onp-home');
after(() => rmSync(root, { recursive: true, force: true }));

function cli(...args) {
  const proc = spawnSync(process.execPath, [BIN, ...args], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  return { code: proc.status, out: `${proc.stdout}\n${proc.stderr}` };
}

test('init --agents inválido falha alto (exit 2), nada instalado', () => {
  const { code, out } = cli('init', '--agents', 'copilot');
  assert.equal(code, 2, out);
  assert.match(out, /--agents desconhecido/);
  assert.ok(
    !existsSync(path.join(root, '.claude')) &&
      !existsSync(path.join(root, '.agents')) &&
      !existsSync(path.join(root, '.cursor'))
  );
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
  const proc = spawnSync(process.execPath, [embarcado, 'init', '--agents', 'antigravity'], {
    cwd: root,
    encoding: 'utf-8',
  });
  const out = `${proc.stdout}\n${proc.stderr}`;
  assert.equal(proc.status, 0, out);
  assert.match(out, /skill para Antigravity não encontrada/);
  assert.ok(!existsSync(path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md')));
});

test('init --agents codex NÃO sobrescreve a skill do Antigravity (compartilham .agents/skills)', () => {
  assert.equal(cli('init', '--agents', 'antigravity').code, 0);
  const { code, out } = cli('init', '--agents', 'codex');
  assert.equal(code, 2, out);
  assert.match(out, /já contém a skill do agente "antigravity"/);
  assert.match(out, /--nova-versao/);
  assert.doesNotMatch(out, /rm -rf/);
  // a skill do Antigravity ficou intacta
  const skillMd = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.match(readFileSync(skillMd, 'utf-8'), /agent: antigravity/);
});

test('init --agents codex instala a skill do Codex em .agents/skills/ (o diretório de skills do Codex)', () => {
  rmSync(path.join(root, '.agents'), { recursive: true, force: true });
  const { code, out } = cli('init', '--agents', 'codex');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const conteudo = readFileSync(skillMd, 'utf-8');
  assert.match(conteudo, /agent: codex/);
  assert.match(conteudo, /Codex/);
  // autossuficiente: o motor embarcado veio junto
  assert.ok(existsSync(path.join(root, '.agents', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs')));
  // e rodar de novo mantém, sem reclamar
  const denovo = cli('init', '--agents', 'codex');
  assert.equal(denovo.code, 0, denovo.out);
});

test('init --agents cursor instala a skill do Cursor em .cursor/skills/ (o diretório de skills do Cursor)', () => {
  const { code, out } = cli('init', '--agents', 'cursor');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.cursor', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const conteudo = readFileSync(skillMd, 'utf-8');
  assert.match(conteudo, /agent: cursor/);
  assert.match(conteudo, /Cursor/);
  // o Cursor exige name igual ao nome da pasta instalada
  assert.match(conteudo, /^name: onp-spec-driven$/m);
  // autossuficiente: o motor embarcado veio junto
  assert.ok(existsSync(path.join(root, '.cursor', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs')));
  // o Cursor também lê .agents/skills (e .claude/.codex por compatibilidade):
  // com a skill do codex instalada ali, o init AVISA o conflito de leitura
  assert.match(out, /também tem a skill do agente "codex"/);
  assert.match(out, /Selecione explicitamente a variante do Cursor/);
  assert.doesNotMatch(out, /rm -rf/);
  // e rodar de novo mantém, sem erro (aviso não é bloqueio — a escolha é do usuário)
  const denovo = cli('init', '--agents', 'cursor');
  assert.equal(denovo.code, 0, denovo.out);
  assert.match(readFileSync(path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md'), 'utf-8'), /agent: codex/);
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
- Modelo: modelo-da-conta
- Esforço: alto

## T-003 — Rota de cobrança [pendente]

- Refs: AC-001
- Arquivos: src/models/cobranca.js, src/routes/cobranca.js
`;


test('init --agents opencode instala skill própria e motor autossuficiente', () => {
  const r = cli('init', '--agents', 'opencode');
  assert.equal(r.code, 0, r.out);
  const dir = path.join(root, '.opencode/skills/onp-spec-driven');
  assert.match(readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), /agent: opencode/);
  assert.ok(existsSync(path.join(dir, 'scripts/onp-spec.mjs')));
  // Restaura o cenário multi-instalação histórico dos testes de detecção.
  rmSync(path.join(root, '.opencode'), { recursive: true, force: true });
});

test('prepara feature com duas faixas e modelo explicitamente escolhido na tarefa', () => {
  assert.equal(cli('new', 'pagamentos').code, 0);
  const dir = path.join(root, '.spec/features/pagamentos');
  writeFileSync(path.join(dir, 'spec.md'), SPEC);
  writeFileSync(path.join(dir, 'tasks.md'), TASKS);
});

const previousPlanArtifacts = new Map();
for (const harness of ['claude', 'codex', 'cursor', 'antigravity', 'opencode']) {
  test(`plano ${harness}: execução nativa nova preserva HTML e planos existentes`, () => {
    const dir = path.join(root, '.spec/features/pagamentos');
    // O artefato antigo continua no caminho original, byte a byte.
    const oldHtml = '<html>plano antigo</html>';
    if (!existsSync(path.join(dir, 'plano-execucao.html'))) writeFileSync(path.join(dir, 'plano-execucao.html'), oldHtml);
    const documents = new Map(['spec.md', 'tasks.md'].map(name => [name, readFileSync(path.join(dir, name))]));
    const { code, out } = cli('plano', 'pagamentos', '--agents', harness);
    assert.equal(code, 0, out);
    assert.match(out, /PODEM RODAR EM PARALELO em 2 faixa\(s\)/);
    assert.match(out, /--sequencial/);
    assert.match(out, /executar-tarefas\.mjs/);
    assert.match(out, /harness --agents/);
    assert.equal(readFileSync(path.join(dir, 'plano-execucao.html'), 'utf8'), oldHtml);
    for (const [name, bytes] of documents) assert.deepEqual(readFileSync(path.join(dir, name)), bytes, name);
    for (const [file, bytes] of previousPlanArtifacts) assert.deepEqual(readFileSync(file), bytes, `plano anterior preservado: ${file}`);
    const plan = selectExecutionPlan(root, 'pagamentos');
    assert.equal(plan.artifactDir, `.spec/features/pagamentos/execucoes/${plan.runId}`);
    const artifacts = path.join(root, plan.artifactDir);
    assert.ok(!existsSync(path.join(artifacts, 'plano-execucao.html')), 'nenhum painel novo');
    for (const name of ['plano.json', 'plano-execucao.md', 'executar-tarefas.mjs', 'executar-tarefas.sh']) {
      const file = path.join(artifacts, name);
      assert.ok(!previousPlanArtifacts.has(file), 'destino próprio da execução');
      previousPlanArtifacts.set(file, readFileSync(file));
    }
    assert.equal(plan.agent, harness);
    assert.equal(plan.version, 2);
    assert.equal(plan.modo, 'paralelo');
    assert.deepEqual(plan.faixas.map((fx) => fx.tarefas.map((task) => task.id)), [['T-001', 'T-003'], ['T-002']]);
    assert.equal(plan.faixas[0].tarefas[0].modelo, null, 'modelo default vem do catálogo atual');
    assert.equal(plan.faixas[1].tarefas[0].modelo, 'modelo-da-conta', 'não troca modelo escolhido antes de validar catálogo');
    const entry = path.join(artifacts, 'executar-tarefas.mjs');
    const syntax = spawnSync(process.execPath, ['--check', entry], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const list = spawnSync(process.execPath, [entry, '--listar'], { cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, ONP_SPEC_HOME: homeOnp } });
    assert.equal(list.status, 0, `${list.stdout}\n${list.stderr}`);
    assert.match(list.stdout, /faixa-1/);
    assert.match(list.stdout, /faixa-2/);
    assert.match(list.stdout, /T-001/);
    assert.match(list.stdout, /T-003/);
  });
}

test('plano sequencial e seleção parcial preservam a ordem e os alvos', () => {
  const dir = path.join(root, '.spec/features/pagamentos');
  const sequential = cli('plano', 'pagamentos', '--agents', 'claude', '--sequencial');
  assert.equal(sequential.code, 0, sequential.out);
  let plan = selectExecutionPlan(root, 'pagamentos');
  const sequentialPlan = plan;
  const sequentialJson = readFileSync(path.join(root, plan.artifactDir, 'plano.json'));
  assert.equal(plan.modo, 'sequencial');
  assert.deepEqual(plan.faixas, []);
  assert.deepEqual(plan.sequenciais.map((task) => task.id), ['T-001', 'T-002', 'T-003']);
  const selected = cli('plano', 'pagamentos', '--agents', 'claude', '--paralelizar', 'T-001,T-003');
  assert.equal(selected.code, 0, selected.out);
  plan = selectExecutionPlan(root, 'pagamentos');
  assert.deepEqual(plan.faixas.map((fx) => fx.tarefas.map((task) => task.id)), [['T-001', 'T-003']]);
  assert.deepEqual(plan.sequenciais.map((task) => task.id), ['T-002']);
  assert.notEqual(plan.runId, sequentialPlan.runId);
  assert.deepEqual(readFileSync(path.join(root, sequentialPlan.artifactDir, 'plano.json')), sequentialJson);
  const exact = cli('executar', 'pagamentos', '--run', sequentialPlan.runId, '--listar');
  assert.equal(exact.code, 0, exact.out);
  assert.deepEqual(JSON.parse(exact.out).targets, ['T-001', 'T-002', 'T-003', 'gate']);
  const wrapper = spawnSync(process.execPath, [path.join(root, sequentialPlan.artifactDir, 'executar-tarefas.mjs'), '--listar'], {
    cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(wrapper.status, 0, `${wrapper.stdout}\n${wrapper.stderr}`);
  assert.deepEqual(JSON.parse(wrapper.stdout).targets, ['T-001', 'T-002', 'T-003', 'gate'], 'wrapper anterior continua apontando para sua execução');
  assert.equal(cli('plano', 'pagamentos', '--sequencial', '--paralelizar', 'T-001').code, 2);
});

test('tarefa valida status/custo e o plano mantém o modelo escolhido até consultar o harness', () => {
  assert.equal(cli('tarefa', 'pagamentos', 'T-002', 'concluida').code, 0);
  const tasksPath = path.join(root, '.spec/features/pagamentos/tasks.md');
  assert.match(readFileSync(tasksPath, 'utf8'), /T-002 — Envio de recibo \[concluida\]/);
  assert.equal(cli('tarefa', 'pagamentos', 'T-099', 'concluida').code, 2);
  assert.equal(cli('tarefa', 'pagamentos', 'T-001', 'meio-feita').code, 2);
  const chosen = cli('tarefa', 'pagamentos', 'T-001', '--modelo', 'modelo-escolhido', '--esforco', 'baixo');
  assert.equal(chosen.code, 0, chosen.out);
  assert.match(readFileSync(tasksPath, 'utf8'), /- Modelo: modelo-escolhido/);
  assert.equal(cli('tarefa', 'pagamentos', 'T-001', '--esforco', 'turbo').code, 2);
  assert.equal(cli('plano', 'pagamentos', '--agents', 'codex').code, 0);
  const plan = selectExecutionPlan(root, 'pagamentos');
  assert.equal(plan.faixas[0].tarefas[0].modelo, 'modelo-escolhido');
  assert.equal(plan.faixas[0].tarefas[0].esforco, 'low');
});

test('override de modelo/esforço preserva a escolha sem inferir disponibilidade por prefixo', () => {
  const r = cli('plano', 'pagamentos', '--agents', 'codex', '--modelo', 'provider/modelo-atual', '--esforco', 'baixo');
  assert.equal(r.code, 0, r.out);
  const plan = selectExecutionPlan(root, 'pagamentos');
  assert.equal(plan.modeloForcado, 'provider/modelo-atual');
  assert.equal(plan.esforcoForcado, 'low');
  for (const task of [...plan.faixas.flatMap((fx) => fx.tarefas), ...plan.sequenciais]) {
    assert.equal(task.modelo, 'provider/modelo-atual');
    assert.equal(task.esforco, 'low');
  }
  assert.equal(cli('plano', 'pagamentos', '--modelo').code, 2);
  assert.equal(cli('plano', 'pagamentos', '--esforco').code, 2);
});

test('new --grande integra PRD literal, ADR, TDD, pesquisa, links e bloqueio no CI', () => {
  const request = 'Quero exportar as cobranças. Não mude o cálculo atual.';
  const r = cli('new', 'exportacao-grande', '--grande', '--cliente', request, '--dominios', 'financeiro');
  assert.equal(r.code, 0, r.out);
  const dir = path.join(root, '.spec/features/exportacao-grande');
  for (const file of ['prd.md', 'adr.md', 'design.md', 'research.md', 'spec.md', 'tasks.md']) assert.ok(existsSync(path.join(dir, file)), file);
  assert.ok(readFileSync(path.join(dir, 'prd.md'), 'utf8').includes(`> ${request}`));
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'governance.json'), 'utf8')).domains, ['financeiro']);
  const impact = cli('impacto', 'exportacao-grande');
  assert.equal(impact.code, 1, impact.out);
  const audit = cli('audit', '--ci', '--json');
  assert.equal(audit.code, 1, audit.out);
  assert.match(audit.out, /DOCUMENTO_RASCUNHO/);
  // Não deixa o rascunho de outra feature interferir nos testes de detecção.
  rmSync(dir, { recursive: true, force: true });
});
test('upgrade: plano anterior sem runId permanece intacto e a execução nova entra no ledger', () => {
  const planoPath = path.join(root, '.spec', 'features', 'pagamentos', 'plano.json');
  // Simula um artefato anterior ao ledger no seu caminho histórico.
  const antigo = { ...selectExecutionPlan(root, 'pagamentos'), version: 1 };
  delete antigo.runId;
  delete antigo.artifactDir;
  const original = JSON.stringify(antigo, null, 2);
  writeFileSync(planoPath, original);

  const r = cli('plano', 'pagamentos');
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(planoPath, 'utf8'), original, 'nenhuma migração do JSON anterior');
  const novo = selectExecutionPlan(root, 'pagamentos');
  assert.ok(novo.runId, 'a execução nova recebe sua identificação');
  assert.equal(novo.artifactDir, `.spec/features/pagamentos/execucoes/${novo.runId}`);

  const ledger = readFileSync(path.join(homeOnp, 'painel', 'ledger.jsonl'), 'utf-8');
  assert.ok(ledger.includes(novo.runId), 'execução nova registrada no ledger global');
  assert.ok(ledger.includes('"tipo":"plano"'));
});

test('plano detecta o agente pelo que está instalado quando não há flag', () => {
  // este root tem .claude/skills E .agents/skills (codex) → claude tem precedência
  const { code, out } = cli('plano', 'pagamentos');
  assert.equal(code, 0, out);
  assert.match(out, /plano de execução \(claude\)/);
});

test('motor embarcado do codex detecta codex pelo PRÓPRIO marcador (mesmo com .claude no projeto)', () => {
  const embarcado = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs');
  const proc = spawnSync(process.execPath, [embarcado, 'plano', 'pagamentos'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(proc.status, 0, `${proc.stdout}\n${proc.stderr}`);
  assert.match(proc.stdout, /plano de execução \(codex\)/);
});

test('sem .claude, a detecção usa o marcador da skill instalada em .agents (codex)', () => {
  rmSync(path.join(root, '.claude'), { recursive: true, force: true });
  const { code, out } = cli('plano', 'pagamentos');
  assert.equal(code, 0, out);
  assert.match(out, /plano de execução \(codex\)/);
});

test('motor embarcado do cursor detecta cursor pelo PRÓPRIO marcador (mesmo com .agents no projeto)', () => {
  const embarcado = path.join(root, '.cursor', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs');
  const proc = spawnSync(process.execPath, [embarcado, 'plano', 'pagamentos'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(proc.status, 0, `${proc.stdout}\n${proc.stderr}`);
  assert.match(proc.stdout, /plano de execução \(cursor\)/);
});

test('sem .claude e sem .agents, a detecção usa o marcador da skill instalada em .cursor', () => {
  rmSync(path.join(root, '.agents'), { recursive: true, force: true });
  const { code, out } = cli('plano', 'pagamentos');
  assert.equal(code, 0, out);
  assert.match(out, /plano de execução \(cursor\)/);
});

test('motor num checkout sob ~/.cursor/worktrees NÃO vira detecção de cursor (só .cursor/skills conta)', () => {
  // os agentes paralelos do Cursor fazem checkout de repositórios em
  // ~/.cursor/worktrees/<repo> — um motor rodando de lá NÃO é a skill do
  // cursor, e a detecção tem que respeitar o que está instalado no projeto
  assert.equal(cli('init', '--agents', 'claude').code, 0);
  const fake = path.join(root, 'fake-home', '.cursor', 'worktrees', 'onp-spec-driven');
  mkdirSync(fake, { recursive: true });
  const REPO_RAIZ = path.join(__dirname, '..');
  cpSync(path.join(REPO_RAIZ, 'src'), path.join(fake, 'src'), { recursive: true });
  cpSync(path.join(REPO_RAIZ, 'bin'), path.join(fake, 'bin'), { recursive: true });
  cpSync(path.join(REPO_RAIZ, 'package.json'), path.join(fake, 'package.json'));
  const proc = spawnSync(process.execPath, [path.join(fake, 'bin', 'onp-spec.js'), 'plano', 'pagamentos'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(proc.status, 0, `${proc.stdout}\n${proc.stderr}`);
  assert.match(proc.stdout, /plano de execução \(claude\)/, 'a skill do projeto (.claude) decide, não o caminho do motor');
});
