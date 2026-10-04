/**
 * [INPUT]: Depends on an explicit HTTPS origin allowlist, byte budget, AbortSignal and standard Fetch
 * [OUTPUT]: Provides bounded archive download with manual redirect admission and a total deadline
 * [POS]: Memory archive supply boundary; it grants no compiler or model networking permission
 */

export type ArchiveDownloadPolicy = {
  maximumBytes: number;
  allowedOrigins: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function downloadArchive(url: string, policy: ArchiveDownloadPolicy, fetcher: typeof fetch = fetch) {
  if (!Number.isSafeInteger(policy.maximumBytes) || policy.maximumBytes <= 0) throw invalid("byte budget");
  const timeout = policy.timeoutMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 5 * 60_000) throw invalid("deadline");
  const controller = new AbortController();
  const abort = () => controller.abort(policy.signal?.reason);
  policy.signal?.addEventListener("abort", abort, { once: true });
  if (policy.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(invalid("deadline exceeded")), timeout);
  try {
    const response = await admittedResponse(url, policy, controller.signal, fetcher);
    return await readBounded(response, policy.maximumBytes, controller.signal);
  } finally {
    clearTimeout(timer);
    policy.signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

async function admittedResponse(url: string, policy: ArchiveDownloadPolicy, signal: AbortSignal, fetcher: typeof fetch) {
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password || !policy.allowedOrigins.includes(target.origin)) throw invalid("source origin");
    const response = await fetcher(target.href, { redirect: "manual", signal });
    if (response.ok && response.body) return response;
    await response.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(response.status)) throw invalid(`HTTP ${response.status}`);
    const location = response.headers.get("location");
    if (!location || redirects === 3) throw invalid("redirect budget");
    url = new URL(location, target).href;
  }
  throw invalid("redirect budget");
}

async function readBounded(response: Response, maximumBytes: number, signal: AbortSignal) {
  const reader = response.body!.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) throw invalid("declared byte budget");
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) return Buffer.concat(chunks, length);
      length += chunk.value.byteLength;
      if (length > maximumBytes) throw invalid("stream byte budget");
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function invalid(detail: string) { return Object.assign(new Error(`Memory archive download: ${detail}`), { code: "MEMORY_ARCHIVE_DOWNLOAD_FAILED" }); }
