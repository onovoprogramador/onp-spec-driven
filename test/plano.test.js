// Plano de execução: agrupamento em faixas (arquivos disjuntos → paralelo,
// compartilhado → mesma faixa, sem Arquivos → sequencial) e renderizadores.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  montarPlano,
  normalizarEsforco,
  esforcoParaAgente,
  AGENTES,
  usaExecutorSh,
  renderPlanoMd,
  renderPlanoMjs,
  renderPlanoSh,
  renderPlanoHtml,
  renderPlanoJson,
  promptFaixa,
} from '../src/core/plano.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_CONFIG } from '../src/config.js';

function projeto({ tasks, specStories = [], rootDir = '/tmp/repo-x' } = {}) {
  return {
    config: { ...DEFAULT_CONFIG, rootDir, testCommand: 'node --test' },
    features: [
      {
        name: 'pagamentos',
        spec: { stories: specStories },
        tasks: { tasks },
      },
    ],
  };
}

function t(id, { files = [], status = 'pendente', refs = [], model = null, esforco = null, line = 1 } = {}) {
  return { id, title: `Título ${id}`, status, line, refs, files, model, esforco };
}

test('esforço aceita PT e EN e normaliza para o nível do CLI', () => {
  assert.equal(normalizarEsforco('alto'), 'high');
  assert.equal(normalizarEsforco('Médio'), 'medium');
  assert.equal(normalizarEsforco('xalto'), 'xhigh');
  assert.equal(normalizarEsforco('MAX'), 'max');
  assert.equal(normalizarEsforco('low'), 'low');
  assert.equal(normalizarEsforco('turbo'), null);
});

test('arquivos disjuntos → faixas paralelas; compartilhado → mesma faixa; sem arquivos → sequencial', () => {
  const plan = montarPlano(
    projeto({
      tasks: [
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-002', { files: ['src/b.js'], line: 5 }),
        t('T-003', { files: ['src/a.js', 'src/c.js'], line: 9 }),
        t('T-004', { line: 13 }),
      ],
    }),
    'pagamentos',
    { agent: 'claude', enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.ok(!plan.erro, plan.erro);
  assert.equal(plan.faixas.length, 2);
  assert.deepEqual(plan.faixas[0].tasks.map((x) => x.id), ['T-001', 'T-003']);
  assert.deepEqual(plan.faixas[1].tasks.map((x) => x.id), ['T-002']);
  assert.deepEqual(plan.sequenciais.map((x) => x.id), ['T-004']);
  assert.match(plan.faixas[0].branch, /^spec\/pagamentos-faixa-1-[a-f0-9]{12}$/);
  assert.equal(plan.branchTrabalho, 'spec/pagamentos');
  // engine vira caminho relativo à raiz
  assert.equal(plan.engine, 'bin/onp-spec.js');
});

test('tarefas concluídas ficam de fora; tudo concluído é erro amigável', () => {
  const plan = montarPlano(
    projeto({
      tasks: [t('T-001', { files: ['src/a.js'], status: 'concluida' }), t('T-002', { files: ['src/b.js'] })],
    }),
    'pagamentos',
    {}
  );
  assert.deepEqual(plan.concluidas.map((x) => x.id), ['T-001']);
  assert.equal(plan.faixas.length, 1);

  const vazio = montarPlano(
    projeto({ tasks: [t('T-001', { files: ['src/a.js'], status: 'concluida' })] }),
    'pagamentos',
    {}
  );
  assert.match(vazio.erro, /já estão \[concluida\]/);
});

test('maxParalelas divide as faixas em ondas', () => {
  const proj = projeto({
    tasks: [
      t('T-001', { files: ['a'], line: 1 }),
      t('T-002', { files: ['b'], line: 2 }),
      t('T-003', { files: ['c'], line: 3 }),
      t('T-004', { files: ['d'], line: 4 }),
      t('T-005', { files: ['e'], line: 5 }),
    ],
  });
  proj.config.paralelo = { ...proj.config.paralelo, maxParalelas: 2 };
  const plan = montarPlano(proj, 'pagamentos', {});
  assert.equal(plan.faixas.length, 5);
  assert.deepEqual(plan.ondas.map((o) => o.length), [2, 2, 1]);
});

test('modelo e esforço por tarefa vencem o default; esforço inválido gera aviso', () => {
  const plan = montarPlano(
    projeto({
      tasks: [
        t('T-001', { files: ['a'], model: 'modelo-configurado', esforco: 'alto' }),
        t('T-002', { files: ['b'], esforco: 'turbo' }),
      ],
    }),
    'pagamentos',
    {}
  );
  const [f1, f2] = plan.faixas;
  assert.equal(f1.tasks[0].model, 'modelo-configurado');
  assert.equal(f1.tasks[0].esforcoCli, 'high');
  assert.equal(f2.tasks[0].model, null); // resolvido no catálogo real na execução
  assert.equal(f2.tasks[0].esforcoCli, 'medium'); // fallback
  assert.ok(plan.avisos.some((a) => a.includes('turbo')));
});

test('feature sem tasks.md ou inexistente é erro amigável', () => {
  const semTasks = { ...projeto({ tasks: [] }) };
  semTasks.features[0].tasks = null;
  assert.match(montarPlano(semTasks, 'pagamentos', {}).erro, /não tem tarefas/);
  assert.match(montarPlano(projeto({ tasks: [t('T-001')] }), 'outra', {}).erro, /não encontrada/);
});

function planPadrao(agent) {
  return montarPlano(
    projeto({
      tasks: [
        t('T-001', { files: ['src/a.js'], refs: ['AC-001'], line: 1 }),
        t('T-002', { files: ['src/b.js'], line: 5, esforco: 'alto' }),
        t('T-003', { line: 9 }),
      ],
      specStories: [{ id: 'US-001', acs: [{ id: 'AC-001', title: 'Cobrança criada' }] }],
    }),
    'pagamentos',
    { agent, enginePath: '/tmp/repo-x/bin/onp-spec.js', now: new Date('2026-07-28T12:00:00Z') }
  );
}

test('--paralelizar: só as escolhidas entram nas faixas; as demais viram sequenciais com motivo', () => {
  const plan = montarPlano(
    projeto({
      tasks: [
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-002', { files: ['src/b.js'], line: 5 }),
        t('T-003', { files: ['src/c.js'], line: 9 }),
        t('T-004', { line: 13 }),
      ],
    }),
    'pagamentos',
    { agent: 'claude', paralelizar: ['T-001', 'T-003'], enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.ok(!plan.erro, plan.erro);
  assert.equal(plan.modo, 'paralelo');
  assert.deepEqual(plan.faixas.map((fx) => fx.tasks.map((x) => x.id)), [['T-001'], ['T-003']]);
  assert.deepEqual(plan.sequenciais.map((x) => x.id), ['T-002', 'T-004'], 'fora da seleção roda ao final, na ordem');
  assert.match(plan.sequenciais[0].motivoSeq, /fora da seleção/);
  assert.match(plan.sequenciais[1].motivoSeq, /pegada desconhecida/);
  // ficar fora da seleção é decisão do usuário, não fallback — sem aviso
  assert.ok(!plan.avisos.some((a) => a.includes('T-002')));
  assert.deepEqual(plan.paralelizar, ['T-001', 'T-003']);
});

test('--paralelizar: escolhidas que compartilham arquivo caem na MESMA faixa', () => {
  const plan = montarPlano(
    projeto({
      tasks: [
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-002', { files: ['src/a.js', 'src/c.js'], line: 5 }),
        t('T-003', { files: ['src/b.js'], line: 9 }),
      ],
    }),
    'pagamentos',
    { paralelizar: ['T-001', 'T-002'] }
  );
  assert.equal(plan.faixas.length, 1, 'conflito de arquivo não vira paralelismo nem com seleção');
  assert.deepEqual(plan.faixas[0].tasks.map((x) => x.id), ['T-001', 'T-002']);
  assert.deepEqual(plan.sequenciais.map((x) => x.id), ['T-003']);
});

test('--paralelizar: tarefa desconhecida ou seleção vazia é erro amigável', () => {
  const proj = () => projeto({ tasks: [t('T-001', { files: ['a'] }), t('T-002', { files: ['b'], status: 'concluida' })] });
  assert.match(
    montarPlano(proj(), 'pagamentos', { paralelizar: ['T-999'] }).erro,
    /T-999/,
    'id inexistente aparece no erro'
  );
  assert.match(
    montarPlano(proj(), 'pagamentos', { paralelizar: ['T-002'] }).erro,
    /não estão pendentes/,
    'tarefa concluída não é paralelizável'
  );
  assert.match(montarPlano(proj(), 'pagamentos', { paralelizar: [] }).erro, /--sequencial/);
});

test('montarPlano --sequencial: sem faixas, tudo uma após a outra na ordem do tasks.md', () => {
  const plan = montarPlano(
    projeto({
      tasks: [
        t('T-002', { files: ['src/b.js'], line: 5 }),
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-003', { line: 9 }),
      ],
    }),
    'pagamentos',
    { agent: 'claude', sequencial: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.equal(plan.modo, 'sequencial');
  assert.equal(plan.faixas.length, 0);
  assert.equal(plan.ondas.length, 0);
  assert.deepEqual(plan.sequenciais.map((x) => x.id), ['T-001', 'T-002', 'T-003'], 'ordem do tasks.md');
  // sem aviso de "pegada desconhecida": sequencial é escolha, não fallback
  assert.ok(!plan.avisos.some((a) => a.includes('pegada desconhecida')));
});

test('cinco harnesses usam o mesmo plano portátil sem converter modelos ou esforços por palpite', () => {
  assert.deepEqual(AGENTES, ['claude', 'antigravity', 'codex', 'cursor', 'opencode']);
  for (const agent of AGENTES) {
    const plan = montarPlano(projeto({ tasks: [t('T-001', { files: ['src/a.js'], model: 'provider/modelo-da-conta', esforco: 'max' })] }), 'pagamentos', { agent });
    assert.equal(plan.agent, agent);
    assert.equal(plan.faixas[0].tasks[0].model, 'provider/modelo-da-conta');
    assert.equal(plan.faixas[0].tasks[0].esforcoCli, 'max');
    assert.equal(esforcoParaAgente('max', agent), 'max', 'adapter valida capacidade real; plano não presume suporte');
    assert.equal(usaExecutorSh(agent), true, 'alias antigo continua indicando executor portátil');
    assert.equal(plan.avisos.length, 0);
  }
});

test('--modelo e --esforco explícitos vencem tarefas/config sem selecionar substituto', () => {
  const proj = projeto({ tasks: [t('T-001', { files: ['a'], model: 'modelo-tarefa', esforco: 'alto' }), t('T-002', { files: ['b'] }), t('T-003')] });
  proj.config = { ...proj.config, paralelo: { ...proj.config.paralelo, model: 'modelo-config' } };
  const plan = montarPlano(proj, 'pagamentos', { agent: 'codex', modelo: 'modelo-escolhido', esforco: 'baixo' });
  assert.ok(!plan.erro, plan.erro);
  for (const task of [...plan.faixas.flatMap((fx) => fx.tasks), ...plan.sequenciais]) {
    assert.equal(task.model, 'modelo-escolhido');
    assert.equal(task.esforcoCli, 'low');
  }
  const data = JSON.parse(renderPlanoJson(plan));
  assert.equal(data.modeloForcado, 'modelo-escolhido');
  assert.equal(data.esforcoForcado, 'low');
  assert.match(montarPlano(proj, 'pagamentos', { esforco: 'turbo' }).erro, /desconhecido/);
});

test('JSON preserva isolamento, ondas, seleção, prompts e dados necessários ao executor', () => {
  const plan = planPadrao('opencode');
  const data = JSON.parse(renderPlanoJson(plan));
  assert.equal(data.version, 2);
  assert.equal(data.feature, 'pagamentos');
  assert.equal(data.agent, 'opencode');
  assert.equal(data.engine, 'bin/onp-spec.js');
  assert.deepEqual(data.ondas, [['faixa-1', 'faixa-2']]);
  assert.equal(data.faixas[0].tarefas[0].id, 'T-001');
  assert.deepEqual(data.faixas[0].tarefas[0].arquivos, ['src/a.js']);
  assert.equal(data.faixas[0].tarefas[0].modelo, null);
  assert.equal(data.sequenciais[0].id, 'T-003');
  assert.notEqual(data.faixas[0].worktree, data.faixas[1].worktree);
  assert.notEqual(data.faixas[0].branch, data.faixas[1].branch);
  assert.match(data.faixas[0].tarefas[0].prompt, /Cobrança criada/);
  assert.match(data.faixas[0].tarefas[0].prompt, /NUNCA enfraqueça, pule/);
  assert.match(data.faixas[0].tarefas[0].prompt, /Nunca decida conflitos em headless/);
  assert.match(promptFaixa(plan, plan.faixas[0]), /SOMENTE dentro do worktree/);
  const selected = montarPlano(projeto({ tasks: [t('T-001', { files: ['a'] }), t('T-002', { files: ['b'] })] }), 'pagamentos', { paralelizar: ['T-001'] });
  assert.deepEqual(JSON.parse(renderPlanoJson(selected)).paralelizar, ['T-001']);
});

test('planos novos orientam acompanhamento nativo, gate e limpeza; não geram HTML', () => {
  for (const agent of AGENTES) {
    const plan = planPadrao(agent);
    const md = renderPlanoMd(plan);
    assert.match(md, /NATIVOS/);
    assert.match(md, /executar-tarefas\.mjs/);
    assert.match(md, /catálogo atual/);
    assert.match(md, /5%/);
    assert.match(md, /audit --ci/);
    assert.match(md, /Pergunte com a ferramenta nativa/);
    assert.match(md, /somente após resposta afirmativa/);
    assert.doesNotMatch(md, /\.html|sleep 60|claude-haiku|gpt-5/);
    assert.throws(() => renderPlanoHtml(plan), /removido/);
  }
});

for (const versioned of [false, true]) test(`entrypoint Node ${versioned ? 'versionado' : 'inicial'} fixa runId e raiz com argumentos especiais sem shell`, (tctx) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onp plano '));
  tctx.after(() => rmSync(root, { recursive: true, force: true }));
  const engine = path.join(root, "motor ' $ valor.mjs");
  writeFileSync(engine, `import { writeFileSync } from 'node:fs';\nwriteFileSync('observado.json', JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));\nprocess.exitCode = 7;\n`);
  const proj = projeto({ rootDir: root, tasks: [t('T-001', { files: ['src/a.js'] })] });
  const plan = montarPlano(proj, 'pagamentos', { agent: 'codex', enginePath: engine });
  if (versioned) plan.artifactDir = `${plan.baseDir}/execucoes/${plan.runId}`;
  const dir = path.join(root, plan.artifactDir || plan.baseDir);
  mkdirSync(dir, { recursive: true });
  const entry = path.join(dir, 'executar-tarefas.mjs');
  writeFileSync(entry, renderPlanoMjs(plan));
  const dangerous = "literal ' $HOME `id` $(touch nunca-criar)";
  const run = spawnSync(process.execPath, [entry, '--seq', dangerous], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(run.status, 7, run.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'observado.json'), 'utf8')), { args: ['executar', 'pagamentos', '--seq', dangerous, '--run', plan.runId], cwd: realpathSync(root) });
});

test('wrapper POSIX legado apenas encaminha ao Node sem chamadas de IA para progresso', () => {
  const sh = renderPlanoSh(planPadrao('claude'));
  assert.match(sh, /executar-tarefas\.mjs/);
  assert.doesNotMatch(sh, /claude|codex|agent -p|sleep|RESUMO_MODEL|worktree remove|branch -D/);
});
