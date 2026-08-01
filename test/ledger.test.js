// Ledger global: UM arquivo para todos os projetos. Aqui se prova que a
// árvore projeto → execução → faixa → tarefa sai correta dos eventos, que a
// poda não deixa o arquivo crescer para sempre, e que o parser transforma o
// stream-json do claude na linha do tempo que o painel mostra.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import {
  registrarEvento,
  lerEventos,
  montarArvore,
  podarLedger,
  caminhos,
  caminhoStream,
  chaveStream,
  resumirStream,
  resumoFerramenta,
  resumoItemCodex,
  resumoToolCallCursor,
  lerStream,
  streamsDaExecucao,
} from '../src/core/ledger.js';

let home;
const antes = process.env.ONP_SPEC_HOME;
before(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'onpspec-ledger-'));
  process.env.ONP_SPEC_HOME = home;
});
after(() => {
  if (antes === undefined) delete process.env.ONP_SPEC_HOME;
  else process.env.ONP_SPEC_HOME = antes;
  rmSync(home, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(caminhos().dir, { recursive: true, force: true });
});

function planoDe(runId, { projeto = 'repo-a', feature = 'pagamentos', agent = 'claude', dir = '/tmp/repo-a' } = {}) {
  return {
    tipo: 'plano',
    runId,
    projeto,
    projetoDir: dir,
    feature,
    agent,
    plano: {
      runId,
      branchTrabalho: `spec/${feature}`,
      baseDir: `.spec/features/${feature}`,
      ondas: [['faixa-1', 'faixa-2']],
      faixas: [
        {
          id: 'faixa-1',
          branch: `spec/${feature}-faixa-1`,
          worktree: '../wt-1',
          tarefas: [
            { id: 'T-001', titulo: 'Modelo', modelo: 'claude-sonnet-5', esforco: 'medium', arquivos: ['src/a.js'] },
            { id: 'T-003', titulo: 'Rota', modelo: 'claude-sonnet-5', esforco: 'medium', arquivos: ['src/b.js'] },
          ],
        },
        {
          id: 'faixa-2',
          branch: `spec/${feature}-faixa-2`,
          worktree: '../wt-2',
          tarefas: [{ id: 'T-002', titulo: 'Recibo', modelo: 'claude-opus-5', esforco: 'high', arquivos: ['src/c.js'] }],
        },
      ],
      sequenciais: [{ id: 'T-004', titulo: 'Doc', modelo: 'claude-sonnet-5', esforco: 'medium', arquivos: [] }],
    },
  };
}

test('escreve e lê o ledger no ONP_SPEC_HOME (nunca no home real do usuário)', () => {
  registrarEvento({ tipo: 'plano', runId: 'x', projeto: 'p' });
  assert.ok(caminhos().ledger.startsWith(home), 'ledger tem que ficar sob ONP_SPEC_HOME');
  assert.ok(existsSync(caminhos().ledger));
  const eventos = lerEventos();
  assert.equal(eventos.length, 1);
  assert.ok(eventos[0].ts, 'evento ganha timestamp');
});

test('linha corrompida no ledger não derruba a leitura', () => {
  registrarEvento({ tipo: 'plano', runId: 'x' });
  writeFileSync(caminhos().ledger, `${readFileSync(caminhos().ledger, 'utf-8')}{quebrado\n`);
  registrarEvento({ tipo: 'fim', runId: 'x', exit: 0 });
  assert.deepEqual(lerEventos().map((e) => e.tipo), ['plano', 'fim']);
});

test('árvore: agrupa por projeto e reflete faixas, tarefas e contagens', () => {
  registrarEvento(planoDe('run-1'));
  registrarEvento({ tipo: 'faixa', runId: 'run-1', faixa: 'faixa-1', estado: 'executando', tentativa: 1 });
  registrarEvento({ tipo: 'tarefa', runId: 'run-1', faixa: 'faixa-1', tarefa: 'T-001', estado: 'executando', stream: 'faixa-1--T-001' });

  const [proj] = montarArvore(lerEventos());
  assert.equal(proj.projeto, 'repo-a');
  const ex = proj.execucoes[0];
  assert.equal(ex.rodando, true, 'tarefa executando = execução rodando');
  assert.equal(ex.total, 4);
  assert.equal(ex.concluidas, 0);
  assert.equal(ex.faixas[0].estado, 'executando');
  assert.equal(ex.faixas[0].tarefas[0].estado, 'executando');
  assert.equal(ex.faixas[0].tarefas[0].stream, 'faixa-1--T-001');
  assert.equal(ex.sequenciais[0].id, 'T-004');
});

test('árvore: falha de faixa, conclusão e contagem de falhas', () => {
  registrarEvento(planoDe('run-2'));
  registrarEvento({ tipo: 'tarefa', runId: 'run-2', faixa: 'faixa-1', tarefa: 'T-001', estado: 'concluida' });
  registrarEvento({ tipo: 'faixa', runId: 'run-2', faixa: 'faixa-1', estado: 'mesclada' });
  registrarEvento({ tipo: 'tarefa', runId: 'run-2', faixa: 'faixa-2', tarefa: 'T-002', estado: 'falhou' });
  registrarEvento({ tipo: 'faixa', runId: 'run-2', faixa: 'faixa-2', estado: 'falhou' });
  registrarEvento({ tipo: 'fim', runId: 'run-2', exit: 1, escopo: 'tudo' });

  const ex = montarArvore(lerEventos())[0].execucoes[0];
  assert.equal(ex.rodando, false);
  assert.equal(ex.fim, 1);
  assert.equal(ex.falhas, 1);
  assert.equal(ex.concluidas, 1);
  assert.equal(ex.faixas[1].tarefas[0].estado, 'falhou');
});

test('evento resumo: fica só o mais recente; texto vazio é ignorado', () => {
  registrarEvento(planoDe('run-rs'));
  registrarEvento({ tipo: 'resumo', runId: 'run-rs', texto: 'primeiro', origem: 'motor' });
  registrarEvento({ tipo: 'resumo', runId: 'run-rs', texto: 'segundo', origem: 'ia' });
  registrarEvento({ tipo: 'resumo', runId: 'run-rs', texto: '   ', origem: 'ia' });

  const ex = montarArvore(lerEventos())[0].execucoes[0];
  assert.equal(ex.resumo.texto, 'segundo');
  assert.equal(ex.resumo.origem, 'ia');
  assert.ok(ex.resumo.ts);
});

test('reexecutar uma faixa: nova tentativa reabre as tarefas dela e só dela', () => {
  registrarEvento(planoDe('run-3'));
  // primeira rodada: faixa-1 ok, faixa-2 falhou
  registrarEvento({ tipo: 'tarefa', runId: 'run-3', faixa: 'faixa-1', tarefa: 'T-001', estado: 'concluida' });
  registrarEvento({ tipo: 'faixa', runId: 'run-3', faixa: 'faixa-1', estado: 'mesclada' });
  registrarEvento({ tipo: 'tarefa', runId: 'run-3', faixa: 'faixa-2', tarefa: 'T-002', estado: 'falhou' });
  registrarEvento({ tipo: 'faixa', runId: 'run-3', faixa: 'faixa-2', estado: 'falhou' });
  registrarEvento({ tipo: 'gate', runId: 'run-3', etapa: 'audit', exit: 1 });
  registrarEvento({ tipo: 'fim', runId: 'run-3', exit: 1, escopo: 'tudo' });
  // reexecução só da faixa-2
  registrarEvento({ tipo: 'inicio', runId: 'run-3', escopo: 'faixa:faixa-2' });
  registrarEvento({ tipo: 'faixa', runId: 'run-3', faixa: 'faixa-2', estado: 'executando', tentativa: 2 });

  const ex = montarArvore(lerEventos())[0].execucoes[0];
  assert.equal(ex.faixas[0].estado, 'mesclada', 'faixa-1 não é afetada pela reexecução da faixa-2');
  assert.equal(ex.faixas[0].tarefas[0].estado, 'concluida');
  assert.equal(ex.faixas[1].tentativa, 2);
  assert.equal(ex.faixas[1].tarefas[0].estado, 'pendente', 'a tarefa que falhou volta a pendente na nova tentativa');
  assert.equal(ex.rodando, true);
});

test('gate fica DESATUALIZADO quando há trabalho novo depois do audit', () => {
  registrarEvento(planoDe('run-4'));
  registrarEvento({ tipo: 'gate', runId: 'run-4', etapa: 'verify', exit: 0 });
  registrarEvento({ tipo: 'gate', runId: 'run-4', etapa: 'audit', exit: 1 });
  let ex = montarArvore(lerEventos())[0].execucoes[0];
  assert.equal(ex.gateDesatualizado, false);
  assert.deepEqual(ex.gate, { verify: 0, audit: 1 });

  registrarEvento({ tipo: 'inicio', runId: 'run-4', escopo: 'faixa:faixa-2' });
  ex = montarArvore(lerEventos())[0].execucoes[0];
  assert.equal(ex.gateDesatualizado, true, 'trabalho novo invalida o veredito anterior');

  registrarEvento({ tipo: 'gate', runId: 'run-4', etapa: 'audit', exit: 0 });
  ex = montarArvore(lerEventos())[0].execucoes[0];
  assert.equal(ex.gateDesatualizado, false, 'audit novo devolve veredito fresco');
  assert.equal(ex.gate.audit, 0);
});

test('execução "tudo" zera o gate anterior', () => {
  registrarEvento(planoDe('run-5'));
  registrarEvento({ tipo: 'gate', runId: 'run-5', etapa: 'audit', exit: 1 });
  registrarEvento({ tipo: 'inicio', runId: 'run-5', escopo: 'tudo' });
  const ex = montarArvore(lerEventos())[0].execucoes[0];
  assert.deepEqual(ex.gate, { verify: null, audit: null });
  assert.equal(ex.gateDesatualizado, false);
});

test('projetos diferentes convivem no MESMO ledger e podem ser filtrados', () => {
  registrarEvento(planoDe('run-a', { projeto: 'repo-a', dir: '/tmp/repo-a', feature: 'pagamentos' }));
  registrarEvento(planoDe('run-b', { projeto: 'loja', dir: '/tmp/loja', feature: 'checkout' }));
  registrarEvento(planoDe('run-c', { projeto: 'loja', dir: '/tmp/loja', feature: 'estoque' }));

  const todos = montarArvore(lerEventos());
  assert.equal(todos.length, 2, 'dois projetos');
  const loja = todos.find((p) => p.projeto === 'loja');
  assert.equal(loja.execucoes.length, 2);

  const soLoja = montarArvore(lerEventos(), { projetoDir: '/tmp/loja' });
  assert.equal(soLoja.length, 1);
  const soCheckout = montarArvore(lerEventos(), { projetoDir: '/tmp/loja', feature: 'checkout' });
  assert.equal(soCheckout[0].execucoes.length, 1);
  assert.equal(soCheckout[0].execucoes[0].feature, 'checkout');
});

test('evento de execução sem plano (podado) é ignorado sem quebrar', () => {
  registrarEvento({ tipo: 'faixa', runId: 'fantasma', faixa: 'faixa-1', estado: 'executando' });
  assert.deepEqual(montarArvore(lerEventos()), []);
});

test('poda mantém as N execuções mais recentes e apaga os streams das antigas', () => {
  for (let i = 1; i <= 5; i++) {
    registrarEvento(planoDe(`run-${i}`));
    const dir = path.dirname(caminhoStream(`run-${i}`, 'x'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(caminhoStream(`run-${i}`, 'faixa-1--T-001'), '{}\n');
  }
  const { removidas } = podarLedger(2);
  assert.deepEqual(removidas, ['run-1', 'run-2', 'run-3']);
  const restantes = montarArvore(lerEventos())[0].execucoes.map((e) => e.runId).sort();
  assert.deepEqual(restantes, ['run-4', 'run-5']);
  assert.ok(!existsSync(caminhoStream('run-1', 'faixa-1--T-001')), 'stream da execução podada some');
  assert.ok(existsSync(caminhoStream('run-5', 'faixa-1--T-001')), 'stream da execução mantida fica');
});

test('poda não faz nada quando está dentro do limite', () => {
  registrarEvento(planoDe('run-1'));
  assert.deepEqual(podarLedger(30).removidas, []);
});

// ── parser do stream do modelo ────────────────────────────────────────────

test('resumoFerramenta descreve cada ferramenta pelo que importa ver', () => {
  assert.equal(resumoFerramenta('Bash', { command: 'npm test' }), 'npm test');
  assert.equal(resumoFerramenta('Read', { file_path: '/a/b/c/d/spec.md' }), 'c/d/spec.md');
  assert.match(resumoFerramenta('Write', { file_path: '/x/y.js', content: 'a\nb\n' }), /y\.js \(3 linhas\)/);
  assert.match(resumoFerramenta('Edit', { file_path: '/x/y.js', old_string: 'linha velha\nresto' }), /y\.js — linha velha/);
  assert.equal(resumoFerramenta('Grep', { pattern: 'TODO' }), 'TODO');
  assert.equal(resumoFerramenta('TodoWrite', { todos: [1, 2, 3] }), '3 item(ns)');
  assert.match(resumoFerramenta('FerramentaNova', { alvo: 'x' }), /alvo: "x"/);
  assert.equal(resumoFerramenta('SemInput', {}), '');
});

// shapes REAIS capturados de `claude -p --output-format stream-json --verbose`
const STREAM_REAL = [
  '{"type":"system","subtype":"init","session_id":"fd1b2f49-aaaa","model":"claude-sonnet-5","cwd":"/tmp/x"}',
  '{"type":"rate_limit_event","rate_limit_info":{}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/tmp/x/a.txt"}}],"usage":{"output_tokens":41}}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","content":"1\\tx=1\\n"}]}}',
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":50,"estimated_tokens_delta":50}',
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":86,"estimated_tokens_delta":36}',
  '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"","signature":"abc"}],"usage":{"output_tokens":2}}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/tmp/x/b.txt","content":"x=2\\n"}}],"usage":{"output_tokens":2}}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","content":[{"type":"text","text":"File created"}]}]}}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"Criei b.txt"}],"usage":{"output_tokens":2}}}',
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":9835,"num_turns":3,"total_cost_usd":0.1018,"result":"pronto","usage":{"input_tokens":6258,"output_tokens":376}}',
].join('\n');

test('resumirStream transforma o NDJSON real na linha do tempo do painel', () => {
  const { itens, total, resumo } = resumirStream(STREAM_REAL);
  assert.equal(total, 11);
  const tipos = itens.map((i) => i.tipo);
  assert.deepEqual(tipos, ['inicio', 'ferramenta', 'saida', 'pensando', 'ferramenta', 'saida', 'texto', 'fim']);

  assert.equal(itens[0].modelo, 'claude-sonnet-5');
  assert.equal(itens[0].sessao, 'fd1b2f49');
  assert.equal(itens[1].nome, 'Read');
  assert.match(itens[1].resumo, /a\.txt/);
  assert.match(itens[1].detalhe, /file_path/);
  // dois eventos thinking_tokens viram UM item que acumula (86, não 50+86)
  assert.equal(itens[3].tokens, 86);
  assert.equal(itens[3].texto, '', 'thinking vem redigido no headless — texto vazio, sem inventar');
  assert.equal(itens[5].texto, 'File created', 'tool_result em array de blocos também é lido');
  assert.equal(itens[6].texto, 'Criei b.txt');
  assert.deepEqual(resumo, {
    status: 'sucesso',
    duracaoMs: 9835,
    turnos: 3,
    custoUsd: 0.1018,
    tokensSaida: 376,
    tokensEntrada: 6258,
  });
});

test('resumirStream marca erro de ferramenta e resultado de erro', () => {
  const { itens, resumo } = resumirStream(
    [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"node --test"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"1 test failed"}]}}',
      '{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":4210,"num_turns":3,"total_cost_usd":0.04}',
    ].join('\n')
  );
  assert.equal(itens[1].tipo, 'saida');
  assert.equal(itens[1].erro, true);
  assert.equal(resumo.status, 'erro');
});

test('resumirStream é incremental (o painel só pede o que falta)', () => {
  const primeira = resumirStream(STREAM_REAL, { desde: 0 });
  const segunda = resumirStream(STREAM_REAL, { desde: primeira.total });
  assert.equal(segunda.itens.length, 0, 'nada novo desde o fim');
  const parcial = resumirStream(STREAM_REAL, { desde: 9 });
  assert.deepEqual(parcial.itens.map((i) => i.tipo), ['texto', 'fim']);
  assert.equal(parcial.total, 11);
});

// shapes do `codex exec --json` conforme a documentação oficial (JSON Lines:
// thread.started, turn.*, item.* — itens agent_message, reasoning,
// command_execution, file_change, mcp_tool_call, web_search, todo_list)
const STREAM_CODEX = [
  '{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"bash -lc ls","aggregated_output":"src\\ntest\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"Preciso ler a spec antes."}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"file_change","status":"completed","changes":[{"path":"/tmp/x/src/a.js","kind":"update"}]}}',
  '{"type":"item.completed","item":{"id":"item_3","type":"todo_list","items":[{"text":"ler spec","completed":true},{"text":"implementar","completed":false}]}}',
  '{"type":"item.completed","item":{"id":"item_4","type":"agent_message","text":"Tarefa concluída e commitada."}}',
  '{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122}}',
].join('\n');

test('resumirStream entende o JSONL do codex exec --json (paridade com o claude)', () => {
  const { itens, total, resumo } = resumirStream(STREAM_CODEX);
  assert.equal(total, 9);
  const tipos = itens.map((i) => i.tipo);
  assert.deepEqual(tipos, ['inicio', 'ferramenta', 'saida', 'pensando', 'ferramenta', 'ferramenta', 'texto', 'fim']);

  assert.equal(itens[0].sessao, '0199a213');
  assert.equal(itens[1].nome, 'Bash');
  assert.match(itens[1].resumo, /bash -lc ls/);
  assert.equal(itens[2].erro, false, 'exit_code 0 não é erro');
  assert.match(itens[2].texto, /src/);
  assert.match(itens[3].texto, /ler a spec/);
  assert.equal(itens[4].nome, 'Edição');
  assert.match(itens[4].resumo, /update .*src\/a\.js/);
  assert.equal(itens[5].nome, 'Plano');
  assert.equal(itens[5].resumo, '2 item(ns)');
  assert.equal(itens[6].texto, 'Tarefa concluída e commitada.');
  assert.equal(resumo.status, 'sucesso');
  assert.equal(resumo.turnos, 1);
  assert.equal(resumo.tokensSaida, 122);
  assert.equal(resumo.tokensEntrada, 24763);
});

test('resumirStream (codex): comando com exit != 0 e turn.failed viram erro', () => {
  const { itens, resumo } = resumirStream(
    [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"node --test","aggregated_output":"1 test failed","exit_code":1,"status":"failed"}}',
      '{"type":"turn.failed","error":{"message":"task aborted"}}',
    ].join('\n')
  );
  const saida = itens.find((i) => i.tipo === 'saida');
  assert.equal(saida.erro, true);
  assert.match(saida.texto, /failed/);
  assert.equal(resumo.status, 'erro');
  const fim = itens.find((i) => i.tipo === 'fim');
  assert.match(fim.texto, /task aborted/);
});

// shapes do CLI do Cursor (`agent -p --output-format stream-json`) conforme a
// documentação oficial (cursor.com/docs/cli/reference/output-format): NDJSON
// com system/init, user, assistant e result NO MESMO shape do claude; as
// ferramentas chegam como eventos tool_call started/completed com o corpo em
// tool_call.<nome>ToolCall (args e, no completed, result.success/erro).
const STREAM_CURSOR = [
  '{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/tmp/x","session_id":"9f2b1c4d-0000-0000-0000-000000000000","model":"Claude Sonnet 5","permissionMode":"default"}',
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Execute a tarefa T-001"}]},"session_id":"9f2b1c4d"}',
  '{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"/tmp/x/.spec/features/pagamentos/spec.md"}}},"session_id":"9f2b1c4d"}',
  '{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"/tmp/x/.spec/features/pagamentos/spec.md"},"result":{"success":{"content":"# Spec...","isEmpty":false,"totalLines":54,"totalChars":1254}}}},"session_id":"9f2b1c4d"}',
  '{"type":"tool_call","subtype":"started","call_id":"c2","tool_call":{"shellToolCall":{"args":{"command":"node --test"}}},"session_id":"9f2b1c4d"}',
  '{"type":"tool_call","subtype":"completed","call_id":"c2","tool_call":{"shellToolCall":{"args":{"command":"node --test"},"result":{"success":{"output":"tests 3 pass 3"}}}},"session_id":"9f2b1c4d"}',
  '{"type":"tool_call","subtype":"completed","call_id":"c3","tool_call":{"writeToolCall":{"args":{"path":"/tmp/x/src/a.js"},"result":{"success":{"linesCreated":12}}}},"session_id":"9f2b1c4d"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Tarefa concluída e commitada."}]},"session_id":"9f2b1c4d"}',
  '{"type":"result","subtype":"success","duration_ms":45210,"duration_api_ms":44100,"is_error":false,"result":"Tarefa concluída e commitada.","session_id":"9f2b1c4d","request_id":"req-1"}',
].join('\n');

test('resumirStream entende o stream-json do CLI do Cursor (paridade com claude e codex)', () => {
  const { itens, total, resumo } = resumirStream(STREAM_CURSOR);
  assert.equal(total, 9);
  const tipos = itens.map((i) => i.tipo);
  // started não entra (viraria duplicata); completed vira ferramenta (+ saída quando há texto)
  assert.deepEqual(tipos, ['inicio', 'ferramenta', 'saida', 'ferramenta', 'saida', 'ferramenta', 'texto', 'fim']);

  assert.equal(itens[0].sessao, '9f2b1c4d');
  assert.equal(itens[0].modelo, 'Claude Sonnet 5');
  assert.equal(itens[1].nome, 'Read');
  assert.match(itens[1].resumo, /features\/pagamentos\/spec\.md/);
  assert.equal(itens[2].erro, false);
  assert.match(itens[2].texto, /# Spec/);
  assert.equal(itens[3].nome, 'Bash');
  assert.match(itens[3].resumo, /node --test/);
  assert.match(itens[4].texto, /tests 3 pass 3/);
  assert.equal(itens[5].nome, 'Write');
  assert.equal(itens[6].texto, 'Tarefa concluída e commitada.');
  assert.equal(resumo.status, 'sucesso');
  assert.equal(resumo.duracaoMs, 45210);
  assert.equal(resumo.custoUsd, null, 'o stream do Cursor não traz usage/custo — nunca inventar');
});

test('resumirStream (cursor): tool_call com erro e result is_error viram erro', () => {
  const { itens, resumo } = resumirStream(
    [
      '{"type":"system","subtype":"init","session_id":"abc-def","model":"composer","permissionMode":"default"}',
      '{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"shellToolCall":{"args":{"command":"node --test"},"result":{"error":{"message":"1 test failed"}}}}}',
      '{"type":"result","subtype":"error","duration_ms":100,"is_error":true,"result":"a tarefa falhou","session_id":"abc-def"}',
    ].join('\n')
  );
  const saida = itens.find((i) => i.tipo === 'saida');
  assert.equal(saida.erro, true);
  assert.match(saida.texto, /1 test failed/);
  assert.equal(resumo.status, 'erro');
  const fim = itens.find((i) => i.tipo === 'fim');
  assert.match(fim.texto, /a tarefa falhou/);
});

test('resumoToolCallCursor resume tool_calls do Cursor em uma linha', () => {
  const read = resumoToolCallCursor({ readToolCall: { args: { path: '/a/b/c/d.md' } } });
  assert.equal(read.nome, 'Read');
  assert.equal(read.resumo, 'b/c/d.md');
  assert.equal(read.temResultado, false, 'started ainda não tem resultado');

  const shell = resumoToolCallCursor({ shellToolCall: { args: { command: 'npm test' } } });
  assert.deepEqual([shell.nome, shell.resumo], ['Bash', 'npm test']);

  // grep com pattern E path: o que importa ver é a BUSCA, não o diretório
  const grep = resumoToolCallCursor({ grepToolCall: { args: { pattern: 'AC-\\d+', path: '/tmp/x/src' } } });
  assert.deepEqual([grep.nome, grep.resumo], ['Grep', 'AC-\\d+']);

  // ferramenta desconhecida não quebra: nome derivado do próprio corpo
  const outra = resumoToolCallCursor({ deployToolCall: { args: { target: 'staging' } } });
  assert.equal(outra.nome, 'Deploy');
  assert.match(outra.resumo, /target/);

  // shape estranho (sem *ToolCall) é ignorado, nunca explode
  assert.equal(resumoToolCallCursor({ foo: {} }), null);
  assert.equal(resumoToolCallCursor(), null);
});

test('resumoItemCodex resume itens de ferramenta do codex em uma linha', () => {
  assert.deepEqual(resumoItemCodex({ type: 'command_execution', command: 'npm test' }), {
    nome: 'Bash',
    resumo: 'npm test',
  });
  assert.match(
    resumoItemCodex({ type: 'file_change', changes: [{ path: '/a/b/c/d.js', kind: 'add' }] }).resumo,
    /add b\/c\/d\.js/
  );
  assert.equal(resumoItemCodex({ type: 'mcp_tool_call', server: 'db', tool: 'query' }).nome, 'db.query');
  assert.equal(resumoItemCodex({ type: 'web_search', query: 'node test runner' }).resumo, 'node test runner');
  assert.equal(resumoItemCodex({ type: 'agent_message', text: 'oi' }), null, 'mensagem não é ferramenta');
});

test('resumirStream aguenta linha não-JSON (stderr vazado no arquivo)', () => {
  const { itens } = resumirStream('isto não é json\n{"type":"result","subtype":"success"}');
  assert.equal(itens[0].tipo, 'cru');
  assert.match(itens[0].texto, /não é json/);
  assert.equal(itens[1].tipo, 'fim');
});

test('lerStream/streamsDaExecucao leem do disco e não explodem sem arquivo', () => {
  assert.deepEqual(lerStream('nao-existe', 'x'), { itens: [], total: 0, resumo: null, existe: false });
  assert.deepEqual(streamsDaExecucao('nao-existe'), []);

  const chave = chaveStream('faixa-1', 'T-001');
  assert.equal(chave, 'faixa-1--T-001');
  mkdirSync(path.dirname(caminhoStream('run-x', chave)), { recursive: true });
  writeFileSync(caminhoStream('run-x', chave), STREAM_REAL);
  const s = lerStream('run-x', chave);
  assert.equal(s.existe, true);
  assert.equal(s.total, 11);
  assert.deepEqual(streamsDaExecucao('run-x').map((x) => x.chave), [chave]);
});

test('textos gigantes são cortados (o painel não pode receber megabytes)', () => {
  const enorme = 'x'.repeat(5000);
  const { itens } = resumirStream(
    `{"type":"assistant","message":{"content":[{"type":"text","text":"${enorme}"}]}}`
  );
  assert.ok(itens[0].texto.length < 1300, `cortado, veio ${itens[0].texto.length}`);
  assert.match(itens[0].texto, /…$/);
});
