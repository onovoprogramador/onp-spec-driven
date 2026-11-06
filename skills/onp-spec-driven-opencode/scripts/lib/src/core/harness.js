// Native, read-only discovery. No model names, private account endpoints or UI servers.
// Sources: learn.chatgpt.com/docs/app-server; code.claude.com/docs/en/agent-sdk/typescript;
// cursor.com/docs/cli/reference/parameters; opencode.ai/docs/cli;
// antigravity.google/docs/cli/headless; provider statusline docs describe quota bridges.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeQuota, quotaTimestamp } from './quota.js';

export const HARNESS_IDS = ['claude', 'codex', 'cursor', 'antigravity', 'opencode'];
export const HARNESS_CAPABILITIES = {
  claude: { command: 'claude', models: 'initialize.models', quota: 'native-statusline-or-bridge', questions: 'AskUserQuestion', progress: 'TaskCreate/TaskUpdate', notifications: 'configured hooks or native PushNotification', timers: 'CronCreate/ScheduleWakeup when exposed' },
  codex: { command: 'codex', models: 'model/list', quota: 'account/rateLimits/read', questions: 'request_user_input_async/request_user_input when exposed', progress: 'native plan/agent events', notifications: 'configured native notifications/notify', timers: 'native scheduler when exposed' },
  cursor: { command: 'agent', models: '--list-models', quota: 'native-account-or-provider-bridge', questions: 'native question tool when exposed', progress: 'native todos/subagents', notifications: 'configured native hooks', timers: 'native automations when exposed' },
  antigravity: { command: 'agy', models: 'models', quota: 'native /usage or statusline bridge', questions: 'native user-input tool when exposed', progress: 'native tasks/artifacts', notifications: 'notifications setting', timers: 'native scheduled tasks when exposed' },
  opencode: { command: 'opencode', models: 'models --refresh', quota: 'provider-bridge', questions: 'question', progress: 'todowrite/task', notifications: 'native session events / TUI toast bridge', timers: 'installed native scheduler when exposed' },
};

function assertHarness(harness) {
  if (!HARNESS_IDS.includes(harness)) throw new Error(`Harness desconhecido: ${harness}`);
}

function executable(command, args = []) {
  const parts = Array.isArray(command) ? command : [command];
  if (!parts.length || parts.some((part) => typeof part !== 'string' || !part || part.includes('\0'))) throw new Error('Executável inválido; use caminho ou [executável, ...argumentos]');
  return { command: parts[0], args: [...parts.slice(1), ...args] };
}

/** Node cannot spawn npm .cmd launchers with shell:false on Windows. Resolve only
 * their documented node-script shape; arbitrary batch code is never evaluated. */
export function resolveNativeInvocation(command, args = [], {
  platform = process.platform, env = process.env, cwd = process.cwd(),
  exists = existsSync, read = (file) => readFileSync(file, 'utf8'), node = process.execPath,
} = {}) {
  const invocation = executable(command, args);
  if (platform !== 'win32') return invocation;
  const win = path.win32;
  let resolved = invocation.command;
  if (!/[\\/]/.test(resolved)) {
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
    const directories = (env[pathKey] || '').split(';').filter(Boolean);
    const names = win.extname(resolved) ? [resolved] : [resolved + '.exe', resolved + '.com', resolved + '.cmd', resolved + '.bat', resolved];
    const found = directories.flatMap((dir) => names.map((name) => win.join(dir.replace(/^"|"$/g, ''), name))).find(exists);
    if (found) resolved = found;
  } else resolved = win.resolve(cwd, resolved);
  if (!/\.(?:cmd|bat)$/i.test(resolved)) return { ...invocation, command: resolved };
  const content = read(resolved);
  const match = content.match(/"(?:%_prog%|%dp0%\\node\.exe|%~dp0\\?node\.exe|node(?:\.exe)?)"\s+"(?:%dp0%|%~dp0)[\\/]([^"\r\n]+\.(?:c|m)?js)"\s+%\*/i)
    || content.match(/(?:^|\r?\n)@?node(?:\.exe)?\s+"(?:%dp0%|%~dp0)[\\/]([^"\r\n]+\.(?:c|m)?js)"\s+%\*/i);
  if (!match) throw new Error(`Launcher Windows não reconhecido: ${resolved}. Use o binário nativo .exe ou command: [node, caminho-do-cli.js].`);
  const script = win.resolve(win.dirname(resolved), match[1]);
  if (!exists(script)) throw new Error(`Script do launcher Windows não existe: ${script}`);
  return { command: node, args: [script, ...invocation.args] };
}

export function runNativeCommand(command, args = [], {
  cwd, env, input, signal, timeoutMs = 15_000, maxOutputBytes = 4 * 1024 * 1024,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      const resolved = resolveNativeInvocation(command, args, { cwd, env: env ? { ...process.env, ...env } : process.env });
      child = spawn(resolved.command, resolved.args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, signal });
    }
    catch (error) { reject(error); return; }
    let settled = false;
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(error); }
      else resolve(result);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error(`Tempo esgotado consultando ${command}`), { code: 'ETIMEDOUT' })), timeoutMs);
    for (const [stream, field] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.setEncoding('utf8');
      stream.on('data', (text) => {
        bytes += Buffer.byteLength(text);
        if (bytes > maxOutputBytes) return finish(new Error(`Resposta excessiva de ${command}`));
        if (field === 'stdout') stdout += text;
        else stderr += text;
      });
    }
    child.on('error', (error) => finish(error));
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') finish(error); });
    child.on('close', (code) => finish(null, { code, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

// A tiny line protocol reader with a deadline; no model turn is started.
function readProtocol(command, args, { initial, onMessage, ...options }) {
  return new Promise((resolve, reject) => {
    const resolved = resolveNativeInvocation(command, args, options);
    const child = (options.spawn || spawn)(resolved.command, resolved.args, {
      cwd: options.cwd, env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, signal: options.signal,
    });
    let settled = false;
    let buffer = '';
    let bytes = 0;
    const decoder = new StringDecoder('utf8');
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`Tempo esgotado no protocolo de ${command}`)), options.timeoutMs ?? 15_000);
    const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > (options.maxOutputBytes ?? 4 * 1024 * 1024)) return finish(new Error('Resposta de descoberta excessiva'));
      buffer += decoder.write(chunk);
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        try { onMessage(message, send, finish); } catch (error) { finish(error); }
        if (settled) break;
      }
    });
    child.stderr.resume(); // Never echo account data or credentials from a discovery failure.
    child.on('error', (error) => finish(error));
    child.stdin.on('error', (error) => { if (!settled) finish(error); });
    child.on('close', () => { if (!settled) finish(new Error(`${command} encerrou sem responder à descoberta`)); });
    send(initial);
  });
}

export function readCodex(method, params = {}, options = {}) {
  if (!['model/list', 'account/rateLimits/read'].includes(method)) throw new Error('Somente consultas de modelos/cota são permitidas');
  const invocation = executable(options.command || 'codex', ['app-server']);
  return readProtocol(invocation.command, invocation.args, {
    ...options,
    initial: { id: 0, method: 'initialize', params: { clientInfo: { name: 'onp_spec', title: 'ONP Spec', version: '1.0.0' } } },
    onMessage(message, send, finish) {
      if (message.id !== 0 && message.id !== 1) return;
      if (message.error) return finish(new Error(`Codex ${method}: ${message.error.message || 'consulta recusada'}`));
      if (message.id === 0) {
        send({ method: 'initialized' });
        send({ id: 1, method, params });
      } else finish(null, message.result);
    },
  });
}

export function readClaudeModels(options = {}) {
  const invocation = executable(options.command || 'claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
  return readProtocol(invocation.command, invocation.args, {
    ...options,
    initial: { type: 'control_request', request_id: 'onp-models', request: { subtype: 'initialize' } },
    onMessage(message, _send, finish) {
      if (message.type !== 'control_response' || message.response?.request_id !== 'onp-models') return;
      const response = message.response;
      if (response.subtype === 'error') return finish(new Error(`Claude recusou descoberta: ${response.error || 'erro de controle'}`));
      finish(null, response.response?.models);
    },
  });
}

const cleanAnsi = (value) => String(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
function parseModelRows(raw, harness) {
  if (typeof raw === 'string') {
    const text = cleanAnsi(raw).trim();
    try { return parseModelRows(JSON.parse(text), harness); } catch { /* CLI text output */ }
    return text.split(/\r?\n/).flatMap((line) => {
      const row = line.trim().replace(/^[*●◉›>]\s*/, '');
      const match = row.match(/^([a-zA-Z0-9][a-zA-Z0-9_./:+-]*)(?:\s{2,}|\s+-\s+|\s+\(|$)(.*)$/);
      if (!match || (harness === 'opencode' && !match[1].includes('/'))) return [];
      // Ignore headings without baking any model family or alias into the adapter.
      if (/^(?:available|models?|id|name|loading|tip|warning|error)$/i.test(match[1])) return [];
      return [{ id: match[1], displayName: match[2].replace(/\s*\((?:default|current)\)/gi, '').trim() || match[1], isDefault: /\(default\)|\[default\]/i.test(row) }];
    });
  }
  if (Array.isArray(raw)) return raw;
  return raw?.models || raw?.data || [];
}

function modelRows(raw, harness) {
  const seen = new Set();
  return parseModelRows(raw, harness).flatMap((item) => {
    if (typeof item === 'string') item = { id: item };
    const id = item.model || item.id || item.value;
    if (typeof id !== 'string' || !id || seen.has(id) || item.hidden || item.available === false) return [];
    seen.add(id);
    const efforts = (item.supportedReasoningEfforts || item.supportedEffortLevels || item.efforts || [])
      .map((value) => typeof value === 'string' ? value : value.reasoningEffort).filter((value) => typeof value === 'string');
    return [{
      id, name: item.displayName || item.name || id, isDefault: item.isDefault === true,
      efforts, defaultEffort: item.defaultReasoningEffort || item.defaultEffort || null,
      ...(item.rateLimitId ? { rateLimitId: item.rateLimitId } : {}),
    }];
  });
}

async function commandBridge(command, payload, options) {
  if (!Array.isArray(command) || !command.length || command.some((part) => typeof part !== 'string' || part.includes('\0'))) throw new Error('Bridge deve ser um array [executável, ...argumentos]');
  const result = await (options.run || runNativeCommand)(command[0], command.slice(1), { ...options, input: `${JSON.stringify(payload)}\n` });
  if ((result.code ?? result.exitCode ?? 0) !== 0) throw new Error('Bridge nativo retornou erro');
  return JSON.parse(result.stdout);
}

export async function discoverModels(harness, options = {}) {
  assertHarness(harness);
  const now = (options.now || Date.now)();
  let source = HARNESS_CAPABILITIES[harness].models;
  let resolvedCommand = options.command || HARNESS_CAPABILITIES[harness].command;
  try {
    let raw;
    if (options.modelProbe) { raw = await options.modelProbe({ harness }); source = 'native-tool'; }
    else if (options.modelsCommand) { raw = await commandBridge(options.modelsCommand, { action: 'models', harness }, options); source = 'configured-native-bridge'; }
    else if (harness === 'codex') {
      raw = [];
      const seen = new Set();
      let cursor;
      do {
        const response = await (options.rpc || readCodex)('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }, options);
        if (!Array.isArray(response?.data)) throw new Error('Catálogo nativo inválido');
        raw.push(...response.data);
        cursor = response.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error('Cursor de catálogo repetido');
        if (cursor) seen.add(cursor);
        if (seen.size > 100) throw new Error('Catálogo excedeu limite de paginação');
      } while (cursor);
    } else if (harness === 'claude') raw = await (options.claudeModels || readClaudeModels)(options);
    else {
      const command = resolvedCommand;
      const args = harness === 'cursor' ? ['--list-models'] : harness === 'opencode' ? ['models', '--refresh'] : ['models'];
      let result;
      const invocation = executable(command, args);
      try { result = await (options.run || runNativeCommand)(invocation.command, invocation.args, options); }
      catch (error) {
        if (harness !== 'cursor' || options.command || error.code !== 'ENOENT') throw error;
        resolvedCommand = 'cursor-agent';
        result = await (options.run || runNativeCommand)('cursor-agent', args, options);
      }
      if ((result.code ?? result.exitCode ?? 0) !== 0) throw new Error(`${command} não retornou o catálogo de modelos`);
      raw = result.stdout;
    }
    if (raw?.harness && raw.harness !== harness) throw new Error('O catálogo pertence a outro harness');
    const models = modelRows(raw, harness);
    if (!models.length) throw new Error('O harness não retornou nenhum modelo disponível');
    return { harness, status: 'available', models, observedAt: new Date(now).toISOString(), source, command: resolvedCommand };
  } catch (error) {
    return { harness, status: 'unavailable', models: [], observedAt: new Date(now).toISOString(), source, reason: error.message };
  }
}

export function selectModel(catalog, requested) {
  if (catalog?.status !== 'available' || !catalog.models?.length) throw new Error(`Não foi possível validar os modelos: ${catalog?.reason || 'catálogo indisponível'}`);
  const selected = requested && requested !== 'default'
    ? catalog.models.find((model) => model.id === requested)
    : catalog.models.find((model) => model.isDefault) || catalog.models[0];
  if (!selected) throw new Error(`Modelo "${requested}" não está disponível no ${catalog.harness}; escolha um modelo do catálogo nativo.`);
  return selected;
}

export async function readQuota(harness, options = {}) {
  assertHarness(harness);
  const now = (options.now || Date.now)();
  let source = HARNESS_CAPABILITIES[harness].quota;
  try {
    let raw;
    if (options.quotaProbe) { raw = await options.quotaProbe({ harness, model: options.model, accountId: options.accountId }); source = 'native-tool'; }
    else if (options.quotaCommand) {
      raw = await commandBridge(options.quotaCommand, { action: 'quota', harness, model: options.model, accountId: options.accountId }, options);
      source = 'configured-native-bridge';
      if (raw?.harness !== harness || !raw?.observedAt) throw new Error('Bridge de cota deve informar harness e observedAt da leitura nativa');
    } else if (harness === 'codex') raw = await (options.rpc || readCodex)('account/rateLimits/read', {}, options);
    else return normalizeQuota({ status: 'unavailable', reason: `Cota não exposta por comando JSON de ${harness}; conecte a leitura nativa com quotaCommand/quotaProbe.` }, { harness, source, now });
    if (raw?.harness && raw.harness !== harness) throw new Error('A cota pertence a outro harness');
    if (raw?.observedAt !== undefined && !quotaTimestamp(raw.observedAt)) throw new Error('A leitura da cota tem observedAt inválido');
    if (options.accountId && raw?.accountId !== options.accountId) throw new Error('A cota pertence a outra conta ou não identifica a conta esperada');
    return normalizeQuota(raw, { harness, source, now, rateLimitId: options.rateLimitId });
  } catch (error) {
    return normalizeQuota({ status: 'unavailable', reason: error.message }, { harness, source, now });
  }
}

export function buildInvocation(harness, {
  model, prompt, cwd, effort, sessionId, command, sandbox = 'workspace-write',
  permissionMode = 'acceptEdits', allowedTools, addDirs = [], force = false,
} = {}) {
  assertHarness(harness);
  const info = typeof model === 'string' ? { id: model } : model;
  if (!info?.id) throw new Error('Escolha um modelo descoberto no harness antes de executar');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt obrigatório');
  if (effort && info.efforts?.length && !info.efforts.includes(effort)) throw new Error(`Esforço ${effort} não disponível para ${info.id}`);
  let args;
  if (harness === 'codex') {
    args = ['exec', ...(sessionId ? ['resume', sessionId] : []), '--json', '--model', info.id];
    if (!sessionId) { args.push('--sandbox', sandbox); for (const dir of addDirs) args.push('--add-dir', dir); }
    if (effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(effort)}`);
    args.push('-');
  } else if (harness === 'claude') {
    args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', info.id, '--permission-mode', permissionMode];
    if (effort) args.push('--effort', effort);
    if (allowedTools) args.push('--allowedTools', Array.isArray(allowedTools) ? allowedTools.join(',') : allowedTools);
    for (const dir of addDirs) args.push('--add-dir', dir);
    if (sessionId) args.push('--resume', sessionId);
    args.push('--', prompt);
  } else if (harness === 'cursor') {
    args = ['-p', '--output-format', 'stream-json', '--model', info.id];
    if (force) args.push('--force');
    if (sessionId) args.push('--resume', sessionId);
    args.push('--', prompt);
  } else if (harness === 'antigravity') {
    args = ['-p', prompt, '--output-format', 'stream-json', '--model', info.id];
    if (effort) {
      if (!['low', 'medium', 'high'].includes(effort)) throw new Error('Antigravity aceita esforço low, medium ou high');
      args.push('--effort', effort);
    }
    if (sessionId) args.push('--conversation', sessionId);
  } else {
    args = ['run', '--format', 'json', '--model', info.id];
    if (sessionId) args.push('--session', sessionId);
    args.push('--', prompt);
  }
  return { ...resolveNativeInvocation(command || HARNESS_CAPABILITIES[harness].command, args, { cwd }), cwd, ...(harness === 'codex' ? { input: prompt } : {}) };
}

export async function notifyNative(harness, event, options = {}) {
  assertHarness(harness);
  if (options.enabled !== true) return { delivered: false, reason: 'disabled' };
  if (typeof options.notify === 'function') {
    await options.notify({ harness, ...event });
    return { delivered: true, source: 'native-tool' };
  }
  if (options.notifyCommand) {
    // Notification bridges need not return JSON; only their exit status is meaningful.
    const command = options.notifyCommand;
    if (!Array.isArray(command) || !command.length || command.some((value) => typeof value !== 'string' || value.includes('\0'))) throw new Error('notifyCommand deve ser [executável, ...argumentos]');
    const result = await (options.run || runNativeCommand)(command[0], command.slice(1), { ...options, input: `${JSON.stringify({ harness, ...event })}\n` });
    if ((result.code ?? result.exitCode ?? 0) !== 0) throw new Error('Notificação nativa falhou');
    return { delivered: true, source: 'configured-native-bridge' };
  }
  // Most harnesses already notify on native task completion. Do not create OS/UI substitutes.
  return { delivered: false, reason: 'native-harness-handles-completion-or-bridge-required' };
}
