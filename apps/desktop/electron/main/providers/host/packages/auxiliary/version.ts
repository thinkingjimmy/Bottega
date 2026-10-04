/**
 * [INPUT]: Depends on the Provider descriptor, shared package launch authority and supervised command runner.
 * [OUTPUT]: Provides descriptorVersionProbe for fenced version discovery with bounded output and cleanup.
 * [POS]: Package discovery leaf; executable identity caching remains owned by the runtime registry.
 */
import type { ProviderDescriptor } from "@bottega/contracts/model/provider";
import type { AgentRuntime } from "../../../../backends/types";
import { normalizeCliVersion, sanitizedProcessEnvironment } from "../../../../backends/runtime/runtime-probe";
import { readinessWorkingDirectory } from "../../../../backends/acp/startup/readiness";
import { runSupervisedCommand } from "../../../../backends/jobs/supervised-command";
import type { ProviderPackageRef } from "../../catalog";
import { preparePackageLaunch } from "../launch";

export function descriptorVersionProbe(descriptor: ProviderDescriptor, pkg: ProviderPackageRef) {
  return async (runtime: AgentRuntime, signal: AbortSignal) => {
    const launch = await preparePackageLaunch(descriptor, pkg, { command: runtime.executable,
      args: descriptor.runtime.discovery.versionArgs.length ? descriptor.runtime.discovery.versionArgs : ["--version"],
      env: sanitizedProcessEnvironment(runtime.path), cwd: await readinessWorkingDirectory(descriptor.providerId) }, { network: false });
    signal.throwIfAborted();
    const result = await runSupervisedCommand({ ...launch, args: [...launch.args], backend: descriptor.providerId,
      label: "Provider version", timeoutMs: 10_000, maxBuffer: 16_384, signal });
    return normalizeCliVersion(result.stdout);
  };
}
