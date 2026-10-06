/**
 * [INPUT]: Depends on runtime probing/common command paths, Node OS/path helpers and backends/types AgentRuntime
 * [OUTPUT]: Provides findCodexRuntime (CLI and macOS desktop-bundled candidates), codexDesktopPaths and codexEnvironment (allowlisted environment plus CODEX_HOME)
 * [POS]: The Codex backend's runtime discovery and environment seam, shared by the descriptor, auth, adapter entry, headless, and maintenance
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  commonCommandPaths,
  probeRuntimeCandidatesAsync,
  sanitizedProcessEnvironment,
} from "../../backends/runtime/runtime-probe";
import type { AgentRuntime } from "../../backends/types";

export const findCodexRuntime = (signal?: AbortSignal) =>
  probeRuntimeCandidatesAsync({ command: "codex", commonPaths: [...commonCommandPaths("codex"), ...codexDesktopPaths()], signal });

export function codexDesktopPaths(platform = process.platform, home = homedir()) {
  if (platform !== "darwin") return [];
  return ["/Applications", join(home, "Applications")].flatMap((root) => [
    join(root, "Codex.app/Contents/Resources/codex"),
    join(root, "ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"),
  ]);
}

export function codexEnvironment(
  runtime: AgentRuntime,
  codexHome = process.env.CODEX_HOME
): NodeJS.ProcessEnv {
  return {
    ...sanitizedProcessEnvironment(runtime.path),
    ...(codexHome ? { CODEX_HOME: codexHome } : {}),
  };
}
