/**
 * [INPUT]: Depends on native control/API readers, their warm channel openers and the closed Agent identity.
 * [OUTPUT]: Selects a zero-prompt reader for each Agent, including OpenCode Go, and the subset whose process can stay warm.
 * [POS]: Reader dispatch table owned by the main quota service.
 */
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import { readCodexQuota } from "./codex";
import { openClaudeQuotaChannel, readClaudeQuota } from "./claude";
import { openKimiQuotaChannel, readKimiQuota } from "./kimi";
import { readOpencodeQuota } from "./opencode";
import type { QuotaChannelOpener, QuotaReader } from "./common";
export const quotaReaders: Partial<Record<AgentBackendId, QuotaReader>> = {
  codex: readCodexQuota, claude: readClaudeQuota, kimi: readKimiQuota, opencode: readOpencodeQuota,
};
/* Only the two readers whose cost is the process itself: Kimi boots `kimi web` in 4.3s and
   Claude the CLI in 2.5s, while Codex saves 0.5s and OpenCode never spawns anything. */
export const quotaChannels: Partial<Record<AgentBackendId, QuotaChannelOpener>> = {
  claude: openClaudeQuotaChannel, kimi: openKimiQuotaChannel,
};
