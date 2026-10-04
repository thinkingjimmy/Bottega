/**
 * [INPUT]: Depends on ordered backend snapshots with main-owned revisions.
 * [OUTPUT]: Provides revision-safe merging (built-ins first, then package Providers in arrival order, bounded) and deadlines for authentication, retained runtime results and scoped turn evidence.
 * [POS]: Shared renderer reconciliation; late reads cannot overwrite newer status events.
 */
import { AGENT_BACKEND_ORDER, type BackendInfo } from "../ipc/agent/agent-ipc";

/* The four built-ins plus installed Provider packages, as the main catalog bounds them. */
const BACKEND_LIMIT = 32;

/** The built-ins in their order, then any other Provider (a package Provider) in the order it arrived; none is ever dropped. */
export function mergeBackendSnapshots(current: readonly BackendInfo[], incoming: readonly BackendInfo[]) {
  const result = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    const prior = result.get(entry.id);
    if (!prior || (entry.availability?.revision ?? 0) >= (prior.availability?.revision ?? 0)) result.set(entry.id, entry);
  }
  const builtins = new Set<string>(AGENT_BACKEND_ORDER);
  return [...[...builtins].flatMap((id) => result.get(id) ?? []), ...[...result.values()].filter((entry) => !builtins.has(entry.id))]
    .slice(0, BACKEND_LIMIT);
}

/** One renderer owner schedules the nearest deadline across all its visible facts. */
export function availabilityDeadlines(backends: readonly BackendInfo[], recent: readonly import("./types").TurnAvailabilityEvidence[] = []) {
  return [
    ...backends.flatMap((backend) => [backend.availability?.lastConfirmedAuth?.expiresAt,
      backend.availability?.runtimeCheck?.phase === "error" ? backend.availability.runtimeCheck.expiresAt : undefined,
      ...Object.values(backend.availability?.purposeEligibility ?? {}).map((value) => value.expiresAt)]),
    ...recent.flatMap((evidence) => [evidence.expiresAt, evidence.limit?.resetsAt]),
  ].filter((value): value is number => value !== undefined && Number.isFinite(value));
}
