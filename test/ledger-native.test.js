import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumirStream } from '../src/core/ledger.js';
import { classifyRateLimit, quotaDecision } from '../src/core/quota.js';

const jsonl = (events) => events.map((event) => JSON.stringify(event)).join('\n');

// Envelope and tool fields: https://antigravity.google/docs/cli/headless/
// Counters in result are cumulative session usage, not one step's usage.
const AGY = [
  { event: 'init', conversation_id: 'conversation-agy', init: { cwd: '/project', model: 'reported-model', tools: ['run_command'] } },
  { event: 'step_update', step_update: { conversation_id: 'conversation-agy', step_index: 2, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Implementation ' } },
  { event: 'step_update', step_update: { conversation_id: 'conversation-agy', step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'complete.', usage: { thinking_tokens: 80, output_tokens: 4 } } },
  { event: 'step_update', step_update: { conversation_id: 'conversation-agy', step_index: 3, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command' } },
  { event: 'step_update', step_update: { conversation_id: 'conversation-agy', step_index: 3, state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'node --test' }, output: 'tests passed' } } },
  { event: 'result', result: { conversation_id: 'conversation-agy', status: 'SUCCESS', response: 'Implementation complete.', duration_seconds: 2.5, num_turns: 1, usage: { input_tokens: 20, output_tokens: 8, thinking_tokens: 80 } } },
];

test('Antigravity official envelopes preserve session, text, tool output and cumulative result', () => {
  const result = resumirStream(jsonl(AGY));
  assert.equal(result.itens[0].sessao, 'conversa');
  assert.equal(result.itens[0].modelo, 'reported-model');
  assert.equal(result.itens.filter((item) => item.tipo === 'texto').map((item) => item.texto).join(''), 'Implementation complete.');
  assert.equal(result.itens.filter((item) => item.tipo === 'ferramenta').length, 1, 'ACTIVE tool is not duplicated');
  assert.equal(result.itens.find((item) => item.tipo === 'saida').texto, 'tests passed');
  assert.deepEqual(result.resumo, { status: 'sucesso', duracaoMs: 2500, turnos: 1, custoUsd: null, tokensSaida: 8, tokensEntrada: 20 });
  assert.equal(result.itens.at(-1).texto, 'Implementation complete.');
  assert.equal(result.itens.some((item) => item.tipo === 'pensando'), false, 'token counters do not expose reasoning text');
});

test('Antigravity error/awaiting result is never reported as success; progress is not terminal', () => {
  const waiting = resumirStream(jsonl([{ event: 'result', result: { status: 'WAITING', response: 'Need a decision' } }]));
  assert.equal(waiting.resumo.status, 'waiting');
  const failure = resumirStream(jsonl([{ event: 'result', result: { status: 'ERROR', error: 'quota exhausted', response: '' } }]));
  assert.equal(failure.resumo.status, 'erro');
  assert.equal(failure.itens.at(-1).texto, 'quota exhausted');
  assert.equal(resumirStream(jsonl(AGY.slice(0, -1))).resumo, null);
  assert.equal(resumirStream(jsonl(AGY), { desde: AGY.length - 1 }).resumo.status, 'sucesso');
  const quota = classifyRateLimit({ event: 'result', result: { status: 'ERROR', error: 'quota exhausted' } });
  assert.equal(quotaDecision(quota).action, 'wait');
});

// Shape established in the upstream renderer (emit/text/tool/step/error):
// https://github.com/anomalyco/opencode/blob/dev/packages/cli/src/run/noninteractive.ts
const OPEN = [
  { type: 'step_start', timestamp: 1000, sessionID: 'ses_native-123', part: { id: 'part1', type: 'step-start', messageID: 'message1' } },
  { type: 'tool_use', timestamp: 1010, sessionID: 'ses_native-123', part: { id: 'tool1', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'node --test' }, output: 'tests passed' } } },
  { type: 'step_finish', timestamp: 1020, sessionID: 'ses_native-123', part: { id: 'finish1', messageID: 'message1', type: 'step-finish', reason: 'tool-calls', cost: 0.01, tokens: { input: 100, output: 20, reasoning: 8 } } },
  { type: 'step_start', timestamp: 1030, sessionID: 'ses_native-123', part: { id: 'part2', type: 'step-start', messageID: 'message2' } },
  { type: 'text', timestamp: 1040, sessionID: 'ses_native-123', part: { type: 'text', text: 'Implementation complete.' } },
  { type: 'step_finish', timestamp: 1050, sessionID: 'ses_native-123', part: { id: 'finish2', messageID: 'message2', type: 'step-finish', reason: 'stop', cost: 0.02, tokens: { input: 30, output: 10, reasoning: 0 } } },
];

test('OpenCode tool-calls is intermediate; final step accumulates reported usage without reasoning', () => {
  assert.equal(resumirStream(jsonl(OPEN.slice(0, 3))).resumo, null);
  const result = resumirStream(jsonl(OPEN));
  assert.equal(result.itens.filter((item) => item.tipo === 'inicio').length, 1);
  assert.equal(result.itens[0].sessao, 'ses_nati');
  assert.equal(result.itens.find((item) => item.tipo === 'ferramenta').nome, 'bash');
  assert.equal(result.itens.find((item) => item.tipo === 'saida').texto, 'tests passed');
  assert.equal(result.itens.find((item) => item.tipo === 'texto').texto, 'Implementation complete.');
  assert.deepEqual(result.resumo, { status: 'sucesso', duracaoMs: null, turnos: null, tokensEntrada: 130, tokensSaida: 30, custoUsd: 0.03 });
  assert.equal(result.itens.some((item) => item.tipo === 'pensando'), false);
});

test('OpenCode error nested message and tool failure remain visible', () => {
  const result = resumirStream(jsonl([
    OPEN[0],
    { type: 'tool_use', sessionID: 'ses_native-123', part: { tool: 'bash', state: { status: 'error', input: { command: 'node --test' }, error: 'test failure' } } },
    { type: 'error', sessionID: 'ses_native-123', error: { type: 'api', message: 'Provider unavailable' } },
  ]));
  assert.equal(result.resumo.status, 'erro');
  assert.deepEqual(result.itens.filter((item) => item.tipo === 'saida').map((item) => item.texto), ['test failure', 'Provider unavailable']);
  assert.equal(result.itens.at(-1).texto, 'Provider unavailable');
});

test('OpenCode missing/truncated terminal reason never becomes success and no usage is invented', () => {
  for (const reason of [undefined, 'length', 'content-filter', 'unknown']) {
    const result = resumirStream(jsonl([{ type: 'step_finish', part: { reason } }]));
    assert.notEqual(result.resumo.status, 'sucesso');
    assert.equal(result.resumo.custoUsd, null);
    assert.equal(result.resumo.tokensEntrada, null);
    assert.equal(result.resumo.tokensSaida, null);
  }
  assert.equal(resumirStream(jsonl(OPEN.slice(0, -1))).resumo, null, 'text alone is not evidence of a completed step');
});
