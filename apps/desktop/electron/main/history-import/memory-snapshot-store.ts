/**
 * [INPUT]: Depends on Node crypto/fs/path, zod, durable replacement, product-history intents, shared transcript DTOs, and complete reference projections
 * [OUTPUT]: Provides immutable Memory/Adoption snapshots, schema-v2 quality freeze, deterministic digest projection, cancellable reads, Grant/watermark ledgers, drain, and fail-closed GC
 * [POS]: The TOCTOU and crash-consistency layer of history-import
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import { HISTORY_SOURCE_KINDS, type ForeignHistoryBlock, type ForeignHistorySummary, type HistorySourceKind } from "../../../shared/history-import-ipc";
import { DurableJson, durableReplaceFile } from "../persistence/durable-json";
import {
  productHistoryIntentSchema,
  type ProductHistoryIntent,
} from "../memory/orchestration/consent-controller";

const id = z.string().min(1).max(512);
const messageSchema = z.object({
  nativeTurnId: id, deliverySeq: z.number().int().positive(), role: z.enum(["user", "assistant"]),
  content: z.string(), createdAt: z.number().int().nonnegative(), contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const sourceSchema = z.object({
  sourceKind: z.enum(HISTORY_SOURCE_KINDS), storageFingerprint: id, canonicalNativeId: id,
  aliases: z.array(id), resumeAlias: id,
}).strict();
const adoptionSchemaV1 = z.object({
  schemaVersion: z.literal(1), kind: z.literal("adoption"), snapshotId: id, digest: z.string().regex(/^[a-f0-9]{64}$/),
  source: sourceSchema, projectId: id, cwd: z.string().min(1), title: z.string(), historyRevision: id,
  sourcePath: z.string().min(1),
  fingerprint: z.object({ size: z.number().int().nonnegative(), mtimeNs: z.string() }).strict(),
  parserVersion: z.number().int().positive(), blocks: z.array(z.unknown()), createdAt: z.number().int().nonnegative(),
}).strict();
const adoptionSchemaV2 = z.object({
  schemaVersion: z.literal(2), kind: z.literal("adoption"), snapshotId: id, digest: z.string().regex(/^[a-f0-9]{64}$/),
  source: sourceSchema, projectId: id, cwd: z.string().min(1), title: z.string(), historyRevision: id,
  sourcePath: z.string().min(1),
  fingerprint: z.object({ size: z.number().int().nonnegative(), mtimeNs: z.string() }).strict(),
  parserVersion: z.number().int().positive(), blocks: z.array(z.unknown()),
  incompleteTail: z.boolean(), createdAt: z.number().int().nonnegative(),
}).strict();
const adoptionSchema = z.discriminatedUnion("schemaVersion", [
  adoptionSchemaV1,
  adoptionSchemaV2,
]);
const memorySchemaV1 = z.object({
  schemaVersion: z.literal(1), kind: z.literal("memory-source"), snapshotId: id, digest: z.string().regex(/^[a-f0-9]{64}$/),
  source: sourceSchema, sourceIncarnation: id, projectId: id, cwd: z.string().min(1), parserVersion: z.number().int().positive(),
  normalizedPrefixDigest: z.string().regex(/^[a-f0-9]{64}$/), messages: z.array(messageSchema), createdAt: z.number().int().nonnegative(),
}).strict();
const memorySchema = memorySchemaV1.extend({
  schemaVersion: z.literal(2),
  historyRevision: id,
}).strict();
const watermarkSchema = z.object({
  schemaVersion: z.literal(2),
  sources: z.record(z.string(), z.object({
    deliverySeq: z.number().int().nonnegative(),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    normalizedPrefixDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()),
}).strict();
const grantPhaseSchema = z.object({
  state: z.enum(["pending", "complete", "superseded"]),
  completedAt: z.number().int().nonnegative().nullable(),
  supersededAt: z.number().int().nonnegative().nullable(),
}).strict();
const grantSourceSchema = grantPhaseSchema.extend({
  snapshotId: id,
  logicalSource: id,
  projectId: id,
  historyRevision: id,
}).strict();
const grantProductSchema = grantPhaseSchema.extend({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  intent: productHistoryIntentSchema,
}).strict();
const grantSchema = z.object({
  id, previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sources: z.array(grantSourceSchema),
  product: grantProductSchema.nullable(),
  scopeProjectIds: z.array(id),
  authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  projectEligibility: z.record(z.string(), z.string().min(1)),
  state: z.enum(["pending", "complete", "superseded"]), createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  supersededAt: z.number().int().nonnegative().nullable(),
}).strict();
const grantLedgerSchema = z.object({
  schemaVersion: z.literal(3), grants: z.record(z.string(), grantSchema),
}).strict();
const legacyGrantSchema = z.object({
  id, previewDigest: z.string().regex(/^[a-f0-9]{64}$/), snapshotIds: z.array(id),
  authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  projectEligibility: z.record(z.string(), z.string().min(1)),
  state: z.enum(["pending", "complete", "superseded"]), createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  supersededAt: z.number().int().nonnegative().nullable(),
}).strict();
const legacyGrantLedgerSchema = z.object({
  schemaVersion: z.literal(2), grants: z.record(z.string(), legacyGrantSchema),
}).strict();

export type AdoptionSnapshot = z.infer<typeof adoptionSchema>;
export type MemorySourceSnapshot = z.infer<typeof memorySchema>;
export type HistoryMemoryGrant = z.infer<typeof grantSchema>;
export type ReferenceProjection = Readonly<{
  complete: boolean;
  refs: ReadonlySet<string>;
}>;
type HistoryMemoryGrantSource = z.infer<typeof grantSourceSchema>;

export class HistorySnapshotStore {
  private readonly adoptionRoot: string;
  private readonly memoryRoot: string;
  private readonly watermarkLedger: DurableJson<z.infer<typeof watermarkSchema>>;
  private readonly grantLedger: DurableJson<z.infer<typeof grantLedgerSchema>>;

  constructor(userData: string) {
    const root = join(userData, "history-import");
    this.adoptionRoot = join(root, "adoption-snapshots");
    this.memoryRoot = join(root, "memory-snapshots");
    this.watermarkLedger = new DurableJson(
      join(root, "memory-watermarks-v2.json"),
      watermarkSchema,
      () => ({ schemaVersion: 2, sources: {} })
    );
    this.grantLedger = new DurableJson(
      join(root, "memory-grants-v2.json"),
      grantLedgerSchema,
      () => ({ schemaVersion: 3, grants: {} })
    );
  }

  async initialize() {
    await Promise.all([
      mkdir(this.adoptionRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.memoryRoot, { recursive: true, mode: 0o700 }),
      this.watermarkLedger.initialize(),
      this.grantLedger.initialize(upgradeGrantLedger),
    ]);
    await this.hydrateLegacyGrantSources();
  }

  async writeAdoption(input: { summary: Omit<ForeignHistorySummary, "productArchivedAt">; sourcePath: string; blocks: ForeignHistoryBlock[]; parserVersion: number; fingerprint: { size: number; mtimeNs: string }; incompleteTail: boolean }) {
    const body = {
      source: input.summary.key, projectId: input.summary.projectId, cwd: input.summary.cwd,
      title: input.summary.title, historyRevision: input.summary.historyRevision,
      sourcePath: input.sourcePath,
      fingerprint: input.fingerprint, parserVersion: input.parserVersion,
      blocks: input.blocks, incompleteTail: input.incompleteTail,
    };
    const digest = hash(canonical(body));
    const snapshot: AdoptionSnapshot = adoptionSchema.parse({
      schemaVersion: 2,
      kind: "adoption",
      snapshotId: `adopt_${digest}`,
      digest,
      ...body,
      createdAt: Date.now(),
    });
    await writeContentAddressed(join(this.adoptionRoot, `${snapshot.snapshotId}.json`), snapshot);
    return snapshot;
  }

  async writeMemory(input: { summary: Omit<ForeignHistorySummary, "productArchivedAt">; sourceIncarnation: string; blocks: ForeignHistoryBlock[]; parserVersion: number; afterDeliverySeq?: number }) {
    const allMessages = normalizedMemoryMessages(input.blocks);
    const messages = allMessages.filter((message) => message.deliverySeq > (input.afterDeliverySeq ?? 0));
    const lastAssistant = messages.filter((message) => message.role === "assistant").at(-1);
    const normalizedPrefixDigest = memoryPrefixDigest(input.blocks, lastAssistant?.deliverySeq ?? input.afterDeliverySeq ?? 0);
    const body = {
      source: input.summary.key, sourceIncarnation: input.sourceIncarnation, projectId: input.summary.projectId, cwd: input.summary.cwd,
      historyRevision: input.summary.historyRevision, parserVersion: input.parserVersion,
      /* 存量 index 可能带 stat 浮点时间；schema 收的是 int，入 snapshot 前兜一次。 */
      normalizedPrefixDigest, messages, createdAt: Math.max(0, Math.round(input.summary.updatedAt)),
    };
    const digest = hash(canonical(body));
    const snapshot: MemorySourceSnapshot = memorySchema.parse({ schemaVersion: 2, kind: "memory-source", snapshotId: `memory_${digest}`, digest, ...body });
    await writeContentAddressed(join(this.memoryRoot, `${snapshot.snapshotId}.json`), snapshot);
    return snapshot;
  }

  async readAdoption(snapshotId: string, signal?: AbortSignal) {
    const path = join(this.adoptionRoot, safeId(snapshotId) + ".json");
    if (!signal) {
      return verifySnapshot(adoptionSchema.parse(JSON.parse(await readFile(path, "utf8"))));
    }
    signal.throwIfAborted();
    const raw = await readVerifiedAdoptionInWorker(path, signal);
    signal.throwIfAborted();
    const snapshot = adoptionSchema.parse(raw);
    signal.throwIfAborted();
    return snapshot;
  }
  private async readMemory(snapshotId: string) {
    const raw = JSON.parse(
      await readFile(join(this.memoryRoot, safeId(snapshotId) + ".json"), "utf8")
    );
    const current = memorySchema.safeParse(raw);
    if (current.success) return verifySnapshot(current.data);
    const legacy = verifySnapshot(memorySchemaV1.parse(raw));
    return {
      ...legacy,
      schemaVersion: 2 as const,
      historyRevision: `legacy_${legacy.digest}`,
    };
  }

  watermarks() { return this.watermarkLedger.snapshot().sources; }

  async commitWatermark(source: string, deliverySeq: number, contentDigest: string, normalizedPrefixDigest: string) {
    await this.watermarkLedger.mutate((state) => {
      const prior = state.sources[source];
      if (prior?.deliverySeq === deliverySeq) {
        if (prior.contentDigest !== contentDigest || prior.normalizedPrefixDigest !== normalizedPrefixDigest) {
          throw new Error("Memory 水位与已提交前缀冲突");
        }
        return;
      }
      if (prior && prior.deliverySeq > deliverySeq) return;
      state.sources[source] = { deliverySeq, contentDigest, normalizedPrefixDigest };
    });
  }

  async createMemoryGrant(input: {
    previewDigest: string;
    snapshots: MemorySourceSnapshot[];
    product: { digest: string; intent: ProductHistoryIntent } | null;
    scopeProjectIds: string[];
    authorizationDigest: string;
    projectEligibility: Record<string, string>;
  }) {
    const grant: HistoryMemoryGrant = {
      id: `history_grant_${randomUUID().replaceAll("-", "")}`,
      previewDigest: input.previewDigest,
      sources: input.snapshots.map((snapshot) => ({
        snapshotId: snapshot.snapshotId,
        logicalSource: memoryLogicalSourceKey(snapshot),
        projectId: snapshot.projectId,
        historyRevision: snapshot.historyRevision,
        state: "pending" as const,
        completedAt: null,
        supersededAt: null,
      })),
      product: input.product ? {
        digest: input.product.digest,
        intent: input.product.intent,
        state: "pending",
        completedAt: null,
        supersededAt: null,
      } : null,
      scopeProjectIds: [...new Set(input.scopeProjectIds)].sort(),
      authorizationDigest: input.authorizationDigest,
      projectEligibility: input.projectEligibility,
      state: "pending",
      createdAt: Date.now(),
      completedAt: null,
      supersededAt: null,
    };
    /* 删除 source 后的显式确认也要形成一条终态记录：空 scope 不是
       “还没做完”，而是用户已经确认当前没有任何 phase 可交付。 */
    settleGrant(grant, grant.createdAt);
    await this.grantLedger.mutate((state) => { state.grants[grant.id] = grant; });
    return grant;
  }

  memoryGrant(grantId: string) {
    return this.grantLedger.snapshot().grants[grantId] ?? null;
  }

  pendingMemoryGrants() {
    return Object.values(this.grantLedger.snapshot().grants)
      .filter((grant) => grant.state === "pending")
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  async completeMemoryGrantSources(grantId: string, snapshotIds: string[]) {
    const completed = new Set(snapshotIds);
    await this.grantLedger.mutate((state) => {
      const grant = state.grants[grantId];
      if (!grant || grant.state !== "pending") return;
      const now = Date.now();
      for (const source of grant.sources) {
        if (source.state !== "pending" || !completed.has(source.snapshotId)) continue;
        source.state = "complete";
        source.completedAt = now;
      }
      settleGrant(grant, now);
    });
  }

  async completeMemoryGrantProduct(grantId: string) {
    await this.grantLedger.mutate((state) => {
      const grant = state.grants[grantId];
      if (!grant || grant.state !== "pending") return;
      const now = Date.now();
      if (grant.product?.state === "pending") {
        grant.product.state = "complete";
        grant.product.completedAt = now;
      }
      settleGrant(grant, now);
    });
  }

  /** 新确认接管其 scope 内的当前逻辑 source/product；旧 revision 即使文件
      已删除也会逐 phase supersede，不再让一条复合 Grant 永久 pending。 */
  async supersedeReplacedMemoryGrantParts(input: {
    currentGrantId: string;
    scopeProjectIds: string[];
    replaceProduct: boolean;
  }) {
    const scope = new Set(input.scopeProjectIds);
    await this.grantLedger.mutate((state) => {
      const now = Date.now();
      for (const grant of Object.values(state.grants)) {
        if (grant.id === input.currentGrantId || grant.state !== "pending") continue;
        /* 当前 source 存在时由新 Grant 接管；不存在即代表本次确认已经
           看见删除/截断后的完整 scope，两种情况都终结旧 revision。 */
        supersedePhases(grant, now, {
          source: (source) => scope.has(source.projectId),
          product: input.replaceProduct,
        });
      }
    });
  }

  async supersedeMemoryGrant(grantId: string) {
    await this.grantLedger.mutate((state) => {
      const grant = state.grants[grantId];
      if (!grant || grant.state !== "pending") return;
      supersedePhases(grant, Date.now(), { source: () => true, product: true });
    });
  }

  /** 判定 pending source 的水位是否已覆盖其交付边界；调用方保证 state === "pending"。 */
  async memoryGrantSourceDelivered(source: HistoryMemoryGrantSource) {
    const watermarks = this.watermarks();
    const snapshot = await this.readMemory(source.snapshotId);
    const last = snapshot.messages.filter((message) => message.role === "assistant").at(-1);
    if (!last) return true;
    const watermark = watermarks[memorySourceKey(snapshot)];
    if (!watermark || watermark.deliverySeq < last.deliverySeq) return false;
    return watermark.deliverySeq > last.deliverySeq || (
      watermark.contentDigest === last.contentDigest &&
      watermark.normalizedPrefixDigest === snapshot.normalizedPrefixDigest
    );
  }

  async closeAndFlush() {
    await Promise.all([
      this.watermarkLedger.closeAndFlush(),
      this.grantLedger.closeAndFlush(),
    ]);
  }

  private async hydrateLegacyGrantSources() {
    const legacy = this.pendingMemoryGrants().flatMap((grant) =>
      grant.sources.filter((source) => source.logicalSource.startsWith("legacy_"))
        .map((source) => ({ grantId: grant.id, snapshotId: source.snapshotId }))
    );
    if (!legacy.length) return;
    const hydrated = new Map<string, MemorySourceSnapshot | null>();
    for (const item of legacy) {
      try {
        hydrated.set(item.snapshotId, await this.readMemory(item.snapshotId));
      } catch {
        hydrated.set(item.snapshotId, null);
      }
    }
    await this.grantLedger.mutate((state) => {
      const now = Date.now();
      for (const item of legacy) {
        const grant = state.grants[item.grantId];
        const source = grant?.sources.find((candidate) => candidate.snapshotId === item.snapshotId);
        if (!grant || !source || source.state !== "pending") continue;
        const snapshot = hydrated.get(item.snapshotId) ?? null;
        if (!snapshot) {
          source.state = "superseded";
          source.supersededAt = now;
        } else {
          source.logicalSource = memoryLogicalSourceKey(snapshot);
          source.projectId = snapshot.projectId;
          source.historyRevision = snapshot.historyRevision;
        }
        settleGrant(grant, now);
      }
    });
  }

  gcAdoptionOrphans(projection: ReferenceProjection, olderThan = Date.now() - GC_GRACE_MS) {
    if (!projection.complete) return Promise.resolve();
    return this.gcOrphans(this.adoptionRoot, projection.refs, olderThan);
  }

  /** Memory snapshot 的引用只有 pending Grant；complete/superseded 后文件不再被读。 */
  gcMemoryOrphans(olderThan = Date.now() - GC_GRACE_MS) {
    const referenced = new Set(
      this.pendingMemoryGrants().flatMap((grant) => grant.sources.map((source) => source.snapshotId))
    );
    return this.gcOrphans(this.memoryRoot, referenced, olderThan);
  }

  private async gcOrphans(root: string, referenced: ReadonlySet<string>, olderThan: number) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const snapshotId = entry.name.slice(0, -5);
      if (referenced.has(snapshotId)) continue;
      const path = join(root, entry.name);
      if ((await stat(path)).mtimeMs < olderThan) await rm(path, { force: true });
    }
  }
}

const GC_GRACE_MS = 30 * 86_400_000;

export function memorySourceKey(snapshot: MemorySourceSnapshot) {
  return memorySourceIdentity(
    snapshot.source.sourceKind,
    snapshot.source.storageFingerprint,
    snapshot.source.canonicalNativeId,
    snapshot.sourceIncarnation
  );
}

export function memoryLogicalSourceKey(snapshot: MemorySourceSnapshot) {
  return memoryLogicalSourceIdentity(
    snapshot.source.sourceKind,
    snapshot.source.storageFingerprint,
    snapshot.source.canonicalNativeId
  );
}

export function memoryPrefixDigest(blocks: ForeignHistoryBlock[], upperDeliverySeq: number) {
  return hash(canonical(normalizedMemoryMessages(blocks)
    .filter((message) => message.deliverySeq <= upperDeliverySeq)
    .map(({ nativeTurnId, deliverySeq, role, createdAt, contentDigest }) => ({
      nativeTurnId,
      deliverySeq,
      role,
      createdAt,
      contentDigest,
    }))));
}

export function memorySourceIdentity(
  sourceKind: HistorySourceKind,
  storageFingerprint: string,
  canonicalNativeId: string,
  sourceIncarnation: string
) {
  return `source:${hash(JSON.stringify([
    sourceKind,
    storageFingerprint,
    canonicalNativeId,
    sourceIncarnation,
  ]))}`;
}

function memoryLogicalSourceIdentity(
  sourceKind: HistorySourceKind,
  storageFingerprint: string,
  canonicalNativeId: string
) {
  return `logical:${hash(JSON.stringify([
    sourceKind,
    storageFingerprint,
    canonicalNativeId,
  ]))}`;
}

function supersedePhases(
  grant: HistoryMemoryGrant,
  now: number,
  input: { source(source: HistoryMemoryGrantSource): boolean; product: boolean }
) {
  for (const source of grant.sources) {
    if (source.state !== "pending" || !input.source(source)) continue;
    source.state = "superseded";
    source.supersededAt = now;
  }
  if (input.product && grant.product?.state === "pending") {
    grant.product.state = "superseded";
    grant.product.supersededAt = now;
  }
  settleGrant(grant, now);
}

function settleGrant(grant: HistoryMemoryGrant, now: number) {
  const phases = [
    ...grant.sources.map((source) => source.state),
    ...(grant.product ? [grant.product.state] : []),
  ];
  if (phases.some((phase) => phase === "pending")) return;
  if (phases.every((phase) => phase === "complete")) {
    grant.state = "complete";
    grant.completedAt ??= now;
    return;
  }
  grant.state = "superseded";
  grant.supersededAt ??= now;
}

function upgradeGrantLedger(raw: unknown) {
  const legacy = legacyGrantLedgerSchema.safeParse(raw);
  if (!legacy.success) return undefined;
  return grantLedgerSchema.parse({
    schemaVersion: 3,
    grants: Object.fromEntries(
      Object.entries(legacy.data.grants).map(([grantId, grant]) => {
        const projectIds = Object.keys(grant.projectEligibility).sort();
        const projectId = projectIds[0] ?? `legacy_project_${hash(grantId)}`;
        return [grantId, {
          id: grant.id,
          previewDigest: grant.previewDigest,
          sources: grant.snapshotIds.map((snapshotId) => ({
            snapshotId,
            logicalSource: `legacy_${hash(snapshotId)}`,
            projectId,
            historyRevision: `legacy_${hash(`${grantId}\0${snapshotId}`)}`,
            state: grant.state,
            completedAt: grant.completedAt,
            supersededAt: grant.supersededAt,
          })),
          product: null,
          scopeProjectIds: projectIds,
          authorizationDigest: grant.authorizationDigest,
          projectEligibility: grant.projectEligibility,
          state: grant.state,
          createdAt: grant.createdAt,
          completedAt: grant.completedAt,
          supersededAt: grant.supersededAt,
        }];
      })
    ),
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function normalizedMemoryMessages(blocks: ForeignHistoryBlock[]) {
  return blocks.flatMap((block) => block.kind === "message" && block.content.trim() ? [{
    nativeTurnId: block.nativeTurnId,
    deliverySeq: block.deliverySeq,
    role: block.role,
    content: block.content,
    createdAt: block.createdAt,
    contentDigest: hash(block.content),
  }] : []).sort((left, right) => left.deliverySeq - right.deliverySeq);
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const safeId = (value: string) => { if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("snapshotId 格式无效"); return value; };
async function writeContentAddressed(path: string, value: unknown) {
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  if (existing === null) {
    await durableReplaceFile(path, `${JSON.stringify(value)}\n`);
    return;
  }
  /* v2 adoption 的 createdAt 不属于内容身份；重试只比较 digest 投影。
     其余快照维持全体比较，损坏与冲突一律响亮上浮。 */
  const parsedExisting = JSON.parse(existing) as unknown;
  const same = isAdoptionV2(value)
    ? canonical(adoptionDigestProjection(adoptionSchemaV2.parse(parsedExisting))) ===
      canonical(adoptionDigestProjection(adoptionSchemaV2.parse(value)))
    : canonical(parsedExisting) === canonical(value);
  if (!same) {
    throw new Error("content-addressed snapshot 冲突");
  }
}

function verifySnapshot<T extends { kind: string; snapshotId: string; digest: string }>(snapshot: T) {
  const { schemaVersion: _schemaVersion, kind, snapshotId, digest, ...body } = snapshot as T & { schemaVersion: number };
  const expected = hash(canonical(
    kind === "adoption" && _schemaVersion === 2
      ? adoptionDigestProjection(snapshot)
      : body
  ));
  const prefix = kind === "adoption" ? "adopt_" : "memory_";
  if (digest !== expected || snapshotId !== `${prefix}${expected}`) {
    throw new Error("content-addressed snapshot 完整性校验失败");
  }
  return snapshot;
}

function isAdoptionV2(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "adoption" &&
    (value as { schemaVersion?: unknown }).schemaVersion === 2
  );
}

function adoptionDigestProjection(value: unknown) {
  const {
    schemaVersion: _schemaVersion,
    kind: _kind,
    snapshotId: _snapshotId,
    digest: _digest,
    createdAt: _createdAt,
    ...body
  } = value as Record<string, unknown>;
  return body;
}

/* JSON.parse + canonical digest 都是不可抢占的 CPU 段。搜索带 signal 时把整段
 * 搬出 Electron main；abort 直接 terminate，避免 64 MiB 快照冻结页截止计时器。 */
const ADOPTION_READER_SOURCE = String.raw`
const { createHash } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const { parentPort, workerData } = require("node:worker_threads");
const canonical = (value) => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  }
  return JSON.stringify(value);
};
(async () => {
  const snapshot = JSON.parse(await readFile(workerData, "utf8"));
  if (!snapshot || typeof snapshot !== "object") throw new Error("快照格式无效");
  const { schemaVersion, kind, snapshotId, digest, ...body } = snapshot;
  const projection = kind === "adoption" && schemaVersion === 2
    ? (({ createdAt: ignored, ...stable }) => stable)(body)
    : body;
  const expected = createHash("sha256").update(canonical(projection)).digest("hex");
  if (kind !== "adoption" || digest !== expected || snapshotId !== "adopt_" + expected) {
    throw new Error("content-addressed snapshot 完整性校验失败");
  }
  parentPort.postMessage({ ok: true, snapshot });
})().catch((cause) => parentPort.postMessage({
  ok: false,
  error: cause instanceof Error ? cause.message : String(cause),
}));
`;

function readVerifiedAdoptionInWorker(path: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(ADOPTION_READER_SOURCE, { eval: true, workerData: path });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
      void worker.terminate();
    };
    const onAbort = () => finish(() => {
      try { signal.throwIfAborted(); }
      catch (cause) { reject(cause); }
    });
    signal.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message: { ok: boolean; snapshot?: unknown; error?: string }) => {
      finish(() => message.ok
        ? resolve(message.snapshot)
        : reject(new Error(message.error ?? "adoption snapshot worker failed")));
    });
    worker.once("error", (cause) => finish(() => reject(cause)));
    worker.once("exit", (code) => {
      if (code !== 0) finish(() => reject(new Error(`adoption snapshot worker exited: ${code}`)));
    });
    if (signal.aborted) onAbort();
  });
}
