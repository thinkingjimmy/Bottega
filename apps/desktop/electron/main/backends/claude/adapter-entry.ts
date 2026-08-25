/**
 * [INPUT]: Depends on node createRequire and claude-agent-acp open dist path
 * [OUTPUT]: Provides claudeAdapterEntry/claudeAdapterArgs, to solve the ACP CLI entry locking
 * [POS]: The boundaries of the packing of Claude Descriptor; The adapter is designed to adjust the user's CLI to the user's native CLI using CLAUDE_CODE_EXECUTABLE
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
