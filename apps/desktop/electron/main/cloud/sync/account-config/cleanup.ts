/**
 * [INPUT]: Depends on node:crypto and the DockConfigStore/sync-scope types only, so the pre-window cloud prepare chunk stays light.
 * [OUTPUT]: Provides the account-config scope keys, the detached (local-only) sync reset and AccountConfigCleanup, the late-bound `account-config` scope-cleanup port.
 * [POS]: cloud/sync/account-config boundary shared by prepare.ts (cleanup) and the coordinator; clears account-scoped Dock sync state only, never the working layout or system recovery records (INV-06).
 */
import { createHash } from "node:crypto";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { DockConfigRecord, DockConfigStore } from "../../../system-dock/store/config-store";
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
/** Every account-config scope key of one account starts with this prefix; cleanup and sealing match on it. */
export const accountConfigPrefix = (environment: string, userId: string) => `acct:${digest(JSON.stringify([environment, userId]))}:`;
/*
 * The binding manifest is part of the key: a base learned under one binding is never trusted by a later binding of
 * the same account (disable sync → enable again), even when the cleanup that should have cleared it never ran.
 */
export const accountConfigScopeKey = (environment: string, userId: string, manifestId: string) =>
  accountConfigPrefix(environment, userId) + digest(manifestId);
/** Leaves the working layout alone; an initialized layout is offered to whichever scope is admitted next. */
export function detachSync(record: DockConfigRecord) {
  Object.assign(record.sync, { scopeKey: null, configId: null, acknowledgedRevision: 0, base: null, candidate: null, conflict: null,
    unsupportedRemote: null, pending: record.layout.initialized });
}
export async function clearAccountConfigScope(store: DockConfigStore, scope: SyncScope) {
  const prefix = accountConfigPrefix(scope.environment, scope.userId);
  let cleared = false, sealed = 0;
  await store.updateSync(record => {
    if (record.sync.scopeKey?.startsWith(prefix)) { detachSync(record); cleared = true; }
    const kept = record.sync.sealed.filter(entry => !entry.sourceScope.startsWith(prefix));
    sealed = record.sync.sealed.length - kept.length; record.sync.sealed = kept;
  });
  return { attached: true, cleared, sealed };
}
/**
 * Created with the prepared runtime, before any Dock store exists. A cleanup that runs while no store is attached
 * (startup recovery) is remembered for this process and applied the moment a store attaches.
 */
export class AccountConfigCleanup {
  private store: DockConfigStore | null = null;
  private readonly deferred = new Map<string, SyncScope>();
  attach(store: DockConfigStore) {
    if (this.store) throw new Error("ACCOUNT_CONFIG_ALREADY_ATTACHED");
    this.store = store;
    const scopes = [...this.deferred.values()]; this.deferred.clear();
    const settled = (async () => { for (const scope of scopes) await clearAccountConfigScope(store, scope); })();
    return { settled, detach: () => { if (this.store === store) this.store = null; } };
  }
  async cleanupScope(scope: SyncScope) {
    if (!this.store) { this.deferred.set(accountConfigPrefix(scope.environment, scope.userId), scope); return { attached: false }; }
    return clearAccountConfigScope(this.store, scope);
  }
}
