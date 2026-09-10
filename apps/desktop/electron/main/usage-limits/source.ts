/**
 * [INPUT]: Depends on the existing runtime registry, environment identity and native readers.
 * [OUTPUT]: Resolves and reconfirms main-owned quota targets, with observable identity invalidation.
 * [POS]: Production runtime port for the quota service; renderer inputs never select a CLI or account.
 */
import { createHash } from "node:crypto";
import { stat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../shared/agent-ipc";
import { backendRuntimeRegistry } from "../backends";
import type { BackendRuntimeSnapshot } from "../backends/runtime-registry";
import { runtimeEnvironmentIdentity } from "../backends/availability/scope";
import { resolveKimiCodeHome } from "../backends/kimi/home";
import { waitForSharedFlight } from "../backends/supervised-command";
import type { ResolvedRuntime } from "../backends/types";
import { quotaReaders } from "./readers";
import { QuotaReadError, type QuotaReadResult } from "./readers/common";
export type QuotaTarget = { runtime: ResolvedRuntime; identity: string; snapshot: BackendRuntimeSnapshot };
export type QuotaSourcePort = {
  resolve(backend: AgentBackendId, signal: AbortSignal): Promise<QuotaTarget>;
  confirm(backend: AgentBackendId, target: QuotaTarget, signal: AbortSignal): Promise<boolean>;
  read(backend: AgentBackendId, target: QuotaTarget, signal: AbortSignal): Promise<QuotaReadResult>;
  subscribe(listener: (backend: AgentBackendId) => void): () => void;
};
async function identity(backend: AgentBackendId, snapshot: BackendRuntimeSnapshot) {
  if (snapshot.runtimeStatus !== "installed") throw new QuotaReadError("not-installed");
  let kimi: unknown;
  if (backend === "kimi") {
    const home = await realpath(resolveKimiCodeHome()).catch(() => resolveKimiCodeHome());
    const config = await stat(join(home, "config.toml")).then((value) => [value.ino, value.size, value.mtimeMs], () => null);
    kimi = { home, config };
  }
  return createHash("sha256").update(JSON.stringify({ generation: snapshot.generation, runtime: snapshot.runtime,
    environment: await runtimeEnvironmentIdentity(backend, snapshot.runtime), kimi })).digest("hex");
}
export const nativeQuotaSource: QuotaSourcePort = {
  async resolve(backend, signal) {
    if (!quotaReaders[backend]) throw new QuotaReadError("unsupported");
    const snapshot = await waitForSharedFlight(backendRuntimeRegistry.resolveForSpawn(backend, signal), signal);
    if (snapshot.runtimeStatus !== "installed") throw new QuotaReadError(snapshot.runtimeStatus === "missing" ? "not-installed" : snapshot.runtimeStatus === "unsupported" ? "unsupported" : "unavailable");
    if (snapshot.authStatus === "unauthenticated") throw new QuotaReadError("needs-auth");
    return { runtime: snapshot.runtime, identity: await identity(backend, snapshot), snapshot };
  },
  async confirm(backend, target, signal) {
    return await backendRuntimeRegistry.confirmForSpawn(backend, target.snapshot, signal) &&
      target.identity === await identity(backend, target.snapshot);
  },
  read(backend, target, signal) {
    const reader = quotaReaders[backend];
    if (!reader) throw new QuotaReadError("unsupported");
    return reader(target.runtime, signal);
  },
  subscribe(listener) {
    const key = (snapshot: BackendRuntimeSnapshot) => JSON.stringify([snapshot.generation, snapshot.runtimeStatus,
      snapshot.availability?.probeGeneration, snapshot.authStatus === "unauthenticated"]);
    const keys = new Map(AGENT_BACKEND_ORDER.map((backend) => [backend, key(backendRuntimeRegistry.snapshot(backend))]));
    return backendRuntimeRegistry.subscribe((backend, snapshot) => {
      const next = key(snapshot);
      if (next === keys.get(backend)) return;
      keys.set(backend, next); listener(backend);
    });
  },
};
