/**
 * [INPUT]: Depends on Codex/Claude/Kimi/OpenCode descriptor with shared fixed display order, and the composed Provider catalog (package Providers)
 * [OUTPUT]: Provides back-end registry, list in order, strictly search with the only runtimeRegistry, resolveProvider / requireProvider / turnBackend / providerDisplayName (the one place a built-in and an available package Provider meet: built-ins first, then the catalog, else null, a named unknown-provider, or for a turn the named runtime-unavailable failure), runnableProviderIds (built-ins, then available package Providers in catalog order), quotaHookFor / quotaProviders (the Providers with quota, in catalog order), and providerReadinessPlan (a Provider's bridge readiness plan from its own backend, refused for an id without one)
 * [POS]: The only registered centre for backends; The new back end is installed only once. The runtime registry never reads the catalog: it asks the resolver
 */

import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
} from "../../../shared/ipc/agent/agent-ipc";
import { claudeBackend } from "../providers/claude";
import { codexBackend } from "../providers/codex";
import { kimiBackend } from "../providers/kimi";
import { opencodeBackend } from "../providers/opencode";
import type { BackendDescriptor, ProviderBackend, ProviderReadinessPlan, ResolvedRuntime } from "./types";
import { composedProviderCatalog } from "../providers/host/catalog";
import { agentRuntimeFailure, diagnosticFailureDetails, ProductFailureError } from "../../../shared/product/product-failure";
import { builtinProviderCatalog } from "../../../shared/providers/catalog";
import { BackendRuntimeRegistry } from "./runtime/runtime-registry";

export const backendRegistry = new Map<AgentBackendId, BackendDescriptor>([
  ["codex", codexBackend],
  ["claude", claudeBackend],
  ["kimi", kimiBackend],
  ["opencode", opencodeBackend],
]);

export const orderedBackends = () =>
  AGENT_BACKEND_ORDER.map((id) => backendRegistry.get(id)).filter(
    (value): value is BackendDescriptor => Boolean(value)
  );

export function backendById(id: AgentBackendId) {
  const backend = backendRegistry.get(id);
  if (!backend) throw new Error(`未知的 Agent 后端：${id}`);
  return backend;
}

/**
 * The backend a Provider id runs on now: a built-in's host code first (a package can never shadow one), else the composed catalog's
 * DescriptorBackend for an available package Provider, else null. The catalog alone decides what is available (runnable policy, trust,
 * contested ids), so production, which refuses third-party modules, resolves no package here.
 */
export function resolveProvider(id: string): ProviderBackend | null {
  return builtinBackends.get(id) ?? composedProviderCatalog()?.resolveBackend(id) ?? null;
}
/* The built-ins read by any id, so a lookup needs no cast. */
const builtinBackends: ReadonlyMap<string, BackendDescriptor> = backendRegistry;

export class UnknownProviderError extends Error {
  readonly code = "unknown-provider";
  constructor(readonly id: string) { super(`unknown-provider: no backend runs ${id.slice(0, 32)} here`); this.name = "UnknownProviderError"; }
}

/** resolveProvider for a caller that cannot go on without a backend: a named unknown-provider, never a raw throw. */
export function requireProvider(id: string): ProviderBackend {
  const backend = resolveProvider(id);
  if (!backend) throw new UnknownProviderError(id);
  return backend;
}

/**
 * The backend a turn starts on (d4b follow-up slice 2): a built-in's host code or an available package Provider's DescriptorBackend. A
 * Provider nothing runs here (production's refused package, a disabled or revoked one, a gone id) is the named runtime-unavailable
 * failure a turn reports, never a throw of developer text and never another Provider's backend.
 */
export function turnBackend(id: string): ProviderBackend {
  const backend = resolveProvider(id);
  if (!backend) throw new ProductFailureError(agentRuntimeFailure("runtime-unavailable", diagnosticFailureDetails(`no backend runs ${id.slice(0, 32)} here`)));
  return backend;
}

/** A Provider's name for failure and notice text: its backend's, else the catalog's (a gone package keeps its name), else the id. */
export function providerDisplayName(id: string): string {
  return resolveProvider(id)?.displayName ?? composedProviderCatalog()?.snapshot().entries.find(entry => entry.id === id)?.displayName ?? id;
}

/** The Providers with runtime facts: the built-ins in order, then each available package Provider in catalog order. */
export function runnableProviderIds(): string[] {
  const packages = composedProviderCatalog()?.snapshot().entries.filter(entry => entry.source === "package" && entry.available) ?? [];
  return [...builtinProviderCatalog.entries().map(entry => entry.id),
    ...packages.map(entry => entry.id).filter(id => !builtinBackends.has(id) && resolveProvider(id))];
}

/** The Provider bridge's readiness plan from the Provider's own backend; an unknown id, or a backend without a plan, is refused. */
export async function providerReadinessPlan(providerId: string, runtime: ResolvedRuntime): Promise<ProviderReadinessPlan> {
  const readiness = resolveProvider(providerId)?.readiness;
  if (!readiness) throw new Error(`the Provider bridge has no readiness plan for ${providerId} yet`);
  return readiness(runtime);
}

/** A Provider's quota support from its own descriptor; undefined for an unknown id or a Provider without quota. */
export const quotaHookFor = (providerId: string) => backendRegistry.get(providerId as AgentBackendId)?.quota;
/** The Providers whose limits can be read, in catalog order (TASK-13 C): quota lists, snapshots and demand iterate this, never a closed id list. */
export const quotaProviders = (): AgentBackendId[] =>
  builtinProviderCatalog.entries().map((entry) => entry.id as AgentBackendId).filter((id) => quotaHookFor(id));

export const backendRuntimeRegistry = new BackendRuntimeRegistry({
  descriptorFor: requireProvider,
  providerIds: runnableProviderIds,
});
