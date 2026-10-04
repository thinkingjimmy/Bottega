/**
 * [INPUT]: Depends on the Kimi Code home resolver, Node fs, and the main-side `kimi web` quota reader and its warm channel.
 * [OUTPUT]: Provides kimiQuota, Kimi's QuotaHook: kind "main" (the read carries the `kimi web` bearer main holds, which a bridge
 *           must not — the named exception), kept warm (`kimi web` takes 4.3 s to start), keyed by its home and config.toml.
 * [POS]: Kimi's half of TASK-13 B, carried by kimiBackend; the reader itself stays in usage-limits/readers/kimi.ts.
 */
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { openKimiQuotaChannel, readKimiQuota } from "../../usage-limits/readers/kimi";
import type { QuotaHook } from "../../usage-limits/readers/common";
import { resolveKimiCodeHome } from "./home";

/* Which account `kimi web` reads for: its home, and the config there (a login rewrites it). */
async function identity() {
  const home = await realpath(resolveKimiCodeHome()).catch(() => resolveKimiCodeHome());
  const config = await stat(join(home, "config.toml")).then((value) => [value.ino, value.size, value.mtimeMs], () => null);
  return { home, config };
}

export const kimiQuota: QuotaHook = { kind: "main", read: readKimiQuota, channel: openKimiQuotaChannel, identity };
