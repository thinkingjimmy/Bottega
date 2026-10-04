/**
 * [INPUT]: A pinned HTTPS asset, a private partial file, standard Fetch and cancellation.
 * [OUTPUT]: downloadResumable, preserving incomplete bytes and admitting every redirect before network access.
 * [POS]: Shared tunnel supply transport; it does not decide consent or trust executable bytes.
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";

const ORIGINS = new Set(["https://github.com", "https://release-assets.githubusercontent.com"]);
export async function downloadResumable(url: string, path: string, maximumBytes: number, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const file = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximumBytes) throw new Error("tunnel-download-invalid");
    let received = stat.size, response: Response | null = null, next = url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const target = new URL(next);
      if (!ORIGINS.has(target.origin) || target.username || target.password || target.hash) throw new Error("tunnel-download-origin");
      response = await fetcher(target, { redirect: "manual", signal: deadline, headers: received ? { Range: `bytes=${received}-`, "Accept-Encoding": "identity" } : { "Accept-Encoding": "identity" } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 3) throw new Error("tunnel-download-redirect");
      next = new URL(location, target).href;
    }
    if (!response || ![200, 206].includes(response.status) || !response.body) {
      if (response?.status === 416 && received > 0) return;
      throw new Error("tunnel-download-failed");
    }
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
      if (!range || Number(range[1]) !== received || Number(range[2]) < received || Number(range[3]) > maximumBytes) {
        await response.body.cancel(); throw new Error("tunnel-download-range");
      }
    } else { received = 0; await file.truncate(0); }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (!Number.isSafeInteger(length) || length < 0 || received + length > maximumBytes) {
      await response.body.cancel(); throw new Error("tunnel-download-limit");
    }
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.byteLength > maximumBytes) throw new Error("tunnel-download-limit");
        let written = 0;
        while (written < value.length) {
          const part = await file.write(value, written, value.length - written, received + written);
          if (!part.bytesWritten) throw new Error("tunnel-download-failed");
          written += part.bytesWritten;
        }
        received += value.length;
      }
      await file.sync();
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  } finally { await file.close(); }
}
