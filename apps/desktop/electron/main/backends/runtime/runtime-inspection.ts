/**
 * [INPUT]: Runtime descriptors, executable identity and bounded cached version probes.
 * [OUTPUT]: inspectRuntimeCandidate and optionalRuntimeIdentity with unchanged startup and unsupported classification.
 * [POS]: Runtime registry discovery leaf; no mutable availability or authentication state.
 */
import { cachedRuntimeVersion } from "./runtime-version-cache";
import { isProcessStartupFailure, runtimeVersionAsync } from "./runtime-probe";
import { candidateDiagnostic, executableIdentity, runtimeIdentityKey, sameIdentity, waitForSignal,
  type RegistryDependencies, type RuntimeIdentity, type InspectedCandidate, type CandidateRuntime } from "./availability/runtime";
import type { AgentRuntime, ProviderBackend, ResolvedRuntime } from "../types";

export async function optionalRuntimeIdentity(dependencies: RegistryDependencies, executable: string, signal?: AbortSignal) {
  try {
    return await waitForSignal(dependencies.identity ? dependencies.identity(executable, signal) : executableIdentity(executable), signal);
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

export async function inspectRuntimeCandidate(
  dependencies: RegistryDependencies,
  descriptor: ProviderBackend,
  candidate: AgentRuntime,
  signal: AbortSignal
): Promise<InspectedCandidate> {
  let version: string | undefined;
  let identityBefore: RuntimeIdentity | undefined;
  let identityAfter: RuntimeIdentity | undefined;
  try {
    identityBefore = await optionalRuntimeIdentity(dependencies, candidate.executable, signal);
    signal.throwIfAborted();
    version = dependencies.version
      ? await dependencies.version(candidate, signal)
      : await cachedRuntimeVersion(descriptor.id, candidate.executable, identityBefore, () => descriptor.probeVersion ? descriptor.probeVersion(candidate, signal) :
          runtimeVersionAsync(candidate, [...(descriptor.versionArgs?.length ? descriptor.versionArgs : ["--version"])], signal, descriptor.versionEnvironment?.(candidate)));
    signal.throwIfAborted();
    identityAfter = await optionalRuntimeIdentity(dependencies, candidate.executable, signal);
  } catch (cause) {
    signal.throwIfAborted();
    return {
      kind: "unusable",
      cannotStart: isProcessStartupFailure(cause),
      diagnostic: candidateDiagnostic(
        candidate,
        cause instanceof Error ? cause.message : String(cause)
      ),
    };
  }
  signal.throwIfAborted();
  if (!version || !identityBefore || !identityAfter) {
    return {
      kind: "unusable",
      diagnostic: candidateDiagnostic(
        candidate,
        `${version ? `version ${version}，` : ""}版本或文件身份探测失败`
      ),
    };
  }
  if (!sameIdentity(identityBefore, identityAfter)) {
    return {
      kind: "unusable",
      diagnostic: candidateDiagnostic(
        candidate,
        `version ${version}，文件身份在版本探测期间发生变化`
      ),
    };
  }
  const runtime: ResolvedRuntime = { ...candidate, version, versionIdentity: runtimeIdentityKey(identityAfter) };
  const validation = descriptor.validateRuntime(runtime);
  const inspected: CandidateRuntime = {
    runtime,
    identity: identityAfter,
    capabilities: {
      ...descriptor.capabilitiesFor(runtime),
      // Setup commands are independent of ACP terminal-auth negotiation.
      terminalAuth: Boolean(descriptor.setup?.commands.login),
    },
  };
  return validation.status === "unsupported"
    ? {
        kind: "unsupported",
        reason: validation.reason,
        diagnostic: candidateDiagnostic(
          candidate,
          `version ${version}，${validation.reason}`
        ),
        ...inspected,
      }
    : { kind: "installed", ...inspected };
}
