/**
 * [INPUT]: Depends on DurableJson, account ownership, crypto and Agent configuration schemas.
 * [OUTPUT]: Provides AgentConfigStore, effectiveOf, activeRecords and isActive; reads and create-if-absent edits scope stable IDs to the current account.
 * [POS]: Durable local configuration authority shared by the service and encrypted sync coordinator.
 */
import { accountConfigOwner } from "../cloud/sync/account-config/cleanup";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { agentConfigPayloadSchema, type AgentConfigPayload } from "@ai-chat/cloud-protocol/agent-config/payload";
import { producerClassSchema } from "@ai-chat/cloud-protocol/agent-config/model";
import { DurableJson } from "../persistence/durable-json";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const headSchema = z.object({ revision: z.number().int().positive(), producerClass: producerClassSchema, tombstone: z.boolean(),
  ciphertextHash: digest.nullable(), writerDeviceId: z.string().min(1) }).strict();
/* A pending edit targets `base + 1`; `sealed` is the exact record sent, so a resend after an unknown outcome is byte-identical.
   `sent` is claimed before sealing (C-02), so an edit made meanwhile queues behind it. `refused`: the account is at its
   configuration budget (C-03); it waits for a confirmed deletion to free a slot, and, never applied, a new edit replaces it. */
const pendingSchema = z.object({ operationId: z.string().uuid(), revision: z.number().int().positive(), producerClass: producerClassSchema,
  payload: agentConfigPayloadSchema.nullable(), sealed: z.string().nullable(), state: z.enum(["prepared", "sent", "unknown", "refused"]) }).strict();
const desiredSchema = z.object({ payload: agentConfigPayloadSchema.nullable(), producerClass: producerClassSchema }).strict();
/* `owner` is the account scope a record was made or received under; null only for one made signed out, which follows the
   next account (C-01). A record of another account stays on disk, parked, and is neither shown, run nor sent. */
const recordSchema = z.object({ configId: z.string().min(1).max(128), owner: z.string().nullable().default(null), head: headSchema.nullable(), payload: agentConfigPayloadSchema.nullable(),
  pending: pendingSchema.nullable(), queued: desiredSchema.nullable(), conflict: z.object({ payload: agentConfigPayloadSchema.nullable(), at: z.number().int() }).strict().nullable() }).strict();
const fileSchema = z.object({ schemaVersion: z.literal(1), scopeKey: z.string().nullable(), records: z.array(recordSchema) }).strict();
export type AgentConfigRecord = z.infer<typeof recordSchema>;
export type AgentConfigStoreFile = z.infer<typeof fileSchema>;

export class AgentConfigStore {
  private readonly file: DurableJson<AgentConfigStoreFile>;
  private readonly listeners = new Set<(origin: WriteOrigin) => void>();
  constructor(userData: string) {
    this.file = new DurableJson(join(userData, "agent-configs", "configs.json"), fileSchema, () => ({ schemaVersion: 1, scopeKey: null, records: [] }));
  }
  initialize() { return this.file.initialize(); }
  closeAndFlush() { return this.file.closeAndFlush(); }
  onChanged(listener: (origin: WriteOrigin) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot() { return this.file.snapshot(); }
  read(configId: string, owner?: string | null) {
    return this.file.read(state => activeRecords({ ...state, scopeKey: owner === undefined ? state.scopeKey : owner }).find(record => record.configId === configId) ?? null);
  }

  /** Runs one transition on the whole file; listeners hear about it once the write is durable. A transition that changes
      nothing writes nothing and tells no one (C-03: a retry that rewrote the same "unknown" used to wake sync at disk speed). */
  async update<R>(change: (state: AgentConfigStoreFile) => R, origin: WriteOrigin = "edit"): Promise<R> {
    const before = JSON.stringify(this.file.snapshot()), trial = structuredClone(this.file.snapshot()), preview = change(trial);
    if (JSON.stringify(trial) === before) return preview;
    const result = await this.file.mutate(change);
    for (const listener of this.listeners) listener(origin);
    return result;
  }

  /**
   * Records a local edit; a new record belongs to `owner`, the account signed in when it is made (none signed out). Before it is sent the pending edit is simply replaced; once its bytes left the machine they
   * stay frozen for a resend, and the newer edit waits in `queued` until that outcome is known.
   */
  edit(configId: string, next: { payload: AgentConfigPayload | null; producerClass: "desktop" | "draft" }, owner?: string | null, onlyIfAbsent = false) {
    return this.update(state => {
      const scopeKey = owner === undefined ? state.scopeKey : owner;
      let record = activeRecords({ ...state, scopeKey }).find(item => item.configId === configId);
      if (!record) { record = { configId, owner: scopeKey, head: null, payload: null, pending: null, queued: null, conflict: null }; state.records.push(record); }
      else if (onlyIfAbsent) return record;
      const effective = effectiveOf(record);
      if (!next.payload && !effective.payload) throw new Error(effective.deleted ? "agent-config-deleted" : "agent-config-not-found");
      if (record.pending && (record.pending.state === "sent" || record.pending.state === "unknown")) record.queued = next;
      else record.pending = { operationId: randomUUID(), revision: (record.head?.revision ?? 0) + 1, producerClass: next.producerClass,
        payload: next.payload, sealed: null, state: "prepared" };
      return record;
    });
  }
}

export type WriteOrigin = "edit" | "sync";
/** A record belongs to the account the file is on, or was made signed out and goes with whichever account comes next. */
export const isActive = (state: Pick<AgentConfigStoreFile, "scopeKey">, record: Pick<AgentConfigRecord, "owner">) =>
  record.owner === null || state.scopeKey !== null && accountConfigOwner(record.owner) === accountConfigOwner(state.scopeKey);
export const activeRecords = (state: AgentConfigStoreFile) => state.records.filter(record => isActive(state, record));

/** What this computer should show and run: the newest local intent, else the confirmed record. */
export function effectiveOf(record: AgentConfigRecord) {
  const intent = record.queued ?? record.pending;
  if (intent) return { payload: intent.payload, producerClass: intent.producerClass, deleted: !intent.payload, pending: true };
  return { payload: record.payload, producerClass: record.head?.producerClass ?? "desktop", deleted: Boolean(record.head?.tombstone), pending: false };
}
