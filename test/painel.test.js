// Painel ao vivo: parser da trilha de eventos, montagem de estado a partir
// de arquivos reais e o servidor HTTP (rotas, guarda de token, host local).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { parseEventos, tailArquivo, montarEstado, servirPainel } from '../src/core/painel.js';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-painel-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

test('parseEventos reconstrói o estado da execução na ordem dos eventos', () => {
  const ex = parseEventos(
    [
      '2026-07-28T10:00:00Z|inicio|pagamentos',
      '2026-07-28T10:00:01Z|onda|1|inicio',
      '2026-07-28T10:00:01Z|faixa|faixa-1|executando',
      '2026-07-28T10:00:01Z|faixa|faixa-2|executando',
      '2026-07-28T10:03:00Z|faixa|faixa-1|exit|0',
      '2026-07-28T10:03:01Z|faixa|faixa-1|mesclada',
      '2026-07-28T10:03:02Z|tarefa|T-001|concluida',
      '2026-07-28T10:03:10Z|faixa|faixa-2|exit|1',
      '2026-07-28T10:03:10Z|faixa|faixa-2|falhou',
      '2026-07-28T10:03:20Z|seq|T-004|executando',
      '2026-07-28T10:04:00Z|seq|T-004|concluida',
      '2026-07-28T10:04:01Z|gate|verify|0',
      '2026-07-28T10:04:05Z|gate|audit|1',
      '2026-07-28T10:04:05Z|fim|1',
    ].join('\n')
  );
  assert.equal(ex.inicio, '2026-07-28T10:00:00Z');
  assert.equal(ex.faixas['faixa-1'], 'mesclada');
  assert.equal(ex.faixas['faixa-2'], 'falhou');
  assert.equal(ex.tarefas['T-001'], 'concluida');
  assert.equal(ex.seq['T-004'], 'concluida');
  assert.deepEqual(ex.gate, { verify: 0, audit: 1 });
  assert.equal(ex.fim, 1);
});

test('parseEventos: exit 0 sem merge ainda vira "mesclando"; lixo é ignorado', () => {
  const ex = parseEventos('x\n\n2026|faixa|faixa-1|executando\n2026|faixa|faixa-1|exit|0\nlinha solta');
  assert.equal(ex.faixas['faixa-1'], 'mesclando');
  assert.equal(ex.fim, null);
});

test('tailArquivo devolve só a cauda e não explode com arquivo inexistente', () => {
  const p = path.join(tmp, 'grande.log');
  writeFileSync(p, Array.from({ length: 500 }, (_, i) => `linha ${i}`).join('\n'));
  const cauda = tailArquivo(p, { maxLinhas: 5 });
  assert.equal(cauda.split('\n').length, 5);
  assert.match(cauda, /linha 499$/);
  assert.equal(tailArquivo(path.join(tmp, 'nao-existe.log')), '');
});

// fixture: projeto com plano.json + tasks.md + trilha de eventos + logs
function criarFixture({ comScript = false } = {}) {
  const rootDir = path.join(tmp, 'repo');
  const baseDir = path.join(rootDir, '.spec', 'features', 'pagamentos');
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(
    path.join(baseDir, 'plano.json'),
    JSON.stringify({
      feature: 'pagamentos',
      agent: 'claude',
      repoName: 'repo',
      branchTrabalho: 'spec/pagamentos',
      ondas: [['faixa-1']],
      faixas: [
        {
          id: 'faixa-1',
          branch: 'spec/pagamentos-faixa-1',
          worktree: '../onp-worktrees/repo-pagamentos-faixa-1',
          tarefas: [{ id: 'T-001', titulo: 'Modelo', modelo: 'claude-sonnet-5', esforco: 'medium', arquivos: ['src/a.js'], refs: [] }],
        },
      ],
      sequenciais: [],
      concluidas: [],
      avisos: [],
    })
  );
  writeFileSync(path.join(baseDir, 'tasks.md'), '# Tasks\n\n## T-001 — Modelo [concluida]\n\n- Refs: AC-001\n- Arquivos: src/a.js\n');
  const shPath = path.join(baseDir, 'executar-tarefas.sh');
  rmSync(shPath, { force: true });
  if (comScript) writeFileSync(shPath, '#!/bin/bash\nexit 0\n');
  const logsDir = path.join(tmp, 'onp-worktrees', 'repo-pagamentos-logs');
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(path.join(logsDir, 'plano-eventos.log'), '2026|inicio|pagamentos\n2026|faixa|faixa-1|mesclada\n2026|fim|0\n');
  writeFileSync(path.join(logsDir, 'faixa-1.log'), 'trabalhando...\ncommit feito\n');
  mkdirSync(path.join(rootDir, '.spec', 'verification'), { recursive: true });
  writeFileSync(
    path.join(rootDir, '.spec', 'verification', 'pagamentos.json'),
    JSON.stringify({ results: { 'AC-001': { status: 'pass' } } })
  );
  return rootDir;
}

test('montarEstado junta plano + eventos + tasks.md + provas + cauda de logs', () => {
  const rootDir = criarFixture();
  const e = montarEstado({ rootDir, specDir: '.spec', feature: 'pagamentos' });
  assert.ok(!e.erro, e.erro);
  assert.equal(e.plan.feature, 'pagamentos');
  assert.equal(e.execucao.faixas['faixa-1'], 'mesclada');
  assert.equal(e.execucao.fim, 0);
  assert.equal(e.tasksMd['T-001'], 'concluida');
  assert.deepEqual(e.provas, { total: 1, pass: 1 });
  assert.match(e.logs['faixa-1'], /commit feito/);
  assert.equal(e.rodando, false); // fim registrado
});

test('montarEstado sem plano.json devolve erro amigável', () => {
  const e = montarEstado({ rootDir: tmp, specDir: '.spec', feature: 'fantasma' });
  assert.match(e.erro, /onp-spec plano fantasma/);
});

test('servidor: página com botão, estado JSON e token obrigatório no POST', async () => {
  const rootDir = criarFixture({ comScript: true });
  const { server, url, token } = await servirPainel({
    rootDir,
    specDir: '.spec',
    feature: 'pagamentos',
    agent: 'claude',
    porta: 0,
    abrir: false,
    log: () => {},
  });
  try {
    const pagina = await (await fetch(url)).text();
    assert.match(pagina, /Painel — pagamentos/);
    assert.match(pagina, /Executar todas as tarefas em janelas limpas e paralelas/);
    assert.ok(pagina.includes(token), 'token da sessão embutido na página');

    const estado = await (await fetch(`${url}api/estado`)).json();
    assert.equal(estado.plan.feature, 'pagamentos');
    assert.equal(estado.execucao.fim, 0);

    // POST sem token e com token errado: barrado
    assert.equal((await fetch(`${url}executar`, { method: 'POST' })).status, 403);
    assert.equal(
      (await fetch(`${url}executar`, { method: 'POST', headers: { 'x-onp-token': 'errado' } })).status,
      403
    );
    // token certo → dispara (o script do fixture é um no-op)
    const ok = await fetch(`${url}executar`, { method: 'POST', headers: { 'x-onp-token': token } });
    assert.equal(ok.status, 202);

    // rota desconhecida
    assert.equal((await fetch(`${url}outra`)).status, 404);
  } finally {
    server.close();
  }
});

test('servidor: sem executar-tarefas.sh o POST instrui a gerar o plano (404)', async () => {
  const rootDir = criarFixture({ comScript: false });
  const { server, url, token } = await servirPainel({
    rootDir,
    specDir: '.spec',
    feature: 'pagamentos',
    agent: 'claude',
    porta: 0,
    abrir: false,
    log: () => {},
  });
  try {
    const pagina = await (await fetch(url)).text();
    assert.match(pagina, /Modo acompanhamento/); // sem script, sem botão
    const sem = await fetch(`${url}executar`, { method: 'POST', headers: { 'x-onp-token': token } });
    assert.equal(sem.status, 404);
    assert.match(await sem.text(), /onp-spec plano/);
  } finally {
    server.close();
  }
});

test('servidor: plano do antigravity vira modo acompanhamento (sem botão)', async () => {
  const rootDir = criarFixture({ comScript: true }); // mesmo com script, AG não ganha botão
  const { server, url } = await servirPainel({
    rootDir,
    specDir: '.spec',
    feature: 'pagamentos',
    agent: 'antigravity',
    porta: 0,
    abrir: false,
    log: () => {},
  });
  try {
    const pagina = await (await fetch(url)).text();
    assert.doesNotMatch(pagina, /id="btn"/);
    assert.match(pagina, /Modo acompanhamento/);
  } finally {
    server.close();
  }
});
