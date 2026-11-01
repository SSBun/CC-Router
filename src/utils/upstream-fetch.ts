/**
 * fetch() wrapper for upstream provider calls.
 *
 * - Aborts when response headers have not arrived within `timeoutMs`
 *   (connect phase). The timer does not bound body streaming: long
 *   generations are legal. Use the caller `signal` to bound the whole
 *   exchange, including mid-stream cancellation.
 * - Wires the caller's signal (e.g. the downstream client's request
 *   signal) into the upstream fetch, so a client disconnect cancels the
 *   upstream request and its body instead of streaming it into the void.
 */
export const UPSTREAM_CONNECT_TIMEOUT_MS = 120_000;

export async function upstreamFetch(
  url: string,
  init: RequestInit,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Response> {
  const callerSignal = options.signal;
  if (callerSignal?.aborted) {
    // fetch() rejects immediately on an already-aborted signal.
    return fetch(url, { ...init, signal: callerSignal });
  }

  const timeoutMs = options.timeoutMs ?? UPSTREAM_CONNECT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new Error(`Upstream request timed out after ${timeoutMs}ms: ${url}`),
    );
  }, timeoutMs);

  const onCallerAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(callerSignal?.reason);
    }
  };
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    // NOTE: the caller-abort listener is intentionally NOT removed here.
    // This finally runs when response headers arrive, but the caller's
    // signal must stay wired to the controller for the whole body:
    // aborting after headers cancels the in-flight body and closes the
    // upstream socket (client disconnects mid-stream are the common
    // case). The listener dies together with the caller's signal, so
    // there is no leak.
  }
}
