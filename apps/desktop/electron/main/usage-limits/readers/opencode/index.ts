/**
 * [INPUT]: Depends on the native Go credential, bounded HTTP bodies and OpenCode Go normalization.
 * [OUTPUT]: Reads Go subscription limits from the fixed official endpoint with cancellable, secret-safe failures.
 * [POS]: Zero-prompt OpenCode quota reader; no CLI process, plugins, local spend estimates or account mutations.
 */
import { normalizeOpencodeGo } from "../../normalization";
import { boundedJson, quotaError, QuotaReadError, type QuotaReader } from "../common";
import { opencodeAuthPath, readOpencodeGoKey } from "./credentials";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
type ReaderOptions = { authPath?: () => string; fetch?: typeof globalThis.fetch; now?: () => number };

function retryAfter(value: string | null, now: number) {
  if (!value?.trim()) return undefined;
  const milliseconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.min(86_400_000, Math.max(0, milliseconds)) : undefined;
}

export function createOpencodeQuotaReader(options: ReaderOptions = {}): QuotaReader {
  return async (_runtime, signal) => {
    const now = options.now ?? Date.now;
    try {
      const key = await readOpencodeGoKey((options.authPath ?? opencodeAuthPath)(), signal);
      signal.throwIfAborted();
      const response = await (options.fetch ?? globalThis.fetch)(USAGE_URL, {
        /* Node's RequestInit has no `cache` mode — it typechecks privately only because
           @types/jsdom drags lib.dom in, and the public tree has no such luck. These two
           headers are exactly what undici puts on the wire for cache: "no-store". */
        method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
        signal, redirect: "error", credentials: "omit",
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const reason = response.status === 401 ? "needs-auth"
          : response.status === 403 || response.status === 404 ? "unsupported"
            : response.status === 429 ? "rate-limited" : "unavailable";
        throw new QuotaReadError(reason, reason === "rate-limited" ? retryAfter(response.headers.get("retry-after"), now()) : undefined);
      }
      return normalizeOpencodeGo(await boundedJson(response), now());
    } catch (cause) { throw quotaError(cause); }
  };
}

export const readOpencodeQuota = createOpencodeQuotaReader();
