import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuota, quotaDecision, waitForQuota, classifyRateLimit } from '../src/core/quota.js';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const snapshot = (remainingPercent, extra = {}) => normalizeQuota({ remainingPercent, ...extra }, { now: NOW });

test('exactly 5% stops, 5.01% runs, and the later limiting window determines recheck', () => {
  assert.equal(quotaDecision(snapshot(5), { now: NOW }).action, 'wait');
  assert.equal(quotaDecision(snapshot(5.01), { now: NOW }).action, 'continue');
  const quotas = normalizeQuota({ rateLimits: { primary: { usedPercent: 95, resetsAt: NOW / 1000 + 60 }, secondary: { usedPercent: 97, resetsAt: NOW / 1000 + 3600 } } }, { now: NOW });
  const decision = quotaDecision(quotas, { now: NOW });
  assert.equal(decision.remainingPercent, 3);
  assert.equal(decision.delayMs, 3_601_000);
});

test('stale, future-dated, missing telemetry and token counts never mean remaining credit', () => {
  for (const value of [
    { ...snapshot(90), observedAt: new Date(NOW - 180_000).toISOString() },
    { ...snapshot(90), observedAt: new Date(NOW + 180_000).toISOString() },
    normalizeQuota({ context_window: { remaining_percentage: 99 }, usage: { total_tokens: 1 } }, { now: NOW }),
    normalizeQuota({ quota: { account: { remaining_amount: 40 } } }, { now: NOW }),
    normalizeQuota({ windows: [{ id: 'known', remainingPercent: 99 }, { id: 'unknown', remaining_amount: 40 }] }, { now: NOW }),
  ]) assert.equal(quotaDecision(value, { now: NOW }).action, 'unknown');
});

test('normalizes Claude and Antigravity official statusline shapes without confusing context', () => {
  const claude = normalizeQuota({ context_window: { remaining_percentage: 99 }, rate_limits: { five_hour: { used_percentage: 95, resets_at: NOW / 1000 + 60 }, seven_day: { used_percentage: 10 } } }, { harness: 'claude', now: NOW });
  assert.deepEqual(claude.windows.map((w) => w.remainingPercent), [5, 90]);
  const agy = normalizeQuota({ quota: { weekly: { remaining_fraction: 0.04, reset_time: new Date(NOW + 60_000).toISOString() }, disabled: { disabled: true, remaining_fraction: 0 } } }, { harness: 'antigravity', now: NOW });
  assert.equal(agy.windows.length, 1);
  assert.equal(agy.windows[0].remainingPercent, 4);
});

test('Codex model bucket selection does not stop for unrelated exhausted models', () => {
  const raw = { rateLimits: { limitId: 'main', primary: { usedPercent: 10 } }, rateLimitsByLimitId: { main: { primary: { usedPercent: 10 } }, other: { primary: { usedPercent: 100 } } } };
  assert.equal(quotaDecision(normalizeQuota(raw, { now: NOW }), { now: NOW }).action, 'continue');
  assert.equal(quotaDecision(normalizeQuota(raw, { now: NOW, rateLimitId: 'other' }), { now: NOW }).action, 'wait');
  assert.equal(quotaDecision(normalizeQuota(raw, { now: NOW, rateLimitId: 'missing' }), { now: NOW }).action, 'unknown');
});

test('past resets and unknown resets use bounded backoff rather than spinning', () => {
  for (const value of [snapshot(0), snapshot(0, { resetAt: new Date(NOW - 1000).toISOString() })]) {
    assert.equal(quotaDecision(value, { now: NOW }).delayMs, 60_000);
    assert.equal(quotaDecision(value, { now: NOW, attempt: 20 }).delayMs, 900_000);
  }
});

test('overnight scheduler waits through the reset, rechecks and only resumes on fresh replenishment', async () => {
  let clock = NOW;
  let reads = 0;
  let resumed = 0;
  const sleeps = [];
  const waits = [];
  await waitForQuota(async () => {
    reads += 1;
    return normalizeQuota({ remainingPercent: reads < 3 ? 4 : 80, resetAt: reads === 1 ? new Date(clock + 8 * 3600_000).toISOString() : null }, { now: clock });
  }, {
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    onWait: async ({ decision }) => waits.push(decision),
    onResume: async () => { resumed += 1; },
  });
  assert.equal(reads, 3);
  assert.equal(resumed, 1);
  assert.equal(waits.length, 2);
  assert.ok(clock >= NOW + 8 * 3600_000);
  assert.ok(sleeps.every((ms) => ms <= 60_000));
});

test('waiting survives temporary read failure and supports cancellation', async () => {
  let clock = NOW;
  let reads = 0;
  await waitForQuota(async () => {
    reads += 1;
    if (reads === 1) throw new Error('temporary outage');
    return normalizeQuota({ remainingPercent: 90 }, { now: clock });
  }, { now: () => clock, sleep: async (ms) => { clock += ms; } });
  assert.equal(reads, 2);
  const controller = new AbortController();
  await assert.rejects(waitForQuota(async () => snapshot(0), {
    now: () => NOW, signal: controller.signal,
    onWait: async () => controller.abort(),
  }), { name: 'AbortError' });
});

test('rate-limit classifier understands terminal stream errors including exit-zero errors', () => {
  const events = [
    { type: 'turn.failed', error: { code: 'usage_limit_reached', message: 'limit', retry_after_seconds: 30 } },
    { type: 'error', error: { name: 'APIError', data: { statusCode: 429, responseHeaders: { 'retry-after': '30' } } } },
    { type: 'result', is_error: true, result: "You've hit your limit" },
    { status: 'ERROR', error: 'quota exhausted' },
    { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: NOW / 1000 + 30 } },
  ];
  for (const event of events) assert.equal(quotaDecision(classifyRateLimit(event, { now: NOW }), { now: NOW }).action, 'wait');
  assert.equal(classifyRateLimit(events[0], { now: NOW }).windows[0].resetAt, new Date(NOW + 30_000).toISOString());
  assert.equal(classifyRateLimit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', overageStatus: 'rejected' } }), null);
  assert.equal(classifyRateLimit({ type: 'assistant', message: 'quota exhausted' }), null);
  assert.equal(classifyRateLimit({ type: 'error', error: { code: 'authentication_error', message: 'Login required' } }), null);
  assert.equal(classifyRateLimit({ type: 'error', error: { code: 'insufficient_quota', statusCode: 429, message: 'Add credits' } }), null);
  assert.equal(classifyRateLimit({ type: 'error', error: { code: 'quota_exceeded', statusCode: 429, message: 'Insufficient balance' } }), null);
  assert.ok(classifyRateLimit({ type: 'error', error: { code: 'insufficient_quota', resetAt: new Date(NOW + 3600_000).toISOString() } }, { now: NOW }));
});
