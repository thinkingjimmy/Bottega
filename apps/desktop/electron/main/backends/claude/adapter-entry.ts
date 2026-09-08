/**
 * [INPUT]: Depends on node createRequire and claude-agent-acp open dist path
 * [OUTPUT]: Provides claudeAdapterEntry/claudeAdapterArgs, to solve the ACP CLI entry locking
 * [POS]: Packaging boundary of the Claude descriptor; the resolved adapter points at the user's native CLI at runtime via CLAUDE_CODE_EXECUTABLE
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ADAPTER_ENTRY =
  "@agentclientprotocol/claude-agent-acp/dist/index.js";

export function claudeAdapterEntry() {
  return require.resolve(ADAPTER_ENTRY);
}

export function claudeAdapterArgs() {
  return [claudeAdapterEntry()];
}
