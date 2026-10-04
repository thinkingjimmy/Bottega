/**
 * [INPUT]: Depends on the shared account-scope admission, the cloud transport (agentConfigs apply/directory/heads/get and the directory watch), the purpose-9 codec, the payload parser and AgentConfigStore.
 * [OUTPUT]: Provides AgentConfigSync: records belong to the signed-in account (not one sync approval of it, C2-01); pushes each pending edit of the signed-in account as one sealed record claimed before sealing (resent byte-identical after an unknown outcome), turns a lost race into the remote record plus a kept conflict, pulls changed heads when the directory revision moves (also after a failed push), parks another account's records instead of moving them, keeps a budget refusal as a permanent state, and wakes only on a person's edit, never on its own bookkeeping; reports through onUploadTarget whether an account can receive edits (what `pending` means to the interface).
 * [POS]: agent-configs' cloud side; the store stays the local truth and works signed out, this only confirms and adopts.
 * Stable default IDs reconcile within one account; a colliding signed-out edit is retained as a conflict.
 */
import { randomUUID } from "node:crypto";
import { agentConfigTombstone, openAgentConfig, sealAgentConfig } from "@ai-chat/cloud-protocol/agent-config/encrypted";
import type { CloudFunctionResult } from "@ai-chat/cloud-protocol";
import { encryptedAgentConfigSchema, type AgentConfigHead } from "@ai-chat/cloud-protocol/agent-config/model";
import { parseAgentConfigPayload } from "@ai-chat/cloud-protocol/agent-config/payload";
import type { AccountTransport } from "../cloud/runtime/transport/transport";
import type { CloudAccountService } from "../cloud/runtime/service";
import { accountScopeAdmission, type AdmissionPorts, type Admitted } from "../cloud/sync/account-config/admission";
import { accountConfigOwner, accountConfigPrefix } from "../cloud/sync/account-config/cleanup";
import { effectiveOf, type AgentConfigRecord, type AgentConfigStore } from "./store";
import { canonicalJson } from "@ai-chat/cloud-protocol";

/* Codes after which the frozen bytes can never be accepted; a new operation is sealed instead, once per pass. A changed
   encrypted space is one of them: only this account's records are ever sent under it (C-01), so the change is that
   account's own space moving (a cloud reset), and its configuration reseals into the new space. */
const DEAD = new Set(["operation-payload-mismatch", "sync-space-changed", "sync-integrity-failed"]);
const PUSH_ROUNDS = 50;
/* By shape, not `instanceof`: the transport's ConvexError may come from another copy of the package. */
const errorCode = (error: unknown) => error instanceof Error && "data" in error && typeof error.data === "string" ? error.data : null;
class Superseded extends Error { constructor() { super("agent-config-superseded"); } }
export type AgentConfigSyncPorts = AdmissionPorts & {
  account: AdmissionPorts["account"] & Pick<CloudAccountService, "subscribeIdentity" | "subscribeConnection">;
  transport: Pick<AccountTransport, "query" | "mutate" | "watchAgentConfigDirectory">;
  store: AgentConfigStore;
  own?(activity: { close(): Promise<void> }): () => void;
  report?(error: unknown): void;
  /** Whether an account can receive this computer's edits (signed in, even while offline or held); pending means nothing without one. */
  onUploadTarget?(present: boolean): void;
  now?(): number;
  retryMs?: { first: number; max: number };
};

export class AgentConfigSync {
  private generation = 0;
  private selectedKey = "";
  private watching: (() => void) | null = null;
  private scoped: (() => void) | null = null;
  private directoryRevision: number | null = null;
  private flight: Promise<void> | null = null;
  private again = false;
  /* An edit, a sign-in change or a connection change since the pass began; only these may run again before a failure's backoff. */
  private relevant = false;
  private resealed = new Set<string>();
  /* A deletion was confirmed (here or seen in a pull): a slot may be free, so budget refusals are sent again. */
  private freed = false;
  private closed = false;
  private failures = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly releases: (() => void)[] = [];
  constructor(private readonly ports: AgentConfigSyncPorts) {
    const wake = () => { this.relevant = true; this.wake(); };
    /* Only a person's edit is new work; sync's own writes (claims, unknown outcomes, adopted heads) must not start another
       pass, or a failing send retries at disk speed instead of waiting for its backoff (C-03). */
    this.releases.push(ports.account.subscribeIdentity(wake), ports.account.subscribeConnection(wake),
      ports.store.onChanged(origin => { if (origin === "edit") wake(); }));
    wake();
  }
  wake() {
    if (this.closed) return;
    if (this.flight) { this.again = true; return; }
    const flight = (async () => { do { this.again = false; await this.pass(); } while (this.again && !this.closed); })()
      .finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
  }
  /** The account a configuration made now belongs to, from the live sign-in rather than the file's scope, which a pass
      updates only after the change: none signed out; the signed-in account otherwise, bound or not, even offline (C2-01). */
  ownerScope(): string | null {
    const identity = this.ports.account.connectionIdentity();
    return identity.profile ? accountConfigPrefix(this.ports.config.environmentId, identity.profile.userId) : null;
  }
  /** Settles once no pass is running or queued. */
  async idle() { while (this.flight) await this.flight.catch(() => undefined); }
  async close() {
    this.closed = true; this.stop(); for (const release of this.releases.splice(0)) release();
    await this.flight?.catch(() => undefined);
  }

  private async pass() {
    const admission = accountScopeAdmission(this.ports);
    this.ports.onUploadTarget?.(admission.kind !== "local-only");
    if (admission.kind === "local-only") { this.stop(); if (admission.signedOut) await this.leaveScope(); return; }
    // Signed in, sync approved or not: the store follows the account, so its configurations stay shown and editable (C2-01).
    const owner = this.ownerScope();
    if (owner) await this.rescope(owner);
    if (admission.kind !== "admitted") { this.stop(); return; }
    if (admission.key !== this.selectedKey) this.start(admission);
    const generation = this.generation;
    const current = () => { if (this.closed || generation !== this.generation) throw new Superseded(); };
    this.relevant = false; this.resealed = new Set(); this.freed = false;
    try {
      await this.rescope(accountConfigOwner(admission.scopeKey)); current();
      /* A push that fails still pulls: other computers' changes must not wait on this computer's refused write (C-03). */
      let pushFailure: { error: unknown } | null = null;
      try { await this.push(admission, current); } catch (error) { if (error instanceof Superseded) throw error; pushFailure = { error }; }
      await this.pull(admission, current);
      if (this.freed) await this.retryRefused(admission);
      if (pushFailure) throw pushFailure.error;
      this.failures = 0;
    } catch (error) {
      if (error instanceof Superseded) return;
      this.ports.report?.(error);
      // A failed pass waits for its backoff; only a relevant change since it began runs it again sooner (C-03).
      this.again = this.relevant;
      const { first, max } = this.ports.retryMs ?? { first: 2_000, max: 60_000 };
      if (this.retry) clearTimeout(this.retry);
      this.retry = setTimeout(() => { this.retry = null; this.wake(); }, Math.min(max, first * 2 ** this.failures++));
      this.retry.unref?.();
    }
  }
  private start(admission: Admitted) {
    this.stop();
    this.selectedKey = admission.key;
    this.scoped = this.ports.own?.({ close: async () => { this.stop(); await this.flight?.catch(() => undefined); } }) ?? null;
    try {
      this.watching = this.ports.transport.watchAgentConfigDirectory?.(admission.header, value => {
        if (value.revision !== this.directoryRevision) this.wake();
      }, error => this.ports.report?.(error)) ?? null;
    } catch (error) { this.ports.report?.(error); }
  }
  private stop() {
    this.generation++; this.selectedKey = ""; this.directoryRevision = null;
    this.watching?.(); this.watching = null; this.scoped?.(); this.scoped = null;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
  }
  /* A record belongs to the account it was made or received under (C-01), not to one sync approval of it (C2-01): the
     same account coming back through a new approval, or after Disable, finds its records, and pending bytes sealed under
     the old approval reseal through `sync-space-changed` if the space moved. On a change of account, records of the old
     account that the server already holds and that carry no local work are dropped (they come back with that account);
     the rest stay on disk, parked, neither shown, run nor sent under another account. Only a record made signed out
     (no owner) goes with the next account that signs in. Owners stored as a full approval key are read as their account. */
  private leaveScope() { return this.rescope(null); }
  private async rescope(owner: string | null) {
    const settled = (state: { scopeKey: string | null; records: AgentConfigRecord[] }) => state.scopeKey === owner &&
      state.records.every(record => record.owner === null ? owner === null : record.owner === accountConfigOwner(record.owner));
    if (settled(this.ports.store.snapshot())) return;
    await this.ports.store.update(state => {
      if (settled(state)) return;
      for (const record of state.records) if (record.owner !== null) record.owner = accountConfigOwner(record.owner);
      const previous = state.scopeKey === null ? null : accountConfigOwner(state.scopeKey);
      if (previous !== owner) state.records = state.records.filter(record => !(previous !== null && record.owner === previous && record.head &&
        !record.pending && !record.queued && !record.conflict));
      if (owner !== null) for (const record of [...state.records]) if (record.owner === null) {
        const owned = state.records.find(item => item.owner === owner && item.configId === record.configId);
        if (!owned) { record.owner = owner; continue; }
        const local = effectiveOf(record), current = effectiveOf(owned);
        // Returning to an account may collide with a signed-out default. Keep its edited intent for recovery.
        if (canonicalJson(local.payload) !== canonicalJson(current.payload)) {
          owned.conflict = { payload: local.payload, at: this.ports.now?.() ?? Date.now() };
        }
        state.records = state.records.filter(item => item !== record);
      }
      state.scopeKey = owner;
    }, "sync");
  }

  /** Puts refused writes back in line; a person's-edit origin runs the next pass, which sends them. */
  private retryRefused(admission: Admitted) {
    return this.ports.store.update(state => {
      for (const record of state.records) if (record.owner === accountConfigOwner(admission.scopeKey) && record.pending?.state === "refused")
        record.pending.state = record.pending.sealed ? "sent" : "prepared";
    }, "edit");
  }
  /** Sends until nothing sendable is left: an applied write can promote the edit queued behind it. */
  private async push(admission: Admitted, current: () => void) {
    const sendable = () => this.ports.store.snapshot().records.filter(record => record.owner === accountConfigOwner(admission.scopeKey) && record.pending &&
      record.pending.state !== "refused").map(record => `${record.configId}\u0000${record.pending!.operationId}`);
    const tried = new Set<string>();
    for (let round = 0; round < PUSH_ROUNDS; round++) {
      const next = sendable().filter(key => !tried.has(key));
      if (!next.length) return;
      for (const key of next) {
        tried.add(key);
        const record = this.ports.store.read(key.split("\u0000")[0]!);
        if (record?.pending) await this.send(admission, record, current);
      }
    }
  }
  private async send(admission: Admitted, record: AgentConfigRecord, current: () => void) {
    const pending = record.pending!, configId = record.configId;
    const mine = (state: { records: AgentConfigRecord[] }) => {
      const found = state.records.find(item => item.configId === configId && item.owner === record.owner);
      return found?.pending?.operationId === pending.operationId ? found : null;
    };
    // Deleting a configuration that never reached the server needs no server at all.
    if (!pending.payload && !record.head) {
      await this.ports.store.update(state => { const found = mine(state); if (found) state.records = state.records.filter(item => item !== found); }, "sync");
      return;
    }
    let sealed = pending.sealed;
    if (!sealed) {
      /* Claimed before sealing (C-02): an edit or delete made while this encrypts queues behind it instead of replacing an
         operation whose bytes are about to leave. If it was replaced before the claim, nothing is sent. */
      const claimed = await this.ports.store.update(state => { const found = mine(state); if (!found?.pending) return false; found.pending.state = "sent"; return true; }, "sync");
      if (!claimed) return;
      const identity = { configId, configSchemaVersion: 1, revision: pending.revision, operationId: pending.operationId, producerClass: pending.producerClass };
      const value = pending.payload ? await sealAgentConfig(identity, pending.payload, admission.crypto) : agentConfigTombstone(identity, admission.crypto);
      current();
      const bytes = JSON.stringify(value);
      if (!await this.ports.store.update(state => { const found = mine(state); if (!found?.pending) return false; found.pending.sealed = bytes; return true; }, "sync")) return;
      sealed = bytes;
    }
    const frozen = encryptedAgentConfigSchema.parse(JSON.parse(sealed));
    let receipt;
    try { receipt = await this.ports.transport.mutate("agentConfigs/sync:apply", { ...admission.header, record: frozen }); }
    catch (error) {
      const code = errorCode(error);
      /* The budget is a state, not a retry (C-03): it waits for a deletion to free a slot. Dead bytes reseal once per pass. */
      const refused = code === "agent-config-budget", reseal = !refused && code !== null && DEAD.has(code) && !this.resealed.has(configId);
      if (reseal) this.resealed.add(configId);
      await this.ports.store.update(state => {
        const found = mine(state);
        if (found?.pending) Object.assign(found.pending, refused ? { state: "refused" } : reseal ? { operationId: randomUUID(), sealed: null, state: "prepared" } : { state: "unknown" });
      }, "sync").catch(() => undefined);
      if (refused || reseal) { this.ports.report?.(error); return; }
      throw error;
    }
    current();
    if (receipt.status === "applied") {
      if (!pending.payload) this.freed = true;
      await this.ports.store.update(state => {
        const found = mine(state); if (!found) return;
        found.head = { revision: receipt.revision, producerClass: pending.producerClass, tombstone: !pending.payload,
          ciphertextHash: frozen.packet?.ciphertextHash ?? null, writerDeviceId: this.ports.deviceId };
        found.payload = pending.payload;
        found.pending = found.queued ? { operationId: randomUUID(), revision: receipt.revision + 1, producerClass: found.queued.producerClass,
          payload: found.queued.payload, sealed: null, state: "prepared" } : null;
        found.queued = null;
      }, "sync");
      return;
    }
    // Lost a race (A10): the remote record wins here and the local edit is kept for the user to reapply, never dropped silently.
    const remote = await this.remoteRecord(admission, configId, receipt.current, current);
    await this.ports.store.update(state => {
      const found = mine(state); if (!found) return;
      const payload = (found.queued ?? found.pending!).payload;
      if (canonicalJson(payload) !== canonicalJson(remote.payload)) found.conflict = { payload, at: this.ports.now?.() ?? Date.now() };
      found.head = remote.head; found.payload = remote.payload; found.pending = null; found.queued = null;
    }, "sync");
  }
  private async remoteRecord(admission: Admitted, configId: string, current: { revision: number; ciphertextHash: string | null; tombstone: boolean } | null,
    fence: () => void) {
    if (!current || current.tombstone) return { head: current ? { revision: current.revision, producerClass: "desktop" as const, tombstone: true,
      ciphertextHash: null, writerDeviceId: "remote" } : null, payload: null };
    const raw = await this.ports.transport.query("agentConfigs/sync:get", { ...admission.header, configId }); fence();
    if (!raw?.packet) return { head: null, payload: null };
    const payload = parseAgentConfigPayload(await openAgentConfig(raw, { configId }, admission.crypto)); fence();
    return { head: { revision: raw.revision, producerClass: raw.producerClass, tombstone: false, ciphertextHash: raw.packet.ciphertextHash, writerDeviceId: "remote" },
      payload };
  }

  private async pull(admission: Admitted, current: () => void) {
    const directory = await this.ports.transport.query("agentConfigs/sync:directory", admission.header); current();
    if (directory.revision === this.directoryRevision) return;
    let cursor: string | null = null;
    do {
      const page: CloudFunctionResult<"agentConfigs/sync:heads"> = await this.ports.transport.query("agentConfigs/sync:heads", { ...admission.header, cursor }); current();
      for (const head of page.items) await this.integrate(admission, head, current);
      cursor = page.cursor;
    } while (cursor);
    this.directoryRevision = directory.revision;
  }
  /** A newer remote head replaces the confirmed record; a local pending edit stays and will meet the new revision as a conflict. */
  private async integrate(admission: Admitted, head: AgentConfigHead, current: () => void) {
    const local = this.ports.store.read(head.configId);
    if (local?.head && local.head.revision >= head.revision) return;
    const remote = head.tombstone ? { head: { revision: head.revision, producerClass: head.producerClass, tombstone: true, ciphertextHash: null,
      writerDeviceId: head.writerDeviceId }, payload: null } : await this.remoteRecord(admission, head.configId,
      { revision: head.revision, ciphertextHash: head.ciphertextHash, tombstone: false }, current);
    if (!remote.head) return;
    const confirmed = { ...remote.head, writerDeviceId: head.writerDeviceId };
    if (confirmed.tombstone) this.freed = true;
    await this.ports.store.update(state => {
      const owner = accountConfigOwner(admission.scopeKey);
      let found = state.records.find(item => item.configId === head.configId && item.owner === owner);
      if (!found) { found = { configId: head.configId, owner, head: null, payload: null, pending: null, queued: null, conflict: null }; state.records.push(found); }
      if (found.owner !== owner || found.head && found.head.revision >= confirmed.revision) return;
      found.head = confirmed; found.payload = remote.payload;
    }, "sync");
  }
}
