/**
 * [INPUT]: Depends on the runtime registry port, environment identity and each Provider's quota hook (its identity and auth-blind facts) with the Providers that have one.
 * [OUTPUT]: Resolves and reconfirms main-owned quota targets (built-ins only: a package Provider's registry changes are no quota event), names the signed-in account's fingerprint (so a re-key under the same account keeps its reading), waits out an inconclusive authentication check (starting one this environment never ran) for readers that cannot detect a logged-out CLI, answers a custom route (read live from the Provider's hook, rechecking sign-in when it changed) as unsupported without a read, resolves the file that sets it (quotaRouteConfig), reads through the warm channel pool and reports identity invalidation (environment, runtime, sign-in or route changes; never a recheck attempt), and reports each completed same-facts recheck once.
 * [POS]: Production runtime port for the quota service; renderer inputs never select a CLI or account.
 */
import { createHash } from "node:crypto";
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import { backendRuntimeRegistry, quotaHookFor, quotaProviders } from "../backends";
import { builtinProviderCatalog, knownBackend } from "../../../shared/providers/catalog";
import type { BackendRuntimeSnapshot } from "../backends/runtime/runtime-registry";
import { runtimeEnvironmentIdentity } from "../backends/runtime/availability/scope";
import { waitForSharedFlight } from "../backends/jobs/supervised-command";
import type { ResolvedRuntime } from "../backends/types";
import { createQuotaChannelPool, type QuotaChannelPool, type QuotaDemandState } from "./channel";
import { QuotaReadError, type QuotaReadResult } from "./readers/common";
export type QuotaTarget = { runtime: ResolvedRuntime; identity: string; snapshot: BackendRuntimeSnapshot };
/** The slice of the runtime registry a quota read is allowed to use. */
export type QuotaRegistryPort = Pick<typeof backendRuntimeRegistry, "resolveForSpawn" | "confirmForSpawn" | "snapshot" | "waitForCheck" | "subscribe">
  & Partial<Pick<typeof backendRuntimeRegistry, "refreshIfNeeded" | "recheck" | "accountFingerprint">>;
export type QuotaSourcePort = {
  resolve(backend: AgentBackendId, signal: AbortSignal): Promise<QuotaTarget>;
  confirm(backend: AgentBackendId, target: QuotaTarget, signal: AbortSignal): Promise<boolean>;
  read(backend: AgentBackendId, target: QuotaTarget, signal: AbortSignal): Promise<QuotaReadResult>;
  /** `rekey`: the account may have changed. `recheck`: an availability check completed and concluded the same facts. */
  subscribe(listener: (backend: AgentBackendId, kind?: "rekey" | "recheck") => void): () => void;
  /** The signed-in account's fingerprint from the last sign-in check; null when signed out or when the Provider has none. */
  account?(backend: AgentBackendId): string | null;
  /** Quota demand for one Agent changed; a warm reader process follows it (09-18 PRD §4.5). */
  demand?(backend: AgentBackendId, state: QuotaDemandState, idleMs?: number): void | Promise<void>;
};
async function identity(backend: AgentBackendId, snapshot: BackendRuntimeSnapshot) {
  if (snapshot.runtimeStatus !== "installed") throw new QuotaReadError("not-installed");
  /* The Provider's own account facts sit under its id, so the hashed JSON is the same as when each was named here
     (an absent one is dropped by JSON.stringify): a key survives this move, and a warm channel is not rebuilt for it. */
  const extra = await quotaHookFor(backend)?.identity?.();
  return createHash("sha256").update(JSON.stringify({ generation: snapshot.generation, runtime: snapshot.runtime,
    environment: await runtimeEnvironmentIdentity(backend, snapshot.runtime), [backend]: extra })).digest("hex");
}
/* Only a reader that cannot tell "logged out" from "no limits on this plan" needs the check (its hook says authBlind):
   Claude's zero-prompt get_usage answers rate_limits_available: false to both. The others each report needs-auth
   themselves (Codex account === null, Kimi /api/v1/auth, OpenCode credential metadata), so they never pay for the wait. */
/* For those readers, a read that starts while the availability check is still running asks an
   Agent that cannot answer; its empty envelope then reads as "unavailable" and hides the real
   recovery, which is a login. The pending check is cheap to wait for -- it happens before the
   read owns the clock -- and only a conclusion is acted on: "error" and "authenticated" still
   try, because the CLI may answer where the check could not. */
export async function conclusiveAuthStatus(registry: QuotaRegistryPort, backend: AgentBackendId, snapshot: BackendRuntimeSnapshot, signal: AbortSignal) {
  if (!quotaHookFor(backend)?.authBlind) return snapshot.authStatus;
  /* The sign-in check also finds the route. One this environment never ran leaves both unknown, and nothing else starts it on the
     Usage page: the read would ask a CLI routed elsewhere and keep last week's subscription numbers under "Could not fetch limits". */
  if (registry.refreshIfNeeded && registry.snapshot(backend).availability?.lastCheckedAt === undefined) {
    await waitForSharedFlight(registry.refreshIfNeeded(backend).catch(() => undefined), signal);
    return registry.snapshot(backend).authStatus;
  }
  if (snapshot.authStatus !== "unknown" && snapshot.authStatus !== "checking") return snapshot.authStatus;
  const checking = registry.waitForCheck(backend);
  if (!checking) return snapshot.authStatus;
  await waitForSharedFlight(checking, signal);
  return registry.snapshot(backend).authStatus;
}
export function createNativeQuotaSource(registry: QuotaRegistryPort, pool: QuotaChannelPool = createQuotaChannelPool()): QuotaSourcePort {
  return {
    async resolve(backend, signal) {
      if (!quotaHookFor(backend)) throw new QuotaReadError("unsupported");
      const snapshot = await waitForSharedFlight(registry.resolveForSpawn(backend, signal), signal);
      if (snapshot.runtimeStatus !== "installed") throw new QuotaReadError(snapshot.runtimeStatus === "missing" ? "not-installed" : snapshot.runtimeStatus === "unsupported" ? "unsupported" : "unavailable", undefined, "runtime");
      let auth = await conclusiveAuthStatus(registry, backend, snapshot, signal);
      /* A custom route (a base URL, a cloud switch or an apiKeyHelper) bills that endpoint, not a subscription, so there are no
         account limits to read: Claude's get_usage answers rate_limits_available: false every time, which is not "try later".
         It is read now, not taken from the last sign-in check: the person edits settings.json and presses Refresh. When it no
         longer matches that check, the check runs again, so sign-in (and the Setup status) follow the file too. */
      const hook = quotaHookFor(backend);
      const recorded = registry.snapshot(backend).availability?.route === "custom" ? "custom" : "official";
      /* Only against a check that ran: there is nothing to disagree with before one, and conclusiveAuthStatus starts it. */
      const checked = registry.snapshot(backend).availability?.lastCheckedAt !== undefined;
      const route = hook?.route && checked ? await hook.route(snapshot.runtime).catch(() => "custom" as const) : recorded;
      if (route !== recorded && registry.recheck) {
        await waitForSharedFlight(registry.recheck(backend).catch(() => undefined), signal);
        auth = registry.snapshot(backend).authStatus;
      }
      if (route === "custom") throw new QuotaReadError("unsupported", undefined, "runtime");
      if (auth === "unauthenticated") throw new QuotaReadError("needs-auth", undefined, "runtime");
      return { runtime: snapshot.runtime, identity: await identity(backend, snapshot), snapshot };
    },
    async confirm(backend, target, signal) {
      return await registry.confirmForSpawn(backend, target.snapshot, signal) &&
        target.identity === await identity(backend, target.snapshot);
    },
    read(backend, target, signal) {
      return pool.read(backend, target.runtime, target.identity, signal);
    },
    demand(backend, state, idleMs) {
      return pool.demand(backend, state, idleMs);
    },
    account(backend) {
      return registry.accountFingerprint?.(backend) ?? null;
    },
    subscribe(listener) {
      /* What may mean another account (usage PRD §6.4): the environment generation, the runtime, sign-in, the route and the account
         fingerprint; the service clears the numbers only when the fingerprint changed (usage-limits/service.ts invalidate). A recheck
         attempt (probeGeneration) is not one -- the Agent menu rechecks on open, and that must not blank known numbers. */
      const key = (backend: AgentBackendId, snapshot: BackendRuntimeSnapshot) => JSON.stringify([snapshot.generation, snapshot.runtimeStatus,
        snapshot.authStatus === "unauthenticated", snapshot.availability?.route === "custom", registry.accountFingerprint?.(backend) ?? null]);
      // Evaluated at subscribe time over the static built-in catalog; d4's dynamic catalog will need it re-evaluated.
      const keys = new Map(quotaProviders().map((backend) => [backend, key(backend, registry.snapshot(backend))]));
      /* A completed recheck is reported once per probe, and only after it concluded: a verdict the quota read reached
         itself (Kimi's 401) is invisible to the registry, and this is the person's way of saying they fixed it. */
      const probes = new Map(quotaProviders().map((backend) => [backend, registry.snapshot(backend).availability?.probeGeneration]));
      return registry.subscribe((id, snapshot) => {
        const backend = knownBackend(builtinProviderCatalog, id);
        if (!backend || !keys.has(backend)) return; // a Provider without quota (every package Provider) has nothing to re-key
        const next = key(backend, snapshot);
        if (next !== keys.get(backend)) {
          keys.set(backend, next); probes.set(backend, snapshot.availability?.probeGeneration); listener(backend, "rekey");
          return;
        }
        const probe = snapshot.availability?.probeGeneration;
        if (snapshot.authStatus === "checking" || probe === undefined || probe === probes.get(backend)) return;
        probes.set(backend, probe); listener(backend, "recheck");
      });
    },
  };
}
export const nativeQuotaSource = createNativeQuotaSource(backendRuntimeRegistry);

/** The file that routes this Provider elsewhere, resolved in main for the runtime it would read with; null when it has none. */
export function quotaRouteConfig(backend: AgentBackendId, registry: Pick<QuotaRegistryPort, "snapshot"> = backendRuntimeRegistry) {
  const snapshot = registry.snapshot(backend);
  const hook = quotaHookFor(backend);
  return hook?.routeConfig && snapshot.runtimeStatus === "installed" ? hook.routeConfig(snapshot.runtime) : null;
}
