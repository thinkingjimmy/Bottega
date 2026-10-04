/**
 * [INPUT]: Depends on the main-side OpenCode Go quota reader and its credential metadata.
 * [OUTPUT]: Provides opencodeQuota, OpenCode's QuotaHook: kind "main" (the read carries the API key main holds, which a bridge
 *           must not — the named exception), no process to keep warm, keyed by its credential.
 * [POS]: OpenCode's half of TASK-13 B, carried by opencodeBackend; the reader itself stays in usage-limits/readers/opencode/.
 */
import { readOpencodeQuota } from "../../usage-limits/readers/opencode";
import { opencodeCredentialIdentity } from "../../usage-limits/readers/opencode/credentials";
import type { QuotaHook } from "../../usage-limits/readers/common";

export const opencodeQuota: QuotaHook = { kind: "main", read: readOpencodeQuota, identity: opencodeCredentialIdentity };
