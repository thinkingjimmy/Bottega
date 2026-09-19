/**
 * [INPUT]: Depends on the native OpenCode data directory and bounded read-only filesystem access.
 * [OUTPUT]: Selects only the Go API credential and provides non-secret file identity for quota fencing.
 * [POS]: Main-only credential boundary; no copies, writes, logs, environment keys or provider fallback.
 */
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { opencodeDataDirectory } from "../../../backends/opencode/home";
import { object, QuotaReadError } from "../common";

const MAX_AUTH_BYTES = 1024 * 1024;
export const opencodeAuthPath = () => join(opencodeDataDirectory(), "auth.json");

export async function opencodeCredentialIdentity(path = opencodeAuthPath()) {
  const canonical = await realpath(path).catch(() => path);
  const metadata = await lstat(path).then(
    (value) => [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs],
    () => null,
  );
  return { path: canonical, metadata };
}

export async function readOpencodeGoKey(path: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((cause: NodeJS.ErrnoException) => {
    throw new QuotaReadError(cause.code === "ENOENT" ? "needs-auth" : "unavailable");
  });
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_AUTH_BYTES) throw new QuotaReadError("unavailable");
    // Bound the actual read too: the native CLI may rewrite the file after stat.
    const bytes = Buffer.alloc(MAX_AUTH_BYTES + 1);
    try {
      let size = 0;
      while (size < bytes.length) {
        signal.throwIfAborted();
        const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_AUTH_BYTES) throw new QuotaReadError("unavailable");
      const auth = object(JSON.parse(bytes.toString("utf8", 0, size)));
      if (!Object.hasOwn(auth, "opencode-go")) {
        throw new QuotaReadError(Object.keys(auth).length ? "unsupported" : "needs-auth");
      }
      const go = object(auth["opencode-go"]);
      if (go.type !== "api") throw new QuotaReadError("unsupported");
      if (typeof go.key !== "string" || !go.key.length || go.key.length > 16_384 ||
        // Header credentials must contain printable ASCII without whitespace.
        !/^[\x21-\x7e]+$/.test(go.key)) throw new QuotaReadError("needs-auth");
      return go.key;
    } finally { bytes.fill(0); }
  } catch (cause) {
    if (cause instanceof QuotaReadError) throw cause;
    throw new QuotaReadError("unavailable");
  } finally { await file.close(); }
}
