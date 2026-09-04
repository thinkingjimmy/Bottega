/**
 * [INPUT]: Depends on zod, DurableJson, MemorySpaceGate, core domain/scope and stable canonical digest
 * [OUTPUT]: Provides the Policy v4 durable store, installation-scoped owner/shared generations, consent bindings, queries, backfill grants, disable/revoke mutations, and immutable owner-effect receipts
 * [POS]: The only permanent source of truth for main/memory/policy; Delivery only consume quick photos and receipts and prohibits reverse reading authorizations
 */

import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  MEMORY_SHARING_MODES,
  type MemorySharingMode,
} from "../../../../shared/settings-ipc";
import {
  DurableJson,
} from "../../persistence/durable-json";
import {
  freezeMemoryValue,
  memorySpaceId,
  type MemoryScopeSubject,
  type MemorySpaceRef,
} from "../core/domain";
import { memorySpaceForSubject } from "../core/memory-scope";

const id = z.string().min(1).max(256);
const revision = z.number().int().nonnegative();
const timestamp = z.number().int().nonnegative();
const sharingModeSchema = z.enum(MEMORY_SHARING_MODES);

const consentEpochSchema = z
  .object({
    id,
    scopePolicyId: id,
    scopePolicyRevision: revision,
    providerDataInstanceId: id,
    providerId: id,
    extractionHostname: z.string().min(1).max(512),
    extractionModel: z.string().min(1).max(512),
    sharingMode: sharingModeSchema,
    sharingGeneration: z.number().int().positive(),
    purpose: z.enum(["live", "configuration", "rebuild"]),
    effectiveAt: timestamp,
    createdAt: timestamp,
    revokedAt: timestamp.nullable(),
  })
  .strict();

const backfillGrantCommon = {
    id,
    memorySpaceId: id,
    providerDataInstanceId: id,
    consentEpochId: id,
    previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: timestamp,
    revokedAt: timestamp.nullable(),
};
const chatBackfillGrantSchema = z
  .object({
    ...backfillGrantCommon,
    boundary: z.literal("chat").default("chat"),
    chatIncarnations: z.array(id).max(2_000),
    upperSeqBySession: z.record(id, revision),
    upperTime: timestamp,
    lowerTime: timestamp.nullable(),
  })
  .strict();
const foreignBackfillGrantSchema = z.object({
  ...backfillGrantCommon,
  boundary: z.literal("foreign-snapshot"),
  chatIncarnations: z.array(id).max(2_000).default([]),
  upperSeqBySession: z.record(id, revision).default({}),
  lowerTime: timestamp.nullable().default(null),
  snapshotId: id,
  snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSessionKey: id,
  upperSeq: revision,
  upperTime: timestamp,
}).strict();
const backfillGrantSchema = z.union([
  chatBackfillGrantSchema,
  foreignBackfillGrantSchema,
]);

const tombstoneSchema = z
  .object({
    sourceSessionKey: id,
    memorySpaceId: id,
    operationId: id,
    at: timestamp,
  })
  .strict();

const receiptSchema = z
  .object({
    operationId: id,
    owner: z.literal("policy"),
    effectKind: id,
    subjectRef: id,
    spaceId: id,
    beforeRevision: revision,
    afterRevision: revision,
    committedAt: timestamp,
    receiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    generation: z.number().int().positive().nullable().default(null),
  })
  .strict();

const stateSchema = z
  .object({
    schemaVersion: z.literal(4),
    revision,
    revocationRevision: revision,
    scopeOwnerId: id,
    sharingGeneration: z.number().int().positive(),
    pausedAt: timestamp.nullable(),
    activeConsentEpochId: id.nullable(),
    consentEpochs: z.record(id, consentEpochSchema),
    scopeGenerations: z.record(
      id,
      z
        .object({ generation: z.number().int().positive(), revision })
        .strict()
    ),
    backfillGrants: z.record(id, backfillGrantSchema),
    tombstones: z.record(id, tombstoneSchema),
    effects: z.record(id, receiptSchema),
  })
  .strict();

export type ConsentEpoch = z.infer<typeof consentEpochSchema>;
export type BackfillGrant = z.infer<typeof backfillGrantSchema>;
export type ChatBackfillGrant = z.infer<typeof chatBackfillGrantSchema>;
export type ForeignBackfillGrant = z.infer<typeof foreignBackfillGrantSchema>;
type BackfillGrantCreate =
  | (Omit<ChatBackfillGrant, "createdAt" | "revokedAt" | "boundary"> & { boundary?: "chat" })
  | Omit<ForeignBackfillGrant, "createdAt" | "revokedAt">;
export type PolicyOwnerEffectReceipt = z.infer<typeof receiptSchema>;
export type MemoryPolicyState = z.infer<typeof stateSchema>;

export type PublishedPolicySnapshot = Readonly<{
  initialized: boolean;
  failure: "policy-store" | null;
  state: Readonly<MemoryPolicyState>;
}>;

function emptyPolicyState(): MemoryPolicyState {
  return {
    schemaVersion: 4,
    revision: 0,
    revocationRevision: 0,
    scopeOwnerId: `scope_${randomUUID().replaceAll("-", "")}`,
    sharingGeneration: 1,
    pausedAt: null,
    activeConsentEpochId: null,
    consentEpochs: {},
    scopeGenerations: {},
    backfillGrants: {},
    tombstones: {},
    effects: {},
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)])
  );
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function subjectKey(subject: MemoryScopeSubject) {
  if (subject.kind === "project") return `project:${subject.projectId}`;
  if (subject.kind === "chat") {
    return `chat:${subject.chatId}:${subject.incarnationId}`;
  }
  return `${subject.kind}:${subject.scopeOwnerId}`;
}

export class MemoryPolicyStore {
  private readonly ledger: DurableJson<MemoryPolicyState>;
  private published: PublishedPolicySnapshot = Object.freeze({
    initialized: false,
    failure: null,
    state: Object.freeze(emptyPolicyState()),
  });

  constructor(readonly root: string) {
    this.ledger = new DurableJson(
      join(root, "policy-v3.json"),
      stateSchema,
      emptyPolicyState
    );
  }

  get filePath() {
    return this.ledger.filePath;
  }

  async initialize() {
    /* 无真实用户：v3 不猜共享授权，直接断代为空 v4；provider 安装与 secret
       在 Policy 根之外，因此不会被这次安全归零触碰。读不出的档由 DurableJson
       自己隔离重建；这里只把「曾经隔离」如实登记为 policy-store 失败。 */
    const { quarantined } = await this.ledger.initialize((raw) =>
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      (raw as { schemaVersion?: unknown }).schemaVersion === 3
        ? emptyPolicyState()
        : undefined
    );
    await this.compactLedger();
    this.publish(this.ledger.snapshot(), quarantined ? "policy-store" : null);
    return this.snapshot();
  }

  snapshot(): PublishedPolicySnapshot {
    return this.published;
  }

  activeConsent(snapshot = this.published) {
    const epochId = snapshot.state.activeConsentEpochId;
    const epoch = epochId ? snapshot.state.consentEpochs[epochId] : undefined;
    return epoch?.revokedAt === null && epoch.purpose === "live" ? epoch : null;
  }

  /** pause 会撤销 admission capability，但观测仍需投影暂停前的最后范围。
      故意不过滤 revokedAt：pause() 正是把活跃 epoch 撤销掉的那一步，加上
      `revokedAt === null` 会让暂停期的观测三元整个消失。 */
  latestLiveConsent(snapshot = this.published) {
    return Object.values(snapshot.state.consentEpochs)
      .filter((epoch) => epoch.purpose === "live")
      .sort((left, right) =>
        right.scopePolicyRevision - left.scopePolicyRevision
      )[0] ?? null;
  }

  /** configuration/rebuild capability 只服务收敛或回灌，绝不能冒充 live admission。 */
  currentConsent(snapshot = this.published) {
    const epochId = snapshot.state.activeConsentEpochId;
    const epoch = epochId ? snapshot.state.consentEpochs[epochId] : undefined;
    return epoch?.revokedAt === null ? epoch : null;
  }

  generationFor(subject: MemoryScopeSubject, snapshot = this.published) {
    if (subject.kind !== "project") return 1;
    return snapshot.state.scopeGenerations[subjectKey(subject)]?.generation ?? 1;
  }

  generationSnapshot(subject: MemoryScopeSubject, snapshot = this.published) {
    return snapshot.state.scopeGenerations[subjectKey(subject)] ?? {
      generation: 1,
      revision: 0,
    };
  }

  spaceFor(subject: MemoryScopeSubject, snapshot = this.published) {
    return memorySpaceForSubject(
      subject,
      this.generationFor(subject, snapshot),
      snapshot.state.sharingGeneration
    );
  }

  scopeOwnerId(snapshot = this.published) {
    return snapshot.state.scopeOwnerId;
  }

  nextSharingGeneration(snapshot = this.published) {
    return snapshot.state.sharingGeneration + 1;
  }

  async createConsent(input: {
    operationId: string;
    providerDataInstanceId: string;
    providerId: string;
    extractionHostname: string;
    extractionModel: string;
    sharingMode: MemorySharingMode;
    effectiveAt: number;
    silent?: boolean;
    advanceSharing?: boolean;
    backfillGrants?: ReadonlyArray<
      | (Omit<ChatBackfillGrant, "createdAt" | "revokedAt" | "consentEpochId" | "boundary"> & { boundary?: "chat" })
      | Omit<ForeignBackfillGrant, "createdAt" | "revokedAt" | "consentEpochId">
    >;
    purpose?: "live" | "configuration" | "rebuild";
    effectKind?: "consent-resume";
  }) {
    return this.effect({
      operationId: input.operationId,
      effectKind: input.effectKind ?? (input.purpose && input.purpose !== "live"
        ? `consent-${input.purpose}`
        : input.silent
          ? "consent-model-change"
          : "consent-create"),
      subjectRef: "scope-policy:manual-v1",
      spaceId: "scope-policy:manual-v1",
      payload: input,
      mutate: (state, now) => {
        const purpose = input.purpose ?? "live";
        if (input.advanceSharing) state.sharingGeneration += 1;
        const epochId = `consent_${randomUUID().replaceAll("-", "")}`;
        state.revocationRevision += 1;
        state.consentEpochs[epochId] = {
          id: epochId,
          scopePolicyId: "manual-v1",
          scopePolicyRevision: state.revision + 1,
          providerDataInstanceId: input.providerDataInstanceId,
          providerId: input.providerId,
          extractionHostname: input.extractionHostname,
          extractionModel: input.extractionModel,
          sharingMode: input.sharingMode,
          sharingGeneration: state.sharingGeneration,
          purpose,
          effectiveAt: input.effectiveAt,
          createdAt: now,
          revokedAt: null,
        };
        for (const grant of input.backfillGrants ?? []) {
          state.backfillGrants[grant.id] = {
            boundary: "chat",
            ...grant,
            consentEpochId: epochId,
            createdAt: now,
            revokedAt: null,
          };
        }
        /* rebuild capability 只服务 job（grants 以 epochId 显式隔离），
           绝不占据 admission 槽位——否则暂停/恢复必与 job 授权互相踩踏。 */
        if (purpose !== "rebuild") {
          this.revokeActive(state, now);
          state.activeConsentEpochId = epochId;
        }
        if (purpose === "live") state.pausedAt = null;
      },
    });
  }

  pause(operationId: string) {
    return this.effect({
      operationId,
      effectKind: "pause",
      subjectRef: "scope-policy:manual-v1",
      spaceId: "scope-policy:manual-v1",
      payload: {},
      mutate: (state, now) => {
        state.revocationRevision += 1;
        this.revokeActive(state, now);
        state.pausedAt = now;
      },
    });
  }

  /** disable 是撤销边：Epoch 必须在 Settings 关闭前闭合，否则该窗口会被
      未来 rebuild 的区间重建解释成已授权历史。 */
  revokeForDisable(operationId: string) {
    return this.effect({
      operationId,
      effectKind: "consent-disable",
      subjectRef: "scope-policy:manual-v1",
      spaceId: "scope-policy:manual-v1",
      payload: {},
      mutate: (state, now) => {
        state.revocationRevision += 1;
        this.revokeActive(state, now);
        state.pausedAt = null;
      },
    });
  }

  resume(input: {
    operationId: string;
    providerDataInstanceId: string;
    providerId: string;
    extractionHostname: string;
    extractionModel: string;
    sharingMode: MemorySharingMode;
    effectiveAt: number;
  }) {
    return this.createConsent({ ...input, effectKind: "consent-resume" });
  }

  bumpRevocation(operationId: string, effectKind: string, spaceId: string) {
    return this.effect({
      operationId,
      effectKind,
      subjectRef: spaceId,
      spaceId,
      payload: {},
      mutate: (state) => {
        state.revocationRevision += 1;
      },
    });
  }

  tombstone(input: {
    operationId: string;
    sourceSessionKey: string;
    memorySpaceId: string;
  }) {
    return this.effect({
      operationId: input.operationId,
      effectKind: "source-tombstone",
      subjectRef: input.sourceSessionKey,
      spaceId: input.memorySpaceId,
      payload: input,
      mutate: (state, now) => {
        state.revocationRevision += 1;
        state.tombstones[input.sourceSessionKey] = {
          ...input,
          at: now,
        };
      },
    });
  }

  addBackfillGrant(input: BackfillGrantCreate) {
    return this.effect({
      operationId: input.id,
      effectKind: "backfill-grant",
      subjectRef: input.id,
      spaceId: input.memorySpaceId,
      payload: input,
      mutate: (state, now) => {
        state.backfillGrants[input.id] = {
          boundary: "chat",
          ...input,
          createdAt: now,
          revokedAt: null,
        };
      },
    });
  }

  async compareAndAdvance(input: {
    operationId: string;
    subject: MemoryScopeSubject;
    expectedOldSpaceId: string;
    expectedSpaceGenerationRevision: number;
  }): Promise<
    | { kind: "applied"; space: MemorySpaceRef; receipt: PolicyOwnerEffectReceipt }
    | { kind: "superseded" }
  > {
    const current = this.snapshot();
    const key = subjectKey(input.subject);
    const previous = current.state.effects[input.operationId];
    if (previous) {
      const expectedInputDigest = this.effectInputDigest({
        effectKind: "space-generation-advance",
        subjectRef: key,
        spaceId: input.expectedOldSpaceId,
        payload: input,
      });
      if (
        previous.effectKind !== "space-generation-advance" ||
        previous.subjectRef !== key ||
        previous.spaceId !== input.expectedOldSpaceId ||
        previous.inputDigest !== expectedInputDigest ||
        previous.generation === null
      ) {
        throw new Error("Policy operationId 已用于不同 effect");
      }
      return {
        kind: "applied",
        space: memorySpaceForSubject(
          input.subject,
          previous.generation,
          current.state.sharingGeneration
        ),
        receipt: previous,
      };
    }
    const generation = current.state.scopeGenerations[key] ?? {
      generation: 1,
      revision: 0,
    };
    const oldSpace = memorySpaceForSubject(
      input.subject,
      generation.generation,
      current.state.sharingGeneration
    );
    if (
      memorySpaceId(oldSpace) !== input.expectedOldSpaceId ||
      generation.revision !== input.expectedSpaceGenerationRevision
    ) {
      return { kind: "superseded" };
    }
    const receipt = await this.effect({
      operationId: input.operationId,
      effectKind: "space-generation-advance",
      subjectRef: key,
      spaceId: input.expectedOldSpaceId,
      payload: input,
      receiptGeneration: (state) => state.scopeGenerations[key]!.generation,
      mutate: (state) => {
        const latest = state.scopeGenerations[key] ?? generation;
        if (
          latest.generation !== generation.generation ||
          latest.revision !== generation.revision
        ) {
          throw new Error("Memory Space generation CAS 已变化");
        }
        state.revocationRevision += 1;
        state.scopeGenerations[key] = {
          generation: latest.generation + 1,
          revision: latest.revision + 1,
        };
      },
    });
    const next = this.snapshot().state.scopeGenerations[key]!;
    return {
      kind: "applied",
      space: memorySpaceForSubject(
        input.subject,
        next.generation,
        this.snapshot().state.sharingGeneration
      ),
      receipt,
    };
  }

  async compareAndRetain(input: {
    operationId: string;
    subject: MemoryScopeSubject;
    expectedSpaceId: string;
    expectedSpaceGenerationRevision: number;
  }): Promise<
    | { kind: "applied"; receipt: PolicyOwnerEffectReceipt }
    | { kind: "superseded" }
  > {
    const current = this.snapshot();
    const key = subjectKey(input.subject);
    const previous = current.state.effects[input.operationId];
    if (previous) {
      const expectedInputDigest = this.effectInputDigest({
        effectKind: "space-generation-retain",
        subjectRef: key,
        spaceId: input.expectedSpaceId,
        payload: input,
      });
      if (
        previous.effectKind !== "space-generation-retain" ||
        previous.subjectRef !== key ||
        previous.spaceId !== input.expectedSpaceId ||
        previous.inputDigest !== expectedInputDigest
      ) {
        throw new Error("Policy operationId 已用于不同 effect");
      }
      return { kind: "applied", receipt: previous };
    }
    const generation = current.state.scopeGenerations[key] ?? {
      generation: 1,
      revision: 0,
    };
    if (
      memorySpaceId(
        memorySpaceForSubject(
          input.subject,
          generation.generation,
          current.state.sharingGeneration
        )
      ) !==
        input.expectedSpaceId ||
      generation.revision !== input.expectedSpaceGenerationRevision
    ) {
      return { kind: "superseded" };
    }
    const receipt = await this.effect({
      operationId: input.operationId,
      effectKind: "space-generation-retain",
      subjectRef: key,
      spaceId: input.expectedSpaceId,
      payload: input,
      admissionNeutral: true,
      mutate: () => undefined,
    });
    return { kind: "applied", receipt };
  }

  receipt(operationId: string) {
    return this.published.state.effects[operationId] ?? null;
  }

  verifyReceipt(operationId: string, receiptDigest: string) {
    const receipt = this.receipt(operationId);
    if (!receipt || receipt.receiptDigest !== receiptDigest) return false;
    const { receiptDigest: _stored, ...base } = receipt;
    return digest(base) === receiptDigest;
  }

  closeAndFlush() {
    return this.ledger.closeAndFlush();
  }

  private async effect(input: {
    operationId: string;
    effectKind: string;
    subjectRef: string;
    spaceId: string;
    payload: unknown;
    admissionNeutral?: boolean;
    receiptGeneration?: (state: MemoryPolicyState) => number;
    mutate(state: MemoryPolicyState, now: number): void;
  }) {
    const inputDigest = this.effectInputDigest(input);
    const result = await this.ledger.mutate((state) => {
      const existing = state.effects[input.operationId];
      if (existing) {
        if (
          existing.effectKind !== input.effectKind ||
          existing.inputDigest !== inputDigest
        ) {
          throw new Error("Policy operationId 已用于不同 effect");
        }
        return existing;
      }
      const beforeRevision = state.revision;
      const committedAt = Date.now();
      input.mutate(state, committedAt);
      if (!input.admissionNeutral) state.revision += 1;
      const base = {
        operationId: input.operationId,
        owner: "policy" as const,
        effectKind: input.effectKind,
        subjectRef: input.subjectRef,
        spaceId: input.spaceId,
        beforeRevision,
        afterRevision: state.revision,
        committedAt,
        inputDigest,
        generation: input.receiptGeneration?.(state) ?? null,
      };
      const receipt = { ...base, receiptDigest: digest(base) };
      state.effects[input.operationId] = receipt;
      return receipt;
    });
    this.publish(this.ledger.snapshot(), null);
    return result;
  }

  private revokeActive(state: MemoryPolicyState, now: number) {
    const active = state.activeConsentEpochId;
    if (active && state.consentEpochs[active]?.revokedAt === null) {
      state.consentEpochs[active]!.revokedAt = now;
    }
    state.activeConsentEpochId = null;
  }

  private effectInputDigest(input: {
    effectKind: string;
    subjectRef: string;
    spaceId: string;
    payload: unknown;
  }) {
    return digest({
      effectKind: input.effectKind,
      subjectRef: input.subjectRef,
      spaceId: input.spaceId,
      payload: input.payload,
    });
  }

  private compactLedger() {
    const now = Date.now();
    const cutoff = now - 30 * 24 * 60 * 60_000;
    return this.ledger.mutate((state) => {
      const referencedEpochs = new Set(
        Object.values(state.backfillGrants).map((grant) => grant.consentEpochId)
      );
      if (state.activeConsentEpochId) referencedEpochs.add(state.activeConsentEpochId);
      const removableEpochs = Object.values(state.consentEpochs)
        .filter(
          (epoch) =>
            epoch.revokedAt !== null && !referencedEpochs.has(epoch.id)
        )
        .sort((left, right) => right.createdAt - left.createdAt);
      let removed = 0;
      for (const epoch of removableEpochs.slice(1_024)) {
        if ((epoch.revokedAt ?? epoch.createdAt) >= cutoff) continue;
        delete state.consentEpochs[epoch.id];
        removed += 1;
      }
      const effects = Object.values(state.effects).sort(
        (left, right) => right.committedAt - left.committedAt
      );
      for (const receipt of effects.slice(4_096)) {
        if (receipt.committedAt >= cutoff) continue;
        delete state.effects[receipt.operationId];
        removed += 1;
      }
      if (removed > 0) state.revision += 1;
      return removed;
    });
  }

  private publish(state: MemoryPolicyState, failure: "policy-store" | null) {
    this.published = Object.freeze({
      initialized: failure === null,
      failure,
      state: freezeMemoryValue(state) as Readonly<MemoryPolicyState>,
    });
  }
}
