/**
 * [INPUT]: Depends on backends/runtime-probe candidate probing and sanitizedProcessEnvironment, and backends/types AgentRuntime
 * [OUTPUT]: Provides findCodexRuntime (the user's Codex CLI candidates) and codexEnvironment (its allowlisted environment plus CODEX_HOME)
 * [POS]: The Codex backend's runtime discovery and environment seam, shared by the descriptor, auth, adapter entry, headless, and maintenance
 */

import {
  probeRuntimeCandidatesAsync,
  sanitizedProcessEnvironment,
} from "../runtime-probe";
import type { AgentRuntime } from "../types";

export const findCodexRuntime = (signal?: AbortSignal) =>
  probeRuntimeCandidatesAsync({ command: "codex", signal });

export function codexEnvironment(
  runtime: AgentRuntime,
  codexHome = process.env.CODEX_HOME
): NodeJS.ProcessEnv {
  return {
    ...sanitizedProcessEnvironment(runtime.path),
    ...(codexHome ? { CODEX_HOME: codexHome } : {}),
  };
}
