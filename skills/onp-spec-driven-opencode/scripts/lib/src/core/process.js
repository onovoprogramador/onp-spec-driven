// Cancellation is scoped to the child we created and its detached process group.
// Resolving this promise proves that child's stdio has closed, not merely that a
// signal was sent. Callers must retain their own close handler for exit status.
import { spawn } from 'node:child_process';

const cancellations = new WeakMap();

export function stopProcessTree(child, {
  forceAfterMs = 5000, platform = process.platform,
  kill = process.kill.bind(process), spawnCommand = spawn,
} = {}) {
  if (!child || typeof child.once !== 'function') throw new TypeError('Processo filho inválido');
  if (!Number.isFinite(forceAfterMs) || forceAfterMs < 0) throw new TypeError('forceAfterMs inválido');
  if (cancellations.has(child)) return cancellations.get(child);
  if (child.pid === process.pid || (child.pid !== undefined && (!Number.isInteger(child.pid) || child.pid <= 1))) throw new Error('PID não identifica um processo filho seguro');

  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  cancellations.set(child, promise);
  let forced = false;
  let closed = false;
  let timer;
  let failure = null;
  let closedResult;
  const helpers = new Set();
  const finishClosed = () => {
    if (closed && !helpers.size && !failure) resolve(closedResult);
  };
  const fail = (error) => {
    failure ||= error;
    // Do not claim termination on EPERM or a missing taskkill. The caller still
    // observes close separately and must not start a replacement execution.
    reject(error);
  };
  const signalGroup = (signal) => {
    if (!child.pid) return; // Failed spawn still emits close; no process to kill.
    try { kill(-child.pid, signal); }
    catch (error) {
      if (error.code !== 'ESRCH') fail(error);
      // ESRCH means that this owned group is already gone. Never fall back to
      // signaling the current group or an unrelated individual process.
    }
  };
  const taskkill = (force) => {
    if (!child.pid) return;
    let helper;
    try {
      helper = spawnCommand('taskkill', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], {
        shell: false, windowsHide: true, stdio: 'ignore',
      });
    } catch (error) { fail(error); return; }
    helpers.add(helper);
    helper.once('error', (error) => { helpers.delete(helper); fail(error); });
    helper.once('close', (code) => {
      helpers.delete(helper);
      // During graceful cancellation some console programs need /F. A failed
      // forced taskkill is actionable; target-close remains the only success.
      if ((force || (closed && !forced)) && code !== 0) fail(new Error(`taskkill /T${force ? ' /F' : ''} falhou (exit ${code}) para PID ${child.pid}`));
      finishClosed();
    });
  };
  const onClose = (code, signal) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    // A child may close while a grandchild redirected its stdio elsewhere.
    // Finish cancelling that same owned group rather than orphaning the tool.
    if (platform !== 'win32' && child.pid && !forced) {
      try { kill(-child.pid, 0); forced = true; signalGroup('SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') fail(error); }
    }
    // Do not kill taskkill when the parent closes: it may still be traversing
    // descendants. Its completion and target-close are both required on Windows.
    child.removeListener('error', onError);
    closedResult = { code, signal, forced };
    finishClosed();
  };
  const onError = () => { /* Failed spawn is followed by close; do not resolve early. */ };
  child.once('close', onClose);
  child.on('error', onError);

  // Calling after close is harmless. Exit alone is insufficient: inherited
  // stdout/stderr can still be held open by a descendant.
  const pipesClosed = !child.stdio?.some((stream) => stream && !stream.destroyed && !stream.closed);
  if ((child.exitCode != null || child.signalCode != null) && pipesClosed) {
    onClose(child.exitCode, child.signalCode);
    child.removeListener('close', onClose);
    return promise;
  }
  timer = setTimeout(() => {
    if (closed) return;
    forced = true;
    if (platform === 'win32') taskkill(true);
    else signalGroup('SIGKILL');
  }, forceAfterMs);
  if (platform === 'win32') taskkill(false);
  else signalGroup('SIGTERM');
  return promise;
}
