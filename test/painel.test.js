// Painel ao vivo: servidor multi-projeto sobre o ledger global. Prova as
// rotas, o incremental do stream, a tradução escopo → argumentos do script e
// as guardas (token, host, agente errado, execução duplicada).

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';
import { registrarEvento, caminhos, caminhoStream } from '../src/core/ledger.js';
import { servirPainel, montarEstadoGlobal, argsDoEscopo, tailArquivo } from '../src/core/painel.js';

let home;
let repo;
const antes = process.env.ONP_SPEC_HOME;

before(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'onpspec-painel-'));
  process.env.ONP_SPEC_HOME = home;
});
after(() => {
  if (antes === undefined) delete process.env.ONP_SPEC_HOME;
  else process.env.ONP_SPEC_HOME = antes;
  rmSync(home, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(caminhos().dir, { recursive: true, force: true });
  repo = mkdtempSync(path.join(os.tmpdir(), 'onpspec-repo-'));
});

const STREAM = [
  '{"type":"system","subtype":"init","session_id":"abc12345","model":"claude-sonnet-5"}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}',
].join('\n');

function fixture({ agent = 'claude', comScript = true, feature = 'pagamentos', runId = 'run-1' } = {}) {
  const baseDir = `.spec/features/${feature}`;
  mkdirSync(path.join(repo, baseDir), { recursive: true });
  if (comScript) {
    const sh = path.join(repo, baseDir, 'executar-tarefas.sh');
    // script de mentira: só registra os argumentos que recebeu
    writeFileSync(sh, `#!/usr/bin/env bash\necho "args: $*" > "${path.join(repo, 'chamada.txt')}"\nexit 0\n`);
    chmodSync(sh, 0o755);
  }
  registrarEvento({
    tipo: 'plano',
    runId,
    projeto: path.basename(repo),
    projetoDir: repo,
    feature,
    agent,
    plano: {
      runId,
      branchTrabalho: `spec/${feature}`,
      baseDir,
      ondas: [['faixa-1']],
      faixas: [
        {
          id: 'faixa-1',
          branch: `spec/${feature}-faixa-1`,
          worktree: '../wt',
          tarefas: [{ id: 'T-001', titulo: 'Modelo', modelo: 'claude-sonnet-5', esforco: 'medium', arquivos: ['src/a.js'] }],
        },
      ],
      sequenciais: [],
    },
  });
  mkdirSync(path.dirname(caminhoStream(runId, 'faixa-1--T-001')), { recursive: true });
  writeFileSync(caminhoStream(runId, 'faixa-1--T-001'), STREAM);
  return { runId, baseDir };
}

async function subir(opts = {}) {
  return servirPainel({ rootDir: repo, specDir: '.spec', porta: 0, abrir: false, log: () => {}, ...opts });
}

test('argsDoEscopo traduz o escopo em argumentos do executar-tarefas.sh', () => {
  assert.deepEqual(argsDoEscopo('tudo'), []);
  assert.deepEqual(argsDoEscopo(undefined), []);
  assert.deepEqual(argsDoEscopo('gate'), ['--gate']);
  assert.deepEqual(argsDoEscopo('faixa:faixa-2'), ['--faixa', 'faixa-2']);
  assert.deepEqual(argsDoEscopo('seq:T-004'), ['--seq', 'T-004']);
  assert.equal(argsDoEscopo('rm -rf /'), null, 'escopo inventado é recusado');
  assert.equal(argsDoEscopo('--dangerously'), null);
});

test('tailArquivo devolve a cauda e tolera arquivo ausente', () => {
  const p = path.join(repo, 'l.log');
  writeFileSync(p, Array.from({ length: 200 }, (_, i) => `l${i}`).join('\n'));
  const t = tailArquivo(p, { maxLinhas: 3 });
  assert.deepEqual(t.split('\n'), ['l197', 'l198', 'l199']);
  assert.equal(tailArquivo(path.join(repo, 'nao-existe.log')), '');
});

test('montarEstadoGlobal filtra por projeto e calcula silêncio', () => {
  fixture();
  const est = montarEstadoGlobal({ projetoDir: repo });
  assert.equal(est.projetos.length, 1);
  const ex = est.projetos[0].execucoes[0];
  assert.equal(ex.feature, 'pagamentos');
  assert.equal(typeof ex.silencioSeg, 'number');
  assert.equal(ex.disparadoAqui, false);
  assert.deepEqual(montarEstadoGlobal({ projetoDir: '/outro/lugar' }).projetos, []);
});

test('página do painel: título, escopo e token da sessão embutido', async () => {
  fixture();
  const { server, url, token } = await subir({ feature: 'pagamentos' });
  try {
    const html = await (await fetch(url)).text();
    assert.match(html, /<title>Painel — pagamentos<\/title>/);
    assert.ok(html.includes(token), 'token vai na página para o POST autenticar');
    assert.match(html, /Executar tudo/);
    assert.match(html, /reexecutar/, 'a UI oferece reexecução por faixa');
  } finally {
    server.close();
  }
});

test('painel global anuncia todos os projetos no título', async () => {
  fixture();
  const { server, url } = await subir({ global: true });
  try {
    const html = await (await fetch(url)).text();
    assert.match(html, /todos os projetos/);
  } finally {
    server.close();
  }
});

test('/api/estado devolve a árvore com faixas e tarefas', async () => {
  fixture();
  const { server, url } = await subir({ global: true });
  try {
    const est = await (await fetch(`${url}api/estado`)).json();
    const ex = est.projetos[0].execucoes[0];
    assert.equal(ex.faixas[0].tarefas[0].id, 'T-001');
    assert.equal(ex.total, 1);
    assert.ok(est.atualizado);
  } finally {
    server.close();
  }
});

test('/api/stream devolve a linha do tempo e respeita o cursor "desde"', async () => {
  const { runId } = fixture();
  const { server, url } = await subir({ global: true });
  try {
    const cheio = await (await fetch(`${url}api/stream?run=${runId}&chave=faixa-1--T-001`)).json();
    assert.equal(cheio.existe, true);
    assert.equal(cheio.total, 3);
    assert.deepEqual(cheio.itens.map((i) => i.tipo), ['inicio', 'ferramenta', 'saida']);
    assert.equal(cheio.itens[1].resumo, 'npm test');

    const incremental = await (await fetch(`${url}api/stream?run=${runId}&chave=faixa-1--T-001&desde=2`)).json();
    assert.deepEqual(incremental.itens.map((i) => i.tipo), ['saida']);

    const inexistente = await (await fetch(`${url}api/stream?run=${runId}&chave=faixa-9--T-999`)).json();
    assert.equal(inexistente.existe, false);

    assert.equal((await fetch(`${url}api/stream`)).status, 400, 'sem run/chave é 400');
  } finally {
    server.close();
  }
});

test('/api/log responde 404 para execução desconhecida e vazio sem log', async () => {
  const { runId } = fixture();
  const { server, url } = await subir({ global: true });
  try {
    assert.equal((await fetch(`${url}api/log?run=fantasma`)).status, 404);
    const d = await (await fetch(`${url}api/log?run=${runId}`)).json();
    assert.equal(d.texto, '');
  } finally {
    server.close();
  }
});

test('POST /executar exige token e traduz o escopo em argumentos reais', async () => {
  const { runId } = fixture();
  const { server, url, token } = await subir({ global: true });
  const post = (corpo, cabecalhos = {}) =>
    fetch(`${url}executar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecalhos },
      body: JSON.stringify(corpo),
    });
  try {
    assert.equal((await post({ runId, escopo: 'tudo' })).status, 403, 'sem token: barrado');
    assert.equal((await post({ runId, escopo: 'tudo' }, { 'x-onp-token': 'errado' })).status, 403);
    assert.equal(
      (await post({ runId: 'fantasma', escopo: 'tudo' }, { 'x-onp-token': token })).status,
      404,
      'execução fora do ledger: 404'
    );
    assert.equal(
      (await post({ runId, escopo: 'apaga-tudo' }, { 'x-onp-token': token })).status,
      400,
      'escopo inválido: 400'
    );

    const ok = await post({ runId, escopo: 'faixa:faixa-1' }, { 'x-onp-token': token });
    assert.equal(ok.status, 202);
    // o script de mentira registra os argumentos recebidos
    await new Promise((r) => setTimeout(r, 400));
    const { readFileSync } = await import('fs');
    assert.match(readFileSync(path.join(repo, 'chamada.txt'), 'utf-8'), /args: --faixa faixa-1/);
  } finally {
    server.close();
  }
});

test('POST /executar recusa plano do Antigravity (execução é nos agentes nativos)', async () => {
  const { runId } = fixture({ agent: 'antigravity' });
  const { server, url, token } = await subir({ global: true });
  try {
    const r = await fetch(`${url}executar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-onp-token': token },
      body: JSON.stringify({ runId, escopo: 'tudo' }),
    });
    assert.equal(r.status, 409);
    assert.match(await r.text(), /agentes nativos/);
  } finally {
    server.close();
  }
});

test('POST /executar sem executar-tarefas.sh instrui a gerar o plano', async () => {
  const { runId } = fixture({ comScript: false });
  const { server, url, token } = await subir({ global: true });
  try {
    const r = await fetch(`${url}executar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-onp-token': token },
      body: JSON.stringify({ runId, escopo: 'tudo' }),
    });
    assert.equal(r.status, 404);
    assert.match(await r.text(), /onp-spec plano/);
  } finally {
    server.close();
  }
});

// o fetch do Node não deixa sobrescrever o Host: precisa de requisição crua
function pedirComHost(porta, host, caminho = '/api/estado') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, headers: { Host: host } }, (res) => {
      let corpo = '';
      res.on('data', (c) => (corpo += c));
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('requisição com Host externo é recusada (nada de DNS rebinding)', async () => {
  fixture();
  const { server, porta } = await subir({ global: true });
  try {
    const mau = await pedirComHost(porta, 'evil.example.com');
    assert.equal(mau.status, 403);
    assert.match(mau.corpo, /somente localhost/);
    assert.equal((await pedirComHost(porta, `127.0.0.1:${porta}`)).status, 200);
    assert.equal((await pedirComHost(porta, `localhost:${porta}`)).status, 200);
  } finally {
    server.close();
  }
});

test('rota desconhecida é 404', async () => {
  fixture();
  const { server, url } = await subir({ global: true });
  try {
    assert.equal((await fetch(`${url}nao-existe`)).status, 404);
  } finally {
    server.close();
  }
});
