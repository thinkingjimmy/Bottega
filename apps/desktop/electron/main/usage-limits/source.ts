/**
 * [INPUT]: Depends on the runtime registry port, environment identity, native readers and OpenCode credential metadata.
 * [OUTPUT]: Resolves and reconfirms main-owned quota targets, waits out an inconclusive authentication check for readers that cannot detect a logged-out CLI, reads through the warm channel pool and reports identity invalidation.
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
import { createQuotaChannelPool, type QuotaChannelPool, type QuotaDemandState } from "./channel";
import { quotaReaders } from "./readers";
import { opencodeCredentialIdentity } from "./readers/opencode/credentials";
import { QuotaReadError, type QuotaReadResult } from "./readers/common";
export type QuotaTarget = { runtime: ResolvedRuntime; identity: string; snapshot: BackendRuntimeSnapshot };
/** The slice of the runtime registry a quota read is allowed to use. */
export type QuotaRegistryPort = Pick<typeof backendRuntimeRegistry, "resolveForSpawn" | "confirmForSpawn" | "snapshot" | "waitForCheck" | "subscribe">;
export type QuotaSourcePort = {
  resolve(backend: AgentBackendId, signal: AbortSignal): Promise<QuotaTarget>;
  confirm(backend: AgentBackendId, target: QuotaTarget, signal: AbortSignal): Promise<boolean>;
  read(backend: AgentBackendId, target: QuotaTarget, signal: AbortSignal): Promise<QuotaReadResult>;
  subscribe(listener: (backend: AgentBackendId) => void): () => void;
  /** Quota demand for one Agent changed; a warm reader process follows it (09-18 PRD §4.5). */
  demand?(backend: AgentBackendId, state: QuotaDemandState): void | Promise<void>;
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
    environment: await runtimeEnvironmentIdentity(backend, snapshot.runtime), kimi,
    opencode: backend === "opencode" ? await opencodeCredentialIdentity() : undefined })).digest("hex");
}
/* Only a reader that cannot tell "logged out" from "no limits on this plan" needs the check:
   Claude's zero-prompt get_usage answers rate_limits_available: false to both. Codex
   (account === null), Kimi (/api/v1/auth -> unauthenticated) and OpenCode (credential
   metadata) each report needs-auth themselves, so they never pay for the wait. */
const AUTH_BLIND_READERS: ReadonlySet<AgentBackendId> = new Set(["claude"]);
/* For those readers, a read that starts while the availability check is still running asks an
   Agent that cannot answer; its empty envelope then reads as "unavailable" and hides the real
   recovery, which is a login. The pending check is cheap to wait for -- it happens before the
   read owns the clock -- and only a conclusion is acted on: "error" and "authenticated" still
   try, because the CLI may answer where the check could not. */
export async function conclusiveAuthStatus(registry: QuotaRegistryPort, backend: AgentBackendId, snapshot: BackendRuntimeSnapshot, signal: AbortSignal) {
  if (!AUTH_BLIND_READERS.has(backend)) return snapshot.authStatus;
  if (snapshot.authStatus !== "unknown" && snapshot.authStatus !== "checking") return snapshot.authStatus;
  const checking = registry.waitForCheck(backend);
  if (!checking) return snapshot.authStatus;
  await waitForSharedFlight(checking, signal);
  return registry.snapshot(backend).authStatus;
}
export function createNativeQuotaSource(registry: QuotaRegistryPort, pool: QuotaChannelPool = createQuotaChannelPool()): QuotaSourcePort {
  return {
    async resolve(backend, signal) {
      if (!quotaReaders[backend]) throw new QuotaReadError("unsupported");
      const snapshot = await waitForSharedFlight(registry.resolveForSpawn(backend, signal), signal);
      if (snapshot.runtimeStatus !== "installed") throw new QuotaReadError(snapshot.runtimeStatus === "missing" ? "not-installed" : snapshot.runtimeStatus === "unsupported" ? "unsupported" : "unavailable");
      if (await conclusiveAuthStatus(registry, backend, snapshot, signal) === "unauthenticated") throw new QuotaReadError("needs-auth");
      return { runtime: snapshot.runtime, identity: await identity(backend, snapshot), snapshot };
    },
    async confirm(backend, target, signal) {
      return await registry.confirmForSpawn(backend, target.snapshot, signal) &&
        target.identity === await identity(backend, target.snapshot);
    },
    read(backend, target, signal) {
      return pool.read(backend, target.runtime, target.identity, signal);
    },
    demand(backend, state) {
      return pool.demand(backend, state);
    },
    subscribe(listener) {
      const key = (snapshot: BackendRuntimeSnapshot) => JSON.stringify([snapshot.generation, snapshot.runtimeStatus,
        snapshot.availability?.probeGeneration, snapshot.authStatus === "unauthenticated"]);
      const keys = new Map(AGENT_BACKEND_ORDER.map((backend) => [backend, key(registry.snapshot(backend))]));
      return registry.subscribe((backend, snapshot) => {
        const next = key(snapshot);
        if (next === keys.get(backend)) return;
        keys.set(backend, next); listener(backend);
      });
    },
  };
}
export const nativeQuotaSource = createNativeQuotaSource(backendRuntimeRegistry);
