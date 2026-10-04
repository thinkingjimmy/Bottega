/**
 * [INPUT]: Depends on the Provider descriptor contract, node:fs, the sanitized base environment every CLI launch starts from, the admission gate and the security lane's G4 declaredLaunchRefusal.
 * [OUTPUT]: Provides assertPackageAdmitted (the admission gate before any package CLI starts), descriptorAcpLaunch (a package Provider's ACP process as main seals it) and assertDeclaredLaunch (refuses, before any process starts, a plan that is not the descriptor's declared executable and arguments).
 * [POS]: The launch half of providers/host/packages' DescriptorBackend: turns, readiness and the model probe all start from this one plan, so none can drift from what the descriptor declared.
 */
import { requireHostPackageRuntime } from "../../../extensions/host/runtime";
import type { AgentProcessLaunch } from "../../../backends/types";
import type { ProviderPackageRef } from "../catalog";
import { realpathSync } from "node:fs";
import type { ProviderDescriptor } from "@ai-chat/cloud-protocol/contracts/provider";
import { sanitizedProcessEnvironment } from "../../../backends/runtime/runtime-probe";
import type { ResolvedRuntime } from "../../../backends/types";
import { agentRuntimeFailure, diagnosticFailureDetails, ProductFailureError } from "../../../../../shared/product/product-failure";
import { assertProviderAdmitted, ProviderAdmissionRefused } from "../admission";
import { declaredLaunchRefusal } from "../../../extensions/trust/provider-admission";

/** Every start of a package CLI asks the one admission gate first (a turn does so in ProviderBridgeRuntime.ensure; a model probe and
    readiness here): a Provider the gate refuses starts nothing, and says so as the same named failure a turn gets. */
export async function assertPackageAdmitted(providerId: string) {
  await assertProviderAdmitted(providerId).catch((cause: unknown) => {
    throw cause instanceof ProviderAdmissionRefused ? new ProductFailureError(agentRuntimeFailure("runtime-unavailable", diagnosticFailureDetails(cause))) : cause;
  });
}

/**
 * The discovered executable, resolved once (the plan names the file, never a link that could be swapped after discovery), with
 * exactly the descriptor's declared arguments (argv, never a shell), and an environment of the sanitized base plus the variables
 * the descriptor allows; `overlay` is the turn's App configuration (APP_CONFIG_* only).
 */
export function descriptorAcpLaunch(descriptor: ProviderDescriptor, runtime: ResolvedRuntime, overlay?: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv = process.env) {
  const allowed = [...descriptor.runtime.env.allow, ...descriptor.runtime.env.processStart];
  const passed = Object.fromEntries(allowed.flatMap(name => source[name] !== undefined ? [[name, source[name]!] as const] : []));
  return {
    command: resolvedOrSelf(runtime.executable),
    args: [...(descriptor.runtime.launch.args ?? [])],
    env: { ...sanitizedProcessEnvironment(runtime.path, source), ...passed, ...overlay } as NodeJS.ProcessEnv,
  };
}

const resolvedOrSelf = (path: string) => { try { return realpathSync(path); } catch { return path; } };

/** Right before a process is started: the security lane's G4 check (d4c) refuses any plan that is not the declared launch of the
    discovered executable (the name found must be declared, the plan names the resolved file, the arguments are exactly the declared ones). */
export function assertDeclaredLaunch(descriptor: ProviderDescriptor, launch: { command: string; args: readonly string[] }, discoveredExecutable: string) {
  const refusal = declaredLaunchRefusal(descriptor, launch, { path: discoveredExecutable, realpath: resolvedOrSelf(discoveredExecutable) });
  if (refusal) throw Object.assign(new Error(`${refusal}: ${descriptor.providerId} may start only its declared executable and arguments`), { code: refusal });
}

/** All package CLI launches share the package host's trust, lifecycle and OS boundary. */
export function preparePackageLaunch(descriptor: ProviderDescriptor, pkg: ProviderPackageRef, launch: AgentProcessLaunch,
  access?: Parameters<ReturnType<typeof requireHostPackageRuntime>["prepareProviderLaunch"]>[3]) {
  return requireHostPackageRuntime().prepareProviderLaunch(pkg.installIdentity, descriptor, launch, access);
}
