// Teste de interface do painel COM NAVEGADOR de verdade (Playwright).
//
// Fica fora do `npm test` de propósito: o pacote é zero-dependências e o CI
// dos usuários não deve precisar baixar Chromium. Rode com:
//
//   npm run test:ui          (precisa: npx playwright install chromium)
//
// Se o Playwright não estiver instalado, o arquivo é SKIPADO com aviso —
// nunca falha por ausência de ferramenta opcional.

import { test, before, after, skip } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { registrarEvento, caminhoStream, caminhos } from '../../src/core/ledger.js';
import { servirPainel } from '../../src/core/painel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  chromium = null;
}

if (!chromium) {
  test('interface do painel (Playwright ausente)', (t) => {
    t.skip('playwright não instalado — rode: npm i -D playwright && npx playwright install chromium');
  });
} else {
  let tmp;
  let repo;
  let navegador;
  let servidor;
  let endereco;
  const antes = process.env.ONP_SPEC_HOME;

  const STREAM_OK = [
    '{"type":"system","subtype":"init","session_id":"abc12345","model":"claude-sonnet-5"}',
    '{"type":"system","subtype":"thinking_tokens","estimated_tokens":91}',
    '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"","signature":"x"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}',
    '{"type":"user","message":{"content":[{"type":"tool_result","content":"9 passing"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Pronto: testes verdes."}]}}',
    '{"type":"result","subtype":"success","is_error":false,"duration_ms":8317,"num_turns":4,"total_cost_usd":0.0873,"usage":{"output_tokens":163}}',
  ].join('\n');

  const STREAM_ERRO = [
    '{"type":"system","subtype":"init","session_id":"def67890","model":"claude-opus-5"}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"node --test"}}]}}',
    '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"1 test failed"}]}}',
    '{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":4210,"num_turns":3,"total_cost_usd":0.0412}',
  ].join('\n');

  function planoLedger({ runId, projeto, projetoDir, feature }) {
    registrarEvento({
      tipo: 'plano',
      runId,
      projeto,
      projetoDir,
      feature,
      agent: 'claude',
      plano: {
        runId,
        branchTrabalho: `spec/${feature}`,
        baseDir: `.spec/features/${feature}`,
        ondas: [['faixa-1', 'faixa-2']],
        faixas: [
          {
            id: 'faixa-1',
            branch: `spec/${feature}-faixa-1`,
            worktree: '../wt1',
            tarefas: [{ id: 'T-001', titulo: 'Modelo de cobrança', modelo: 'claude-sonnet-5', esforco: 'medium', arquivos: ['src/a.js'] }],
          },
          {
            id: 'faixa-2',
            branch: `spec/${feature}-faixa-2`,
            worktree: '../wt2',
            tarefas: [{ id: 'T-002', titulo: 'Envio de recibo', modelo: 'claude-opus-5', esforco: 'high', arquivos: ['src/b.js'] }],
          },
        ],
        sequenciais: [{ id: 'T-004', titulo: 'Documentar fluxo', modelo: 'claude-sonnet-5', esforco: 'medium', arquivos: [] }],
      },
    });
  }

  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-ui-'));
    process.env.ONP_SPEC_HOME = path.join(tmp, 'home');
    repo = path.join(tmp, 'projeto-a');
    mkdirSync(path.join(repo, '.spec/features/pagamentos'), { recursive: true });
    // script que só registra os argumentos recebidos (não roda claude)
    const sh = path.join(repo, '.spec/features/pagamentos/executar-tarefas.sh');
    writeFileSync(sh, `#!/usr/bin/env bash\necho "$*" > "${path.join(tmp, 'chamada.txt')}"\nsleep 1\n`);
    chmodSync(sh, 0o755);

    // projeto A: faixa-1 mesclada, faixa-2 FALHOU (para testar reexecução)
    planoLedger({ runId: 'run-a', projeto: 'projeto-a', projetoDir: repo, feature: 'pagamentos' });
    registrarEvento({ tipo: 'tarefa', runId: 'run-a', faixa: 'faixa-1', tarefa: 'T-001', estado: 'concluida', stream: 'faixa-1--T-001' });
    registrarEvento({ tipo: 'faixa', runId: 'run-a', faixa: 'faixa-1', estado: 'mesclada' });
    registrarEvento({ tipo: 'tarefa', runId: 'run-a', faixa: 'faixa-2', tarefa: 'T-002', estado: 'falhou', stream: 'faixa-2--T-002' });
    registrarEvento({ tipo: 'faixa', runId: 'run-a', faixa: 'faixa-2', estado: 'falhou' });
    registrarEvento({ tipo: 'gate', runId: 'run-a', etapa: 'verify', exit: 1 });
    registrarEvento({ tipo: 'gate', runId: 'run-a', etapa: 'audit', exit: 1 });
    registrarEvento({ tipo: 'fim', runId: 'run-a', exit: 1, escopo: 'tudo' });

    // projeto B: outro repositório, execução ainda parada (multi-projeto)
    planoLedger({ runId: 'run-b', projeto: 'loja-api', projetoDir: path.join(tmp, 'loja-api'), feature: 'checkout' });

    for (const [chave, conteudo] of [['faixa-1--T-001', STREAM_OK], ['faixa-2--T-002', STREAM_ERRO]]) {
      mkdirSync(path.dirname(caminhoStream('run-a', chave)), { recursive: true });
      writeFileSync(caminhoStream('run-a', chave), conteudo);
    }

    servidor = await servirPainel({ rootDir: repo, specDir: '.spec', global: true, porta: 0, abrir: false, log: () => {} });
    endereco = servidor.url;
    navegador = await chromium.launch();
  });

  after(async () => {
    if (navegador) await navegador.close();
    if (servidor) servidor.server.close();
    if (antes === undefined) delete process.env.ONP_SPEC_HOME;
    else process.env.ONP_SPEC_HOME = antes;
    rmSync(tmp, { recursive: true, force: true });
  });

  async function abrirPagina({ tema = 'light', largura = 1400, altura = 900 } = {}) {
    const ctx = await navegador.newContext({ colorScheme: tema, viewport: { width: largura, height: altura } });
    const pg = await ctx.newPage();
    const problemas = [];
    pg.on('pageerror', (e) => problemas.push(`pageerror: ${e.message}`));
    pg.on('console', (m) => {
      if (m.type() === 'error') problemas.push(`console: ${m.text()}`);
    });
    await pg.goto(endereco, { waitUntil: 'networkidle' });
    await pg.waitForSelector('.exec', { timeout: 5000 });
    // os dois projetos têm tarefas de mesmo título: sempre escopar a execução
    const execA = pg.locator('.exec', { hasText: 'pagamentos' }).first();
    return { pg, problemas, execA };
  }

  test('mostra os DOIS projetos com suas execuções, num painel só', async () => {
    const { pg, problemas } = await abrirPagina();
    const projetos = await pg.$$eval('.proj > h2', (hs) => hs.map((h) => h.textContent.trim().split(' ')[0]));
    assert.deepEqual(projetos.sort(), ['loja-api', 'projeto-a']);
    const features = await pg.$$eval('.exec .feat', (es) => es.map((e) => e.textContent));
    assert.deepEqual(features.sort(), ['checkout', 'pagamentos']);
    assert.deepEqual(problemas, [], 'sem erro de JS na página');
  });

  test('a árvore mostra faixa → tarefa com modelo, esforço e estado', async () => {
    const { execA } = await abrirPagina();
    const faixas = await execA.locator('.faixa .nome').allTextContents();
    assert.deepEqual(faixas, ['faixa-1', 'faixa-2', 'sequenciais', 'gate']);

    const tarefa = execA.locator('.tar', { hasText: 'Envio de recibo' });
    assert.match(await tarefa.textContent(), /T-002/);
    assert.match(await tarefa.textContent(), /claude-opus-5 · high/);
    assert.ok(await tarefa.locator('.ponto.ruim').count(), 'tarefa que falhou fica com ponto vermelho');
    assert.ok(
      await execA.locator('.tar', { hasText: 'Modelo de cobrança' }).locator('.ponto.ok').count(),
      'tarefa concluída fica com ponto verde'
    );

    // ordem das seções é estável: faixa-1, faixa-2, sequenciais, gate
    const f2 = execA.locator('.faixa').nth(1);
    assert.match(await f2.locator('.nome').textContent(), /faixa-2/);
    assert.match(await f2.locator('.chip').first().textContent(), /falhou/);
    assert.match(await execA.locator('.meta').textContent(), /1\/3 tarefas/);
  });

  test('clicar numa tarefa mostra o stream do modelo: ferramenta, raciocínio, custo', async () => {
    const { pg, execA } = await abrirPagina();
    await execA.locator('.tar', { hasText: 'Modelo de cobrança' }).click();
    await pg.waitForSelector('#term .ev.fim', { timeout: 5000 });

    assert.match(await pg.locator('#dettit').textContent(), /T-001 · faixa-1/);
    const linhas = await pg.$$eval('#term .ev', (evs) =>
      evs.map((e) => ({ tipo: e.className.replace('ev', '').trim(), txt: e.querySelector('.txt').textContent }))
    );
    assert.deepEqual(linhas.map((l) => l.tipo), ['inicio', 'pensando', 'ferramenta', 'saida', 'texto', 'fim']);
    assert.match(linhas[0].txt, /sessão abc12345 · modelo claude-sonnet-5/);
    assert.match(linhas[1].txt, /pensando \(91 tokens\)/);
    assert.match(linhas[1].txt, /não exposto no headless/, 'thinking redigido é dito com honestidade');
    assert.match(linhas[2].txt, /Bash\s*npm test/);
    assert.match(linhas[3].txt, /9 passing/);
    assert.match(linhas[5].txt, /sucesso · 4 turno\(s\) · 8\.3s · US\$ 0\.0873/);
  });

  test('stream de tarefa que falhou destaca o erro da ferramenta', async () => {
    const { pg, execA } = await abrirPagina();
    await execA.locator('.tar', { hasText: 'Envio de recibo' }).click();
    await pg.waitForSelector('#term .ev.fim', { timeout: 5000 });
    assert.ok(await pg.locator('#term .ev.saida.erro').count(), 'a saída com is_error aparece marcada');
    assert.match(await pg.locator('#term .ev.fim .txt').textContent(), /erro · 3 turno\(s\)/);
    assert.match(await pg.locator('#detchip').textContent(), /erro/);
  });

  test('gate reprovado aparece como reprovado (nada de verde falso)', async () => {
    const { execA } = await abrirPagina();
    const gate = execA.locator('.faixa').last(); // a seção do gate é a última
    assert.match(await gate.locator('.nome').textContent(), /gate/);
    assert.deepEqual(await gate.locator('.chip').allTextContents(), ['verify ✘', 'audit ✘']);
    assert.match(await execA.locator('.cab .chip').first().textContent(), /pendências/);
    assert.doesNotMatch(await execA.textContent(), /concluída ✔/);
  });

  test('botão de reexecutar só existe na faixa que falhou, e dispara --faixa', async () => {
    const { pg, execA } = await abrirPagina();
    const botoes = execA.locator('button', { hasText: 'reexecutar' });
    assert.equal(await botoes.count(), 1, 'só a faixa-2 (que falhou) oferece reexecução');
    // a execução sem falha nenhuma não oferece reexecutar
    assert.equal(await pg.locator('.exec', { hasText: 'checkout' }).locator('button', { hasText: 'reexecutar' }).count(), 0);

    await botoes.first().click();
    await pg.waitForTimeout(700);
    const { readFileSync } = await import('fs');
    assert.equal(readFileSync(path.join(tmp, 'chamada.txt'), 'utf-8').trim(), '--faixa faixa-2');
    // e o painel passa a olhar a tarefa reexecutada
    assert.match(await pg.locator('#dettit').textContent(), /T-002/);
  });

  test('executar tudo dispara sem argumentos e o painel marca "rodando"', async () => {
    const { pg } = await abrirPagina();
    await pg.locator('.exec', { hasText: 'pagamentos' }).locator('button', { hasText: 'Executar tudo' }).click();
    await pg.waitForTimeout(700);
    const { readFileSync } = await import('fs');
    assert.equal(readFileSync(path.join(tmp, 'chamada.txt'), 'utf-8').trim(), '');
    assert.match(await pg.locator('#global').textContent(), /rodando/);
    await pg.waitForTimeout(1500); // o script de teste dura ~1s
  });

  test('layout responsivo: nada de rolagem horizontal em desktop nem em telefone', async () => {
    for (const largura of [1400, 900, 420]) {
      const { pg } = await abrirPagina({ largura });
      const rola = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      assert.equal(rola, false, `rolagem horizontal em ${largura}px`);
    }
  });

  test('funciona em tema claro e escuro (contraste vem do prefers-color-scheme)', async () => {
    for (const tema of ['light', 'dark']) {
      const { pg, problemas } = await abrirPagina({ tema });
      const fundo = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.match(fundo, /^rgb/);
      assert.deepEqual(problemas, []);
    }
  });
}
