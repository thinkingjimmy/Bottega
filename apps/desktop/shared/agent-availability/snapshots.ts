/**
 * [INPUT]: Depends on ordered backend snapshots with main-owned revisions.
 * [OUTPUT]: Provides revision-safe merging and deadlines for authentication, retained runtime results and scoped turn evidence.
 * [POS]: Shared renderer reconciliation; late reads cannot overwrite newer status events.
 */
import { AGENT_BACKEND_ORDER, type BackendInfo } from "../agent-ipc";
export function mergeBackendSnapshots(current: readonly BackendInfo[], incoming: readonly BackendInfo[]) {
  const result = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    const prior = result.get(entry.id);
    if (!prior || (entry.availability?.revision ?? 0) >= (prior.availability?.revision ?? 0)) result.set(entry.id, entry);
  }
  return AGENT_BACKEND_ORDER.flatMap((id) => result.get(id) ?? []);
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
