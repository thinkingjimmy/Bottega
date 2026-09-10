/**
 * [INPUT]: Depends on three native readers and the closed Agent identity.
 * [OUTPUT]: Selects a zero-prompt reader; OpenCode has no supported unified quota source.
 * [POS]: Reader dispatch table owned by the main quota service.
 */
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import { readCodexQuota } from "./codex";
import { readClaudeQuota } from "./claude";
import { readKimiQuota } from "./kimi";
import type { QuotaReader } from "./common";
export const quotaReaders: Partial<Record<AgentBackendId, QuotaReader>> = {
  codex: readCodexQuota, claude: readClaudeQuota, kimi: readKimiQuota,
};
