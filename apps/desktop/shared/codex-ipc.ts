/**
 * [INPUT]: Depends on the general authorization rating of agent-ipc
 * [OUTPUT]: Externally only available Codex-exclusive models, reasoning strength, service layer and authorization turn options
 * [POS]: The shared module is a Codex transport DTO exclusive; The overall life cycle is all agent-ipc
 */

import type { AgentPermissionMode } from "./agent-ipc";

export type CodexTurnOptions = {
  backend: "codex";
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  permissionMode: AgentPermissionMode;
};
