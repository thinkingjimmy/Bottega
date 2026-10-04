/**
 * [INPUT]: Depends on Fetch byte streams and fixed public file route contracts.
 * [OUTPUT]: Provides bounded binary and error decoding without credentials or provider selection.
 * [POS]: Shared transport codec; platform adapters own requests, auth refresh and cancellation.
 */
export async function readFileResponse(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const max = response.ok ? limit : 4096;
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) { await response.body?.cancel(); throw new Error("file-response-too-large"); }
  const reader = response.body?.getReader(), bytes = new Uint8Array(max); let offset = 0;
  if (reader) {
    const abort = () => { void reader.cancel().catch(() => undefined); }; signal.addEventListener("abort", abort, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted(); const { done, value } = await reader.read(); signal.throwIfAborted(); if (done) break;
        if (offset + value.byteLength > max) throw new Error("file-response-too-large");
        bytes.set(value, offset); offset += value.byteLength;
      }
    } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  if (!response.ok) {
    let code = "file-request-failed";
    try { const value: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(0, offset)));
      if (value && typeof value === "object" && "error" in value && typeof value.error === "string" && /^[a-z-]{1,128}$/.test(value.error)) code = value.error;
    } catch { /* Unexpected upstream responses remain generic. */ }
    throw new Error(code);
  }
  return bytes.subarray(0, offset);
}
