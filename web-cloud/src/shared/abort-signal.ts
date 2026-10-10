type AnySignal = (signals: AbortSignal[]) => AbortSignal;

/**
 * Combines a caller signal with a timeout. Safari/iOS WebKit before 17.4 lacks
 * `AbortSignal.any` (Chrome/Firefox on iPhone share that engine), so fall back
 * to a manual controller instead of throwing before the request starts.
 */
export function signalWithTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  const native = (AbortSignal as unknown as { any?: AnySignal }).any;
  if (typeof native === 'function' && typeof AbortSignal.timeout === 'function') {
    return native.call(AbortSignal, [signal, AbortSignal.timeout(timeoutMs)]);
  }
  const controller = new AbortController();
  const abort = (reason: unknown) => {
    if (controller.signal.aborted) return;
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    controller.abort(reason);
  };
  const onAbort = () => abort(signal.reason);
  const timer = setTimeout(() => abort(timeoutReason()), timeoutMs);
  if (signal.aborted) abort(signal.reason);
  else signal.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

function timeoutReason(): unknown {
  try { return new DOMException('The operation timed out.', 'TimeoutError'); }
  catch { return new Error('The operation timed out.'); }
}
