import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { discoverModels, selectModel, readQuota, buildInvocation, notifyNative, readCodex, readClaudeModels, runNativeCommand, resolveNativeInvocation, HARNESS_IDS } from '../src/core/harness.js';

const NOW = Date.parse('2026-11-06T12:00:00Z');

test('Codex paginates actual available model/effort list without built-in model names', async () => {
  const calls = [];
  const catalog = await discoverModels('codex', {
    now: () => NOW,
    rpc: async (method, params) => {
      calls.push({ method, params });
      return params.cursor
        ? { data: [{ model: 'future-expensive', hidden: true }, { model: 'future-default', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: null }
        : { data: [{ model: 'future-small' }], nextCursor: 'page2' };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params.cursor, 'page2');
  assert.equal(selectModel(catalog).id, 'future-default');
  assert.deepEqual(selectModel(catalog).efforts, ['high']);
  assert.equal(selectModel(catalog, 'future-small').id, 'future-small');
  assert.throws(() => selectModel(catalog, 'imaginary'), /não está disponível/);
});

test('discovery failure never selects a historical default', async () => {
  const catalog = await discoverModels('cursor', { run: async () => ({ code: 1, stdout: '' }) });
  assert.equal(catalog.status, 'unavailable');
  assert.deepEqual(catalog.models, []);
  assert.throws(() => selectModel(catalog), /validar os modelos/);
});

test('all CLI catalogs use read-only commands and preserve reported slugs', async () => {
  for (const [harness, command, args, stdout, expected] of [
    ['cursor', 'agent', ['--list-models'], 'Available models:\nfuture-fast - Future Fast\nfuture-best - Future Best (default)\n', 'future-best'],
    ['antigravity', 'agy', ['models'], 'new-planet-high    New Planet (High)\n', 'new-planet-high'],
    ['opencode', 'opencode', ['models', '--refresh'], 'vendor/future-alpha\nvendor/future-beta\n', 'vendor/future-alpha'],
  ]) {
    const catalog = await discoverModels(harness, { run: async (actual, argv) => { assert.equal(actual, command); assert.deepEqual(argv, args); return { code: 0, stdout }; } });
    assert.equal(catalog.status, 'available');
    assert.equal(selectModel(catalog).id, expected);
  }
});

test('native quota bridge validates identity and leaves old timestamps intact for freshness check', async () => {
  const options = { quotaCommand: ['native bridge', 'quota'], now: () => NOW };
  const fresh = await readQuota('claude', { ...options, run: async (_command, _args, opts) => {
    assert.equal(JSON.parse(opts.input).action, 'quota');
    return { stdout: JSON.stringify({ harness: 'claude', observedAt: '2026-11-05T12:00:00Z', rate_limits: { five_hour: { used_percentage: 96, resets_at: NOW / 1000 + 60 } } }), code: 0 };
  } });
  assert.equal(fresh.observedAt, '2026-11-05T12:00:00.000Z');
  assert.equal(fresh.windows[0].remainingPercent, 4);
  const mismatch = await readQuota('claude', { ...options, run: async () => ({ code: 0, stdout: JSON.stringify({ harness: 'cursor', observedAt: new Date(NOW).toISOString(), remainingPercent: 80 }) }) });
  assert.equal(mismatch.status, 'unavailable');
  const missing = await readQuota('claude', { ...options, run: async () => ({ code: 0, stdout: '{"harness":"claude","remainingPercent":80}' }) });
  assert.equal(missing.status, 'unavailable');
  const invalid = await readQuota('claude', { ...options, run: async () => ({ code: 0, stdout: '{"harness":"claude","observedAt":"invalid","remainingPercent":80}' }) });
  assert.equal(invalid.status, 'unavailable');
});

test('Codex reads account quota via RPC and unsupported JSON quota stays explicit', async () => {
  const snapshot = await readQuota('codex', { now: () => NOW, rpc: async (method) => {
    assert.equal(method, 'account/rateLimits/read');
    return { rateLimits: { primary: { usedPercent: 95, resetsAt: NOW / 1000 + 60 } } };
  } });
  assert.equal(snapshot.windows[0].remainingPercent, 5);
  assert.equal((await readQuota('opencode')).status, 'unavailable');
});

test('native invocations use argument arrays and resume exact sessions', () => {
  const prompt = 'Do not execute $(touch /tmp/evil); `commands` & quotes " remain text';
  for (const harness of HARNESS_IDS) {
    const command = buildInvocation(harness, { model: { id: 'reported/model' }, prompt, cwd: '/project with spaces', sessionId: 'exact-session' });
    assert.ok(Array.isArray(command.args));
    assert.ok(command.args.includes('exact-session'));
    assert.equal(command.cwd, '/project with spaces');
    assert.equal(command.input || command.args.at(-1), harness === 'antigravity' ? 'exact-session' : prompt);
    if (harness !== 'codex') assert.ok(command.args.includes(prompt));
    assert.ok(!command.args.includes('--dangerously-skip-permissions'));
  }
  assert.ok(!buildInvocation('cursor', { model: 'reported', prompt }).args.includes('--force'));
  assert.ok(buildInvocation('cursor', { model: 'reported', prompt, force: true }).args.includes('--force'));
  assert.throws(() => buildInvocation('codex', { model: { id: 'reported', efforts: ['low'] }, effort: 'high', prompt }), /Esforço/);
});

test('notifications only invoke configured native channel when enabled', async () => {
  let count = 0;
  const notify = async (event) => { count += 1; assert.equal(event.type, 'completed'); };
  await notifyNative('opencode', { type: 'completed' }, { notify });
  assert.equal(count, 0);
  assert.equal((await notifyNative('opencode', { type: 'completed' }, { enabled: true, notify })).delivered, true);
  assert.equal(count, 1);
  let event;
  await notifyNative('codex', { type: 'completed' }, { enabled: true, notifyCommand: ['native', 'notify'], run: async (_command, _args, options) => { event = JSON.parse(options.input); return { code: 0 }; } });
  assert.equal(event.harness, 'codex');
});

function fakeProtocol(onRequest) {
  const requests = [];
  let killed = false;
  return {
    requests,
    get killed() { return killed; },
    spawn(_command, _args, options) {
      assert.equal(options.shell, false);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => { killed = true; queueMicrotask(() => child.emit('close', 0)); };
      child.stdin.on('data', (chunk) => {
        for (const line of String(chunk).trim().split('\n')) {
          const request = JSON.parse(line);
          requests.push(request);
          queueMicrotask(() => {
            const response = onRequest(request);
            if (response) child.stdout.write(`${JSON.stringify(response)}\n`);
          });
        }
      });
      return child;
    },
  };
}

test('Codex discovery performs initialize handshake, no thread or inference', async () => {
  const fake = fakeProtocol((request) => request.id === 0 ? { id: 0, result: { userAgent: 'codex' } } : request.id === 1 ? { id: 1, result: { data: [{ model: 'from-native' }] } } : null);
  const result = await readCodex('model/list', {}, { spawn: fake.spawn });
  assert.equal(result.data[0].model, 'from-native');
  assert.deepEqual(fake.requests.map((r) => r.method), ['initialize', 'initialized', 'model/list']);
  assert.equal(fake.killed, true);
});

test('Claude discovery sends only initialize control request, no billable prompt', async () => {
  const fake = fakeProtocol((request) => ({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: { models: [{ value: 'fresh-model', supportedEffortLevels: ['low'] }] } } }));
  const models = await readClaudeModels({ spawn: fake.spawn });
  assert.equal(models[0].value, 'fresh-model');
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].request.subtype, 'initialize');
  assert.equal(fake.killed, true);
});

test('native command passes stdin and shell metacharacters literally', async () => {
  const arg = '$(false); `false` & "quote"';
  const result = await runNativeCommand(process.execPath, ['-e', 'process.stdin.on("data", data => process.stdout.write(JSON.stringify([process.argv[1], String(data)])))', arg], { input: 'hello' });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), [arg, 'hello']);
});

test('argv executable overrides work across platforms and Cursor fallback remains executable', async () => {
  const invocation = buildInvocation('opencode', { command: [process.execPath, '/with spaces/cli.mjs'], model: 'vendor/model', prompt: 'task' });
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.args[0], '/with spaces/cli.mjs');
  assert.equal(invocation.args[1], 'run');
  const catalog = await discoverModels('cursor', { run: async (command) => {
    if (command === 'agent') throw Object.assign(new Error('not installed'), { code: 'ENOENT' });
    assert.equal(command, 'cursor-agent');
    return { code: 0, stdout: 'new-model - New Model' };
  } });
  assert.equal(catalog.command, 'cursor-agent');
  assert.equal(buildInvocation('cursor', { command: catalog.command, model: selectModel(catalog), prompt: 'task' }).command, 'cursor-agent');
});

test('Windows npm launchers resolve to literal Node argv without evaluating batch code', () => {
  const script = 'C:\\Users\\Test User\\npm\\node_modules\\tool\\bin\\cli.js';
  const launcher = 'C:\\Users\\Test User\\npm\\native.cmd';
  const options = {
    platform: 'win32', cwd: 'C:\\project', node: 'C:\\Node\\node.exe',
    env: { Path: 'C:\\Users\\Test User\\npm;C:\\Windows' },
    exists: (file) => [launcher, script].includes(file),
    read: () => '@ECHO off\r\nendLocal & "%_prog%" "%dp0%\\node_modules\\tool\\bin\\cli.js" %*\r\n',
  };
  const resolved = resolveNativeInvocation('native', ['--model', 'literal & value'], options);
  assert.equal(resolved.command, 'C:\\Node\\node.exe');
  assert.deepEqual(resolved.args, [script, '--model', 'literal & value']);
  assert.throws(() => resolveNativeInvocation(launcher, [], { ...options, read: () => 'powershell arbitrary code' }), /não reconhecido/);
  assert.deepEqual(resolveNativeInvocation('native', ['x'], { platform: 'linux' }), { command: 'native', args: ['x'] });
});
