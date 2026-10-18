/**
 * [INPUT]: Uses validated Codex runtime identity and the allowlisted native environment.
 * [OUTPUT]: Exports nativeCodexLaunch for sealed stdio Chat and model-free control processes.
 * [POS]: Lightweight main-only launch plan; turn policy and filesystem discovery load on demand.
 */
import type { AgentProcessLaunch, ResolvedRuntime } from "../../../../backends/contracts/types";
import { codexEnvironment } from "../../environment";

export function nativeCodexLaunch(runtime: ResolvedRuntime, cwd: string, processEnv?: NodeJS.ProcessEnv): AgentProcessLaunch {
  const env = { ...codexEnvironment(runtime), ...processEnv };
  delete env.BOTTEGA_HOST_SANDBOX;
  return { relayOutput: "base64", command: runtime.executable, args: ["-c", "analytics.enabled=false", "app-server", "--listen", "stdio://"], cwd, env };
}
