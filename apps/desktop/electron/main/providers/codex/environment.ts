/**
 * [INPUT]: Canonical built-in Provider ids from shared/providers/builtin; Depends on runtime probing/common command paths, Node OS/path helpers and backends/contracts/types AgentRuntime
 * [OUTPUT]: Freezes the Codex home source shared by native launch and visualization admission.
 * [POS]: The Codex backend's runtime discovery and environment seam, shared by the descriptor, auth, native launch, headless, and maintenance
 */
import { BUILTIN_PROVIDER_IDS } from "../../../../shared/providers/builtin";

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  commonCommandPaths,
  probeRuntimeCandidatesAsync,
  sanitizedProcessEnvironment,
} from "../../backends/runtime/runtime-probe";
import type { AgentRuntime } from "../../backends/contracts/types";

export const findCodexRuntime = (signal?: AbortSignal) =>
  probeRuntimeCandidatesAsync({ command: BUILTIN_PROVIDER_IDS.codex, commonPaths: [...commonCommandPaths(BUILTIN_PROVIDER_IDS.codex), ...codexDesktopPaths()], signal });

export function codexDesktopPaths(platform = process.platform, home = homedir()) {
  if (platform !== "darwin") return [];
  return ["/Applications", join(home, "Applications")].flatMap((root) => [
    join(root, "Codex.app/Contents/Resources/codex"),
    join(root, "ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"),
  ]);
}

const frozenCodexHome = process.env.CODEX_HOME;

export function codexHomePath(value = frozenCodexHome) {
  return value?.trim() ? resolve(value.trim()) : join(homedir(), ".codex");
}

export function codexEnvironment(
  runtime: AgentRuntime,
  codexHome = frozenCodexHome
): NodeJS.ProcessEnv {
  return {
    ...sanitizedProcessEnvironment(runtime.path),
    ...(codexHome?.trim() ? { CODEX_HOME: codexHomePath(codexHome) } : {}),
  };
}
