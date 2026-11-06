// Scheduling consumes account quota, never context-window/token usage estimates.
// Provider timestamps are absolute UTC; callers persist decisions before sleeping.
import { setTimeout as delay } from 'node:timers/promises';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const percent = (value) => finite(value) ? Math.max(0, Math.min(100, value)) : null;

export function quotaTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = finite(value) ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}

export function normalizeQuota(raw, { harness, source = 'native', now = Date.now(), rateLimitId } = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const payload = raw.result || raw.params || raw;
  const windows = [];
  const add = (id, data) => {
    if (!data || typeof data !== 'object' || data.disabled === true) return;
    let remaining = percent(data.remainingPercent);
    if (remaining === null && finite(data.usedPercent)) remaining = percent(100 - data.usedPercent);
    if (remaining === null && finite(data.used_percentage)) remaining = percent(100 - data.used_percentage);
    if (remaining === null && finite(data.remaining_fraction)) remaining = percent(data.remaining_fraction * 100);
    if (remaining === null && finite(data.remaining) && finite(data.limit) && data.limit > 0) remaining = percent(100 * data.remaining / data.limit);
    // An absolute balance without its limit cannot be converted to a percentage.
    const blocked = data.blocked === true || data.status === 'rejected' || data.status === 'rate_limited' || data.remaining_amount === 0;
    const resetAt = quotaTimestamp(data.resetAt ?? data.resetsAt ?? data.resets_at ?? data.reset_time)
      || (finite(data.reset_in_seconds) && data.reset_in_seconds >= 0 ? quotaTimestamp(now + data.reset_in_seconds * 1000) : null);
    windows.push({ id: String(id), remainingPercent: remaining, resetAt, blocked });
  };
  if (Array.isArray(payload.windows)) {
    for (const [index, window] of payload.windows.entries()) add(window?.id ?? index, window);
  } else if (payload.rateLimits || payload.rateLimitsByLimitId) {
    // Do not stop one model because an unrelated account bucket is exhausted.
    const bucket = rateLimitId ? payload.rateLimitsByLimitId?.[rateLimitId] : payload.rateLimits;
    if (bucket) {
      const prefix = bucket.limitId || rateLimitId || 'account';
      add(`${prefix}:primary`, bucket.primary);
      add(`${prefix}:secondary`, bucket.secondary);
      if (bucket.rateLimitReachedType) add(`${prefix}:reached`, { blocked: true });
    }
  } else if (payload.rate_limits) {
    for (const [id, window] of Object.entries(payload.rate_limits)) add(id, window);
  } else if (payload.quota) {
    for (const [id, window] of Object.entries(payload.quota)) {
      if (!rateLimitId || id === rateLimitId) add(id, window);
    }
  } else if (payload.rate_limit_info) {
    add(payload.rate_limit_info.rateLimitType || 'account', payload.rate_limit_info);
  } else {
    add('account', payload);
  }
  const meaningful = windows.filter((window) => window.remainingPercent !== null || window.blocked);
  const observedAt = quotaTimestamp(raw.observedAt ?? payload.observedAt) || new Date(now).toISOString();
  return {
    harness: harness || raw.harness || null,
    status: raw.status === 'unavailable' || !meaningful.length ? 'unavailable' : 'available',
    observedAt,
    source: raw.source || source,
    windows,
    ...(raw.accountId ? { accountId: raw.accountId } : {}),
    ...(!meaningful.length || raw.reason ? { reason: raw.reason || 'O harness não informou percentual de cota restante.' } : {}),
  };
}

export function quotaDecision(snapshot, {
  thresholdPercent = 5, now = Date.now(), attempt = 0,
  maxAgeMs = 120_000, minDelayMs = 1_000, baseDelayMs = 60_000, maxDelayMs = 15 * 60_000,
} = {}) {
  if (!finite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) throw new Error('thresholdPercent inválido');
  const backoff = Math.max(minDelayMs, Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(Math.max(0, attempt), 20))));
  const unknown = (reason) => ({ action: 'unknown', reason, delayMs: backoff, wakeAt: new Date(now + backoff).toISOString(), remainingPercent: null });
  if (snapshot?.status !== 'available') return unknown(snapshot?.reason || 'Cota indisponível.');
  const observed = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observed) || observed > now + 5_000 || now - observed > maxAgeMs) return unknown('A leitura da cota expirou; é necessária uma leitura nova.');
  const windows = snapshot.windows || [];
  if (!windows.length) return unknown('Nenhuma janela de cota informada.');
  const numbers = windows.map((window) => window.remainingPercent).filter(finite);
  const remainingPercent = numbers.length ? Math.min(...numbers) : null;
  const blocked = windows.filter((window) => window.blocked || (finite(window.remainingPercent) && window.remainingPercent <= thresholdPercent));
  if (!blocked.length && numbers.length !== windows.length) return unknown('Há janela sem percentual de cota.');
  if (!blocked.length) return { action: 'continue', reason: 'Cota acima da reserva.', delayMs: 0, wakeAt: null, remainingPercent };
  const resets = blocked.map((window) => Date.parse(window.resetAt));
  // Every limiting window must recover. A reset is a time to CHECK, not proof of replenishment.
  const known = resets.every((value) => Number.isFinite(value) && value > now);
  const delayMs = known ? Math.max(minDelayMs, Math.max(...resets) - now + 1_000) : backoff;
  return { action: 'wait', reason: 'Reserva de cota atingida.', delayMs, wakeAt: new Date(now + delayMs).toISOString(), remainingPercent };
}

export async function waitForQuota(read, {
  signal, onWait = async () => {}, onResume = async () => {},
  sleep = (ms, options) => delay(ms, undefined, options), now = Date.now,
  unknownPolicy = 'wait', initialSnapshot, ...options
} = {}) {
  let attempt = 0;
  let waited = false;
  let snapshot = initialSnapshot;
  while (true) {
    signal?.throwIfAborted();
    if (!snapshot) {
      try { snapshot = await read(); }
      catch (error) { snapshot = { status: 'unavailable', reason: error.message }; }
    }
    const decision = quotaDecision(snapshot, { ...options, now: now(), attempt });
    if (decision.action === 'continue') {
      if (waited) await onResume({ snapshot, decision });
      return { snapshot, decision };
    }
    if (decision.action === 'unknown' && unknownPolicy === 'error') {
      const error = new Error(decision.reason);
      error.code = 'QUOTA_UNAVAILABLE';
      throw error;
    }
    // Explicit degradation is only allowed BEFORE a confirmed limit was reached.
    if (decision.action === 'unknown' && unknownPolicy === 'continue' && !waited) return { snapshot, decision };
    waited = true;
    await onWait({ snapshot, decision, attempt });
    const deadline = now() + decision.delayMs;
    // Keep the process responsive and avoid the signed 32-bit setTimeout overflow.
    do {
      signal?.throwIfAborted();
      await sleep(Math.min(60_000, Math.max(1, deadline - now())), { signal });
    } while (now() < deadline);
    snapshot = null;
    attempt += 1;
  }
}

export function classifyRateLimit(event, { harness, now = Date.now() } = {}) {
  if (!event || typeof event !== 'object') return null;
  if (event.event === 'result' && event.result && typeof event.result === 'object') event = { ...event.result, type: 'result' };
  if (event.type === 'rate_limit_event') {
    const info = event.rate_limit_info || {};
    // "allowed" is informational; overageStatus may be rejected even with normal quota available.
    if (info.status !== 'rejected' && !finite(info.usedPercent) && !finite(info.used_percentage)) return null;
    return normalizeQuota(event, { harness, source: 'stream', now });
  }
  if (event.method === 'account/rateLimits/updated') return normalizeQuota(event, { harness, source: 'stream', now });
  const envelope = event.error || event.result?.error || event.properties?.error || event.data?.error || event;
  const error = envelope?.data && typeof envelope.data === 'object' ? { ...envelope, ...envelope.data } : envelope;
  const code = error.code ?? error.type ?? error.name ?? event.code;
  const status = error.statusCode ?? error.status ?? event.statusCode;
  const terminal = event.type === 'error' || event.type === 'turn.failed' || event.type === 'result' || event.type === 'session.error' || event.status === 'ERROR' || event.error;
  const message = typeof error === 'string' ? error : error.message || event.message || (event.is_error ? [event.result, ...(event.errors || [])].filter(Boolean).join(' ') : '');
  if (!terminal) return null;
  const billing = ['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active', 'insufficient_credits', 'payment_required'].includes(code)
    || /(?:billing (?:limit|error)|insufficient (?:credits|balance)|payment required|credit balance.*(?:low|exhausted)|add (?:more )?credits|purchase (?:more )?credits)/i.test(message);
  // Purchased credit exhaustion is not a time-based rate window. Only an explicit
  // provider reset makes it eligible for unattended retry; never purchase/reset here.
  if (billing && !quotaTimestamp(error.resetsAt ?? error.resetAt ?? error.reset_at ?? event.resetsAt)) return null;
  const rateLimited = status === 429 || code === 429 || ['rate_limit_error', 'rate_limit_exceeded', 'usage_limit_reached', 'quota_exceeded', 'insufficient_quota', 'RateLimitError'].includes(code)
    || /(?:rate.?limit (?:reached|exceeded)|usage limit (?:reached|exceeded)|quota (?:exceeded|exhausted)|insufficient[_ ]quota|hit your (?:(?:usage|rate) )?limit)/i.test(message);
  if (!rateLimited) return null;
  let resetAt = quotaTimestamp(error.resetsAt ?? error.resetAt ?? error.reset_at ?? event.resetsAt);
  const retry = error.retryAfter ?? error.retry_after ?? error.retry_after_seconds ?? error.headers?.['retry-after'] ?? error.responseHeaders?.['retry-after'] ?? event.headers?.['retry-after'];
  if (!resetAt && retry !== undefined) {
    const seconds = Number(retry);
    resetAt = Number.isFinite(seconds) && seconds >= 0 ? new Date(now + seconds * 1000).toISOString() : quotaTimestamp(retry);
  }
  return normalizeQuota({ windows: [{ id: 'rate-limit', blocked: true, remainingPercent: 0, resetAt }] }, { harness, source: 'stream', now });
}
