/**
 * [INPUT]: Depends on General can cancel runtime-probe, Registry flight signal and the user's native Codex CLI
 * [OUTPUT]: Provides CodexRuntime, asymmetric user CLI candidates found with minimal white list environment
 * [POS]: The Codex layer of Electron main is adapted when running; No search, no uninstall, no priority product private binary
 */

import {
  probeRuntimeCandidatesAsync,
  sanitizedProcessEnvironment,
} from "./backends/runtime-probe";
import type { AgentRuntime } from "./backends/types";

export type CodexRuntime = AgentRuntime;
export { sanitizedProcessEnvironment } from "./backends/runtime-probe";

export const findCodexRuntime = (signal?: AbortSignal) =>
  probeRuntimeCandidatesAsync({ command: "codex", signal });

export function codexEnvironment(
  runtime: CodexRuntime,
  codexHome = process.env.CODEX_HOME
): NodeJS.ProcessEnv {
  return {
    ...sanitizedProcessEnvironment(runtime.path),
    ...(codexHome ? { CODEX_HOME: codexHome } : {}),
  };
}
