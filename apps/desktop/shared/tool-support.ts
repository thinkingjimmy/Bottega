/**
 * [INPUT]: Depends on canonical backend/runtime facts, built-in tool specifications, and neutral resource support types
 * [OUTPUT]: Provides pure built-in and manual-MCP backend support resolvers plus effective-state projection
 * [POS]: Shared capability truth consumed by main runtime admission and renderer Settings/Project live projections
 */

import type {
  AgentBackendId,
  BackendInfo,
  BackendRuntimeStatus,
} from "./agent-ipc";
import { builtinToolSpec } from "./builtin-tools";
import type { ManualMcpServerView } from "./mcp-servers-ipc";
import type {
  EffectiveResourceState,
  ResourceBackendSupportView,
} from "./resource-scope";

export type ToolBackendRuntimeFacts = Readonly<{
  backendId: AgentBackendId;
  runtimeStatus: BackendRuntimeStatus;
  runtimeVersion?: string;
  builtinTools: BackendInfo["capabilities"]["builtinTools"];
  detail?: string;
}>;

export function toolBackendFacts(backend: BackendInfo): ToolBackendRuntimeFacts {
  return {
    backendId: backend.id,
    runtimeStatus: backend.runtimeStatus,
    runtimeVersion: backend.version,
    builtinTools: backend.capabilities.builtinTools,
    ...(backend.reason ? { detail: backend.reason } : {}),
  };
}

export function toolBackendFactsFromRuntimeIdentity(
  backendId: AgentBackendId,
  backendRuntimeIdentity: string | undefined
): ToolBackendRuntimeFacts {
  const prefix = `${backendId}@`;
  const runtimeVersion = backendRuntimeIdentity?.startsWith(prefix)
    ? backendRuntimeIdentity.slice(prefix.length)
    : undefined;
  return {
    backendId,
    runtimeStatus: backendRuntimeIdentity ? "installed" : "missing",
    runtimeVersion,
    builtinTools: "none",
  };
}

export function resolveBuiltinBackendSupport(
  toolId: string,
  backend: ToolBackendRuntimeFacts
): ResourceBackendSupportView {
  if (backend.runtimeStatus !== "installed") {
    return unsupported(backend, "runtime-unavailable", backend.detail);
  }
  const spec = builtinToolSpec(toolId);
  if (
    spec?.backendAllowlist &&
    !spec.backendAllowlist.includes(backend.backendId)
  ) {
    return unsupported(
      backend,
      "builtin-tools-unsupported"
    );
  }
  const required = spec?.access ?? "mutate";
  const supported = backend.builtinTools === "mutate" ||
    (required === "read" && backend.builtinTools === "read");
  return supported
    ? supportedView(backend.backendId)
    : unsupported(backend, "builtin-tools-unsupported", backend.detail);
}

export function resolveBuiltinBackendSupportMatrix(
  toolId: string,
  backends: readonly ToolBackendRuntimeFacts[]
) {
  return backends.map((backend) =>
    resolveBuiltinBackendSupport(toolId, backend)
  );
}

export function resolveManualMcpBackendSupport(
  transport: ManualMcpServerView["transport"],
  backend: ToolBackendRuntimeFacts
): ResourceBackendSupportView {
  if (backend.runtimeStatus !== "installed") {
    return unsupported(backend, "runtime-unavailable", backend.detail);
  }
  if (transport !== "stdio") {
    return unsupported(
      backend,
      "transport-unsupported"
    );
  }
  if (backend.backendId !== "kimi") return supportedView(backend.backendId);
  if (atLeastStable(backend.runtimeVersion, [0, 39, 0])) {
    return supportedView(backend.backendId);
  }
  return {
    ...unsupported(backend, "transport-unsupported"),
    constraint: {
      kind: "minimum-runtime-version",
      minimumVersion: "0.39.0",
      detectedVersion: backend.runtimeVersion ?? null,
    },
  };
}

export function projectManualMcpServerSupport(
  server: ManualMcpServerView,
  backends: readonly ToolBackendRuntimeFacts[]
): ManualMcpServerView {
  const backendSupport = backends.map((backend) =>
    resolveManualMcpBackendSupport(server.transport, backend)
  );
  return {
    ...server,
    backendSupport,
    effectiveState: projectEffectiveState(
      server.enabled,
      backendSupport,
      server.eligibility === "eligible"
    ),
  };
}

export function projectEffectiveState(
  intentEnabled: boolean,
  backendSupport: readonly ResourceBackendSupportView[],
  eligible = true
): EffectiveResourceState {
  if (!eligible || (
    intentEnabled &&
    (backendSupport.length === 0 ||
      backendSupport.every((item) => !item.supported))
  )) return "unavailable";
  return intentEnabled ? "enabled" : "disabled";
}

function supportedView(backendId: AgentBackendId): ResourceBackendSupportView {
  return { backendId, supported: true, reason: null };
}

function unsupported(
  backend: ToolBackendRuntimeFacts,
  reason: Exclude<ResourceBackendSupportView["reason"], null>,
  detail?: string
): ResourceBackendSupportView {
  return {
    backendId: backend.backendId,
    supported: false,
    reason,
    ...(detail ? { detail } : {}),
  };
}

function atLeastStable(
  value: string | undefined,
  minimum: readonly [number, number, number]
) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? "");
  if (!match) return false;
  const current = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index]! > minimum[index]!) return true;
    if (current[index]! < minimum[index]!) return false;
  }
  return true;
}
