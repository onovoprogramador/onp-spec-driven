import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { stopProcessTree } from '../src/core/process.js';

test('cancels a real child and its SIGTERM-resistant tool, awaiting pipe close', { timeout: 10_000 }, async (t) => {
  const grandchildCode = `process.on('SIGTERM', () => {}); console.log(JSON.stringify({grandchild:process.pid})); setInterval(() => {}, 1000);`;
  const parentCode = `const {spawn}=require('node:child_process'); process.on('SIGTERM',()=>{}); spawn(process.execPath,['-e',${JSON.stringify(grandchildCode)}],{stdio:['ignore','inherit','inherit']}); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', parentCode], { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let grandchild;
  t.after(async () => {
    await stopProcessTree(child, { forceAfterMs: 20 }).catch(() => {});
    if (grandchild) { try { process.kill(grandchild, 'SIGKILL'); } catch {} }
  });
  const [output] = await once(child.stdout, 'data');
  grandchild = JSON.parse(String(output)).grandchild;
  let closed = false;
  child.once('close', () => { closed = true; });
  const cancellation = stopProcessTree(child, { forceAfterMs: 80 });
  assert.equal(stopProcessTree(child, { forceAfterMs: 1 }), cancellation, 'repeated cancellation shares the same wait');
  const result = await cancellation;
  assert.equal(closed, true);
  if (process.platform !== 'win32') assert.equal(result.forced, true);
  let exists = true;
  for (let attempt = 0; attempt < 100 && exists; attempt++) {
    try { process.kill(grandchild, 0); await delay(10); }
    catch (error) { assert.equal(error.code, 'ESRCH'); exists = false; }
  }
  assert.equal(exists, false, 'the spawned tool must not survive cancellation');
});

test('graceful close clears the escalation timer and does not signal again later', async () => {
  const child = new EventEmitter();
  child.pid = 987654;
  const calls = [];
  const cancellation = stopProcessTree(child, { platform: 'linux', forceAfterMs: 30, kill: (pid, signal) => {
    calls.push([pid, signal]);
    if (signal === 0) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  } });
  assert.deepEqual(calls, [[-987654, 'SIGTERM']]);
  child.emit('exit', 0, null);
  let resolved = false;
  cancellation.then(() => { resolved = true; });
  await delay(1);
  assert.equal(resolved, false, 'exit alone does not prove pipes closed');
  child.emit('close', 0, null);
  assert.equal((await cancellation).forced, false);
  await delay(60);
  assert.deepEqual(calls, [[-987654, 'SIGTERM'], [-987654, 0]]);
});

test('parent close also cancels an owned tool that redirected its pipes', async () => {
  const child = new EventEmitter(); child.pid = 987651;
  const calls = [];
  const result = stopProcessTree(child, { platform: 'linux', forceAfterMs: 1000, kill: (pid, signal) => calls.push([pid, signal]) });
  child.emit('close', 0, null);
  assert.equal((await result).forced, true);
  assert.deepEqual(calls, [[-987651, 'SIGTERM'], [-987651, 0], [-987651, 'SIGKILL']]);
});

test('Windows uses literal taskkill argv, escalates once and awaits target close', async () => {
  const child = new EventEmitter();
  child.pid = 987653;
  const calls = [];
  const helpers = [];
  const cancellation = stopProcessTree(child, { platform: 'win32', forceAfterMs: 5, spawnCommand: (command, args, options) => {
    calls.push({ command, args, options });
    const helper = new EventEmitter();
    helper.kill = () => helper.emit('close', 0);
    helpers.push(helper);
    return helper;
  } });
  await delay(15);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ['/PID', '987653', '/T']);
  assert.deepEqual(calls[1].args, ['/PID', '987653', '/T', '/F']);
  assert.ok(calls.every((call) => call.command === 'taskkill' && call.options.shell === false && call.options.windowsHide));
  helpers[0].emit('close', 0);
  let resolved = false;
  cancellation.then(() => { resolved = true; });
  await delay(1);
  assert.equal(resolved, false);
  child.emit('close', null, 'SIGTERM');
  await delay(1);
  assert.equal(resolved, false, 'taskkill may still be cancelling descendants after target-close');
  helpers[1].emit('close', 0);
  assert.equal((await cancellation).forced, true);
});

test('never signals the orchestrator PID and surfaces failure without claiming closure', async () => {
  const unsafe = new EventEmitter(); unsafe.pid = process.pid;
  assert.throws(() => stopProcessTree(unsafe), /seguro/);
  const child = new EventEmitter(); child.pid = 987652;
  const promise = stopProcessTree(child, { platform: 'linux', forceAfterMs: 20, kill: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } });
  await assert.rejects(promise, { code: 'EPERM' });
  child.emit('close', 1, null);
});
