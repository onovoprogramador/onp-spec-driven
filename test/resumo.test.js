// Resumo geral de andamento: o motor conta o que vê (determinístico), a IA
// grava por cima (--gravar --texto), e o frescor decide qual vale — um resumo
// de IA velho afirmando "executando" seria mentira.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { registrarEvento, lerEventos, montarArvore, caminhos, caminhoStream } from '../src/core/ledger.js';
import {
  resumoDeterministico,
  contextoParaIa,
  montarResumoAtual,
  registrarResumo,
  execucaoAlvo,
  ultimaAcao,
  tabelaAndamento,
  FRESCOR_IA_MS,
} from '../src/core/resumo.js';

let home;
const antes = process.env.ONP_SPEC_HOME;
before(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'onpspec-resumo-'));
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

function plano(runId = 'run-r') {
  registrarEvento({
    tipo: 'plano',
    runId,
    projeto: 'repo-a',
    projetoDir: '/tmp/repo-a',
    feature: 'pagamentos',
    agent: 'claude',
    plano: {
      runId,
      branchTrabalho: 'spec/pagamentos',
      baseDir: '.spec/features/pagamentos',
      ondas: [['faixa-1', 'faixa-2']],
      faixas: [
        {
          id: 'faixa-1',
          branch: 'spec/pagamentos-faixa-1',
          worktree: '../wt-1',
          tarefas: [{ id: 'T-001', titulo: 'Modelo de cobrança', modelo: 'claude-sonnet-5', esforco: 'medium', arquivos: ['a'] }],
        },
        {
          id: 'faixa-2',
          branch: 'spec/pagamentos-faixa-2',
          worktree: '../wt-2',
          tarefas: [{ id: 'T-002', titulo: 'Recibo', modelo: 'claude-opus-5', esforco: 'high', arquivos: ['b'] }],
        },
      ],
      sequenciais: [],
    },
  });
  return runId;
}

test('vazio: o resumo do motor explica o próximo passo em vez de silêncio', () => {
  assert.match(resumoDeterministico([]), /Nenhuma execução no ledger/);
});

test('motor narra: concluídas e tarefa em execução com a última ação do modelo', () => {
  const runId = plano();
  registrarEvento({ tipo: 'tarefa', runId, faixa: 'faixa-1', tarefa: 'T-001', estado: 'executando', stream: 'faixa-1--T-001' });
  mkdirSync(path.dirname(caminhoStream(runId, 'faixa-1--T-001')), { recursive: true });
  writeFileSync(
    caminhoStream(runId, 'faixa-1--T-001'),
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}\n'
  );

  const texto = resumoDeterministico(montarArvore(lerEventos()));
  assert.match(texto, /"pagamentos" \(repo-a\): 0 de 2/);
  assert.match(texto, /Executando agora: T-001 \(Modelo de cobrança\) na faixa-1/);
  assert.match(texto, /última ação: Bash: npm test/);
});

test('motor não anuncia vitória sem audit: gate pendente é dito como pendente', () => {
  const runId = plano();
  registrarEvento({ tipo: 'tarefa', runId, faixa: 'faixa-1', tarefa: 'T-001', estado: 'concluida' });
  registrarEvento({ tipo: 'tarefa', runId, faixa: 'faixa-2', tarefa: 'T-002', estado: 'concluida' });
  const texto = resumoDeterministico(montarArvore(lerEventos()));
  assert.match(texto, /gate \(verify \+ audit\) ainda pendente/);
  assert.doesNotMatch(texto, /alinhados/);
});

test('falha pede o agente; conflito pede resolução', () => {
  const runId = plano();
  registrarEvento({ tipo: 'faixa', runId, faixa: 'faixa-1', estado: 'falhou' });
  registrarEvento({ tipo: 'faixa', runId, faixa: 'faixa-2', estado: 'conflito' });
  registrarEvento({ tipo: 'fim', runId, exit: 1, escopo: 'tudo' });
  const texto = resumoDeterministico(montarArvore(lerEventos()));
  assert.match(texto, /faixa-1 falhou — peça ao agente/);
  assert.match(texto, /faixa-2 parou em CONFLITO/);
});

test('montarResumoAtual: IA fresca vence; IA velha perde para o motor', () => {
  const runId = plano();
  registrarEvento({ tipo: 'tarefa', runId, faixa: 'faixa-1', tarefa: 'T-001', estado: 'executando' });
  registrarEvento({ tipo: 'resumo', runId, texto: 'O modelo está corrigindo o webhook do PSP.', origem: 'ia' });

  const arvore = montarArvore(lerEventos());
  const fresco = montarResumoAtual(arvore);
  assert.equal(fresco.origem, 'ia');
  assert.match(fresco.texto, /webhook/);

  const depois = Date.now() + FRESCOR_IA_MS + 1000;
  const velho = montarResumoAtual(arvore, { agora: depois });
  assert.equal(velho.origem, 'motor', 'resumo de IA velho não pode fingir tempo real');
});

test('registrarResumo normaliza espaços, corta texto gigante e exige runId', () => {
  const runId = plano();
  const r = registrarResumo({ runId, texto: '  linha 1\n\nlinha   2  ', origem: 'ia' });
  assert.equal(r.texto, 'linha 1 linha 2');
  const eventos = lerEventos().filter((e) => e.tipo === 'resumo');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].origem, 'ia');

  const grande = registrarResumo({ runId, texto: 'x'.repeat(5000) });
  assert.equal(grande.texto.length, 1200);
  assert.ok(registrarResumo({ runId: null, texto: 'x' }).erro);
  assert.ok(registrarResumo({ runId, texto: '   ' }).erro);
});

test('execucaoAlvo: prefere a que roda; --run força; vazio devolve null', () => {
  const a = plano('run-a');
  registrarEvento({ tipo: 'fim', runId: a, exit: 0, escopo: 'tudo' });
  const b = plano('run-b');
  registrarEvento({ tipo: 'tarefa', runId: b, faixa: 'faixa-1', tarefa: 'T-001', estado: 'executando' });

  const arvore = montarArvore(lerEventos());
  assert.equal(execucaoAlvo(arvore).runId, 'run-b', 'a execução rodando é o alvo natural');
  assert.equal(execucaoAlvo(arvore, { runId: 'run-a' }).runId, 'run-a');
  assert.equal(execucaoAlvo(arvore, { runId: 'fantasma' }), null);
  assert.equal(execucaoAlvo([]), null);
});

test('ultimaAcao lê só a cauda do stream e tolera arquivo ausente', () => {
  const runId = plano();
  const chave = 'faixa-1--T-001';
  mkdirSync(path.dirname(caminhoStream(runId, chave)), { recursive: true });
  const enchimento = Array.from({ length: 200 }, () =>
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok'.repeat(40) }] } })
  );
  enchimento.push(
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/x/y.js', old_string: 'a' } }] } })
  );
  writeFileSync(caminhoStream(runId, chave), enchimento.join('\n'));
  assert.match(ultimaAcao(runId, chave), /^Edit: .*y\.js — a/);
  assert.equal(ultimaAcao(runId, 'nao--existe'), null);
});

test('ultimaAcao entende o tool_call do CLI do Cursor (inclusive started, ainda em execução)', () => {
  const runId = plano();
  const chave = 'faixa-1--T-002';
  mkdirSync(path.dirname(caminhoStream(runId, chave)), { recursive: true });
  writeFileSync(
    caminhoStream(runId, chave),
    [
      '{"type":"system","subtype":"init","session_id":"abc","model":"composer"}',
      '{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"shellToolCall":{"args":{"command":"node --test"}}}}',
    ].join('\n')
  );
  assert.equal(ultimaAcao(runId, chave), 'Bash: node --test', 'started mostra o que roda AGORA');

  writeFileSync(
    caminhoStream(runId, chave),
    '{"type":"tool_call","subtype":"completed","call_id":"c2","tool_call":{"readToolCall":{"args":{"path":"/a/b/spec.md"},"result":{"success":{"content":"x"}}}}}\n'
  );
  assert.equal(ultimaAcao(runId, chave), 'Read: a/b/spec.md');
});

test('tabelaAndamento: uma linha por tarefa, com onde roda, status e última ação', () => {
  const runId = plano();
  registrarEvento({ tipo: 'tarefa', runId, faixa: 'faixa-1', tarefa: 'T-001', estado: 'executando', stream: 'faixa-1--T-001' });
  mkdirSync(path.dirname(caminhoStream(runId, 'faixa-1--T-001')), { recursive: true });
  writeFileSync(
    caminhoStream(runId, 'faixa-1--T-001'),
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test | tee log"}}]}}\n'
  );

  const md = tabelaAndamento(montarArvore(lerEventos()));
  assert.match(md, /\*\*pagamentos\*\* \(repo-a\) — 0 de 2 tarefa\(s\) concluída\(s\)/);
  assert.match(md, /EM EXECUÇÃO/);
  assert.match(md, /\| tarefa \| título \| onde \| status \| última ação \|/);
  assert.match(md, /\| T-001 \| Modelo de cobrança \| faixa-1 \| ▶️ executando \| Bash: npm test \\\| tee log \|/, 'pipe da célula escapado');
  assert.match(md, /\| T-002 \| Recibo \| faixa-2 \| ⏳ pendente \| — \|/);
});

test('tabelaAndamento: concluída/falhou aparecem; rodapé traz faixa falhada e gate', () => {
  const runId = plano();
  registrarEvento({ tipo: 'tarefa', runId, faixa: 'faixa-1', tarefa: 'T-001', estado: 'concluida' });
  registrarEvento({ tipo: 'tarefa', runId, faixa: 'faixa-2', tarefa: 'T-002', estado: 'falhou' });
  registrarEvento({ tipo: 'faixa', runId, faixa: 'faixa-2', estado: 'falhou' });
  registrarEvento({ tipo: 'gate', runId, etapa: 'verify', exit: 0 });
  registrarEvento({ tipo: 'gate', runId, etapa: 'audit', exit: 1 });
  registrarEvento({ tipo: 'fim', runId, exit: 1, escopo: 'tudo' });

  const md = tabelaAndamento(montarArvore(lerEventos()));
  assert.match(md, /1 de 2 tarefa\(s\) concluída\(s\)/);
  assert.match(md, /\| T-001 .* ✅ concluida /);
  assert.match(md, /\| T-002 .* ❌ falhou /);
  assert.match(md, /faixa-2 falhou \(reexecute: --faixa faixa-2\)/);
  assert.match(md, /verify exit 0 · audit exit 1/);
  assert.doesNotMatch(md, /EM EXECUÇÃO/);
});

test('tabelaAndamento: vazio explica o próximo passo; sem nada rodando mostra a mais recente', () => {
  assert.match(tabelaAndamento([]), /Nenhuma execução no ledger/);
  const runId = plano();
  registrarEvento({ tipo: 'fim', runId, exit: 0, escopo: 'tudo' });
  const md = tabelaAndamento(montarArvore(lerEventos()));
  assert.match(md, /\| T-001 \|/, 'a execução mais recente aparece mesmo parada');
});

test('contextoParaIa lista faixas e tarefas da execução que roda', () => {
  const runId = plano();
  registrarEvento({ tipo: 'faixa', runId, faixa: 'faixa-1', estado: 'executando', tentativa: 1 });
  registrarEvento({ tipo: 'tarefa', runId, faixa: 'faixa-1', tarefa: 'T-001', estado: 'executando' });
  const ctx = contextoParaIa(montarArvore(lerEventos()));
  assert.match(ctx, /Estado mecânico:/);
  assert.match(ctx, /pagamentos\/faixa-1: executando/);
  assert.match(ctx, /T-001 \[executando\] Modelo de cobrança/);
});
