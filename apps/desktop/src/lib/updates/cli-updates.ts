/**
 * [INPUT]: Depends on shared BackendInfo facts, the CliUpdateResult contract, version comparison and the setup-client updateBackendCli command
 * [OUTPUT]: Provides cliUpdateStore (in-flight and failed provider updates that outlive the page) and describeCliUpdate, the pure per-row verdict
 * [POS]: Provider half of Settings › Updates' conclusion layer; the Bottega row stays in update-view.ts, the rows only render these verdicts
 */

import type { AgentBackendId, BackendInfo } from "../../../shared/agent-ipc";
import type { CliUpdateResult } from "../../../shared/setup-ipc";
import { updateBackendCli } from "../setup-client";

type Failure = Extract<CliUpdateResult, { ok: false }> & { fromVersion?: string };
export type CliUpdateSnapshot = Readonly<{
  updating: ReadonlySet<AgentBackendId>;
  failures: Readonly<Partial<Record<AgentBackendId, Failure>>>;
}>;

/* Module-level: an update keeps running while the user leaves the page, and the row must still know when they return. */
export function createCliUpdateStore(run: (backend: AgentBackendId) => Promise<CliUpdateResult> = updateBackendCli) {
  let snapshot: CliUpdateSnapshot = { updating: new Set(), failures: {} };
  const listeners = new Set<() => void>();
  const publish = (next: CliUpdateSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const update = async (backend: AgentBackendId, fromVersion?: string) => {
    if (snapshot.updating.has(backend)) return;
    const { [backend]: _cleared, ...failures } = snapshot.failures;
    publish({ updating: new Set(snapshot.updating).add(backend), failures });
    const result = await run(backend).catch((cause): CliUpdateResult =>
      ({ ok: false, reason: "failed", log: cause instanceof Error ? cause.message : String(cause) }));
    const updating = new Set(snapshot.updating);
    updating.delete(backend);
    publish({ updating, failures: result.ok ? snapshot.failures : { ...snapshot.failures, [backend]: { ...result, fromVersion } } });
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    update,
  };
}

export const cliUpdateStore = createCliUpdateStore();

export type CliUpdateVerdict =
  | { kind: "updating" }
  | { kind: "failed"; failure: Failure }
  | { kind: "available"; latest: string; required: boolean }
  | { kind: "current" }
  | { kind: "unknown" };

/** Only installed CLIs are rows: a missing Provider is a setup task, not an update. */
export const isUpdatableCli = (backend: BackendInfo) =>
  (backend.runtimeStatus === "installed" || backend.runtimeStatus === "unsupported") && Boolean(backend.version);

export function describeCliUpdate(backend: BackendInfo, state: CliUpdateSnapshot): CliUpdateVerdict {
  if (state.updating.has(backend.id)) return { kind: "updating" };
  const failure = state.failures[backend.id];
  /* A failure belongs to the version it tried to leave; once the CLI moved on (e.g. updated in Terminal) it is stale. */
  if (failure && failure.fromVersion === backend.version) return { kind: "failed", failure };
  const required = backend.runtimeStatus === "unsupported";
  if (backend.updateAvailable || required) {
    return { kind: "available", latest: backend.latestVersion ?? backend.minimumVersion ?? "", required };
  }
  return backend.latestVersion ? { kind: "current" } : { kind: "unknown" };
}
