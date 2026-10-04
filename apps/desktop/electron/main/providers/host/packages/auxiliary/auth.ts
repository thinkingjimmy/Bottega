/**
 * [INPUT]: Depends on the admitted Provider descriptor, shared package launch authority and supervised command runner.
 * [OUTPUT]: Provides descriptorAuth and descriptorSetup; authentication is explicit JSON from a successful fenced command.
 * [POS]: Package Provider authentication and local login metadata; failed probes never infer a signed-in or signed-out state.
 */
import type { ProviderDescriptor } from "@bottega/contracts/model/provider";
import type { AuthExtension, SetupExtension } from "../../../../backends/types";
import { readinessWorkingDirectory } from "../../../../backends/acp/startup/readiness";
import { runSupervisedCommand } from "../../../../backends/jobs/supervised-command";
import type { ProviderPackageRef } from "../../catalog";
import { descriptorAcpLaunch, preparePackageLaunch } from "../launch";

export function descriptorAuth(descriptor: ProviderDescriptor, pkg: ProviderPackageRef): AuthExtension | undefined {
  const command = descriptor.auth.statusCommand;
  if (descriptor.auth.check === "turn-evidence") return { check: async () => ({ status: "unknown", unknownReason: "provider-scoped" }), turnEvidence: "provider" };
  if (descriptor.auth.check !== "status-command" || !command) return undefined;
  return { turnEvidence: "provider", check: async (runtime, signal) => {
    try {
      const base = descriptorAcpLaunch(descriptor, runtime);
      const launch = await preparePackageLaunch(descriptor, pkg, { ...base, args: command.args, cwd: await readinessWorkingDirectory(descriptor.providerId) });
      const result = await runSupervisedCommand({ ...launch, args: [...launch.args], backend: descriptor.providerId,
        label: "Provider authentication", timeoutMs: 15_000, maxBuffer: 16_384, signal });
      const value: unknown = JSON.parse(result.stdout);
      const status = value && typeof value === "object" ? (value as { status?: unknown }).status : null;
      if (status === "authenticated" || status === "unauthenticated") return { status, startup: "ready" };
      return { status: "unknown", unknownReason: "provider-scoped" };
    } catch {
      signal?.throwIfAborted();
      return { status: "error", checkIssue: "failed", reason: "provider-auth-check-failed" };
    }
  } };
}

export function descriptorSetup(descriptor: ProviderDescriptor): SetupExtension | undefined {
  if (!descriptor.auth.loginArgs || descriptor.auth.login.local !== "terminal") return undefined;
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  return { commands: { login: { command: [descriptor.runtime.discovery.commands[0]!, ...descriptor.auth.loginArgs].map(quote).join(" "), dangerous: false } } };
}
