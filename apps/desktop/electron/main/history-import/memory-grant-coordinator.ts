/**
 * [INPUT]: Depends on crypto, HistorySnapshotStore, visible outsourced message logistics port, Memory Consent status, recoverable product intent and outsourced delivery port
 * [OUTPUT]: Provides MemoryGrantCoordinator: authorized delta preview bound to context, confirmed as accepted, access synchronized, delivery backstage) delivery, state projection, foreign/product single grant phase recovery, source revision, replacement, snapshot-only delivery with full front-stage water
 * [POS]: The Memory authorization state machine for history-import; License/Project eligibility Delete mandatory re-previewing, restart only the product phase that has been confirmed, and never silently re-post foreign content; Delivery failed by deliveryFailed projection, not reject Confirmed call
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  ForeignHistoryMessage,
  ForeignHistorySummary,
  HistoryMemoryEligibility,
  HistoryMemoryPreview,
} from "../../../shared/history-import-ipc";
import type { MemorySharingMode } from "../../../shared/settings-ipc";
import type { ProductHistoryIntent } from "../memory/orchestration/consent-controller";
import type { AdapterEntry } from "./adapter";
import {
  HistorySnapshotStore,
  memoryLogicalSourceKey,
  memoryPrefixDigest,
  memorySourceIdentity,
  memorySourceKey,
  type HistoryMemoryGrant,
  type MemorySourceSnapshot,
} from "./memory-snapshot-store";

const PREVIEW_TTL = 10 * 60_000;

type PendingMemory = {
  preview: HistoryMemoryPreview;
  snapshots: MemorySourceSnapshot[];
  product: { digest: string; intent: ProductHistoryIntent } | null;
  scopeProjectIds: string[];
  replaceProduct: boolean;
  authorization: HistoryMemoryAuthorization;
  authorizationDigest: string;
  projectEligibility: Record<string, string>;
};

export type HistoryMemoryAuthorization = {
  enabled: boolean;
  ready: boolean;
  sharingMode: MemorySharingMode;
  providerId: string | null;
  providerDataInstanceId: string | null;
  consentEpochId: string | null;
};

export class MemoryGrantCoordinator {
  private readonly pending = new Map<string, PendingMemory>();

  constructor(
    private readonly snapshots: HistorySnapshotStore,
    private readonly ports: {
      state(): HistoryMemoryAuthorization;
      historyEligibility(projectId: string): string | null;
      visibleEntries(): ForeignHistorySummary[];
      materialize(opaqueId: string): Promise<{
        entry: AdapterEntry;
        blocks: ForeignHistoryMessage[];
        parserVersion: number;
      }>;
      commitForeign?(input: {
        grantId: string;
        snapshots: MemorySourceSnapshot[];
        authorization: HistoryMemoryAuthorization;
      }): Promise<Array<{ source: string; deliverySeq: number; contentDigest: string; normalizedPrefixDigest: string }>>;
      previewProduct?(): Promise<{
        digest: string;
        chats: number;
        turns: number;
        from: number | null;
        to: number | null;
        intent: ProductHistoryIntent;
      }>;
      commitProduct?(grantId: string, intent: ProductHistoryIntent): Promise<void>;
      productCommitted?(grantId: string): boolean;
      /** 交付泵启停通知；owner 借此把 delivering 状态投影进 snapshot 事件流。 */
      deliveryChanged?(): void;
      /** 交付泵终态失败；owner 负责把原因投影为用户可见 warning。 */
      deliveryFailed?(cause: unknown): void;
    }
  ) {}

  /* ==========================================================
   * 后台交付泵：单链串行。确认（commit）只做准入并立即返回；
   * 逐 turn 的 provider 往返在链上排队执行，UI 永不为交付等待。
   * ========================================================== */
  private pumpTail: Promise<void> = Promise.resolve();
  private activeDeliveries = 0;
  private readonly deliveringRefs = new Map<string, number>();

  eligibility(input: { surface: "project" | "settings"; projectId?: string }): HistoryMemoryEligibility {
    const memory = this.ports.state();
    const authorized = hasAuthorization(memory);
    const historyEnabled = input.projectId ? Boolean(this.ports.historyEligibility(input.projectId)) : true;
    const reason = !authorized
      ? "memory-unavailable"
      : !historyEnabled
        ? "history-disabled"
        : memory.sharingMode === "chat" ? "chat-mode" : "ready";
    const enabled = authorized && historyEnabled && (
      input.surface === "settings" || memory.sharingMode !== "chat"
    );
    return {
      visible: authorized,
      enabled,
      sharingMode: memory.sharingMode,
      reason,
      interruptedGrant: this.snapshots.pendingMemoryGrants().length > 0,
    };
  }

  async preview(input: { projectId?: string; includeProductChats: boolean }) {
    const authorization = this.ports.state();
    const authorizationDigest = hashAuthorization(authorization);
    const eligibility = this.eligibility({
      surface: input.projectId ? "project" : "settings",
      projectId: input.projectId,
    });
    const includeForeign = eligibility.enabled && eligibility.sharingMode !== "chat";
    const summaries = includeForeign
      ? this.ports.visibleEntries().filter((entry) => !input.projectId || entry.projectId === input.projectId)
      : [];
    const snapshots: MemorySourceSnapshot[] = [];
    const watermarks = this.snapshots.watermarks();
    for (const summary of summaries) {
      const materialized = await this.ports.materialize(summary.opaqueId);
      let sourceIncarnation = materialized.entry.sourceIncarnation;
      let source = externalMemorySourceKey(materialized.entry, sourceIncarnation);
      let watermark = watermarks[source];
      if (watermark && memoryPrefixDigest(materialized.blocks, watermark.deliverySeq) !== watermark.normalizedPrefixDigest) {
        sourceIncarnation = createHash("sha256")
          .update(`${sourceIncarnation}\0${materialized.entry.historyRevision}\0mutated-prefix`)
          .digest("hex");
        source = externalMemorySourceKey(materialized.entry, sourceIncarnation);
        watermark = watermarks[source];
      }
      const snapshot = await this.snapshots.writeMemory({
        summary,
        sourceIncarnation,
        blocks: materialized.blocks,
        parserVersion: materialized.parserVersion,
        afterDeliverySeq: watermark?.deliverySeq,
      });
      if (snapshot.messages.some((message) => message.role === "assistant")) snapshots.push(snapshot);
    }
    const messages = snapshots.flatMap((snapshot) => snapshot.messages);
    const product = input.includeProductChats ? await this.ports.previewProduct?.() ?? null : null;
    const interruptedProjectIds = input.projectId ? [] : this.snapshots
      .pendingMemoryGrants()
      .flatMap((grant) => Object.keys(grant.projectEligibility))
      .filter((projectId) => this.ports.historyEligibility(projectId) !== null);
    /* 入口 Project 只有当下合资格才入绑定集；稳定的「不合资格」走空预览，
       下面的资格校验只留给预览期间的真实漂移。 */
    const projectIds = [...new Set([
      ...snapshots.map((snapshot) => snapshot.projectId),
      ...(input.projectId && this.ports.historyEligibility(input.projectId) !== null ? [input.projectId] : []),
      ...interruptedProjectIds,
    ])].sort();
    const projectEligibility = Object.fromEntries(projectIds.flatMap((projectId) => {
      const epoch = this.ports.historyEligibility(projectId);
      return epoch ? [[projectId, epoch]] : [];
    }));
    if (Object.keys(projectEligibility).length !== projectIds.length) {
      throw new Error("Project 历史资格在预览期间发生变化，请重新预览");
    }
    if (hashAuthorization(this.ports.state()) !== authorizationDigest) {
      throw new Error("Memory 授权范围在预览期间发生变化，请重新预览");
    }
    const foreignDigest = snapshots.length ? hashSnapshots(snapshots) : "0".repeat(64);
    const digest = createHash("sha256")
      .update(`${foreignDigest}\0${product?.digest ?? "none"}\0${authorizationDigest}\0${hashEligibility(projectEligibility)}`)
      .digest("hex");
    const snapshotId = `preview_${randomUUID().replaceAll("-", "")}`;
    const preview: HistoryMemoryPreview = {
      snapshotId,
      digest,
      chats: snapshots.length + (product?.chats ?? 0),
      turns: messages.filter((message) => message.role === "assistant").length + (product?.turns ?? 0),
      from: minDate(messages.length ? Math.min(...messages.map((message) => message.createdAt)) : null, product?.from ?? null),
      to: maxDate(messages.length ? Math.max(...messages.map((message) => message.createdAt)) : null, product?.to ?? null),
      sharingMode: eligibility.sharingMode,
      includesForeign: includeForeign,
      expiresAt: Date.now() + PREVIEW_TTL,
    };
    this.pending.set(snapshotId, {
      preview,
      snapshots,
      product: product ? { digest: product.digest, intent: product.intent } : null,
      scopeProjectIds: projectIds,
      replaceProduct: input.includeProductChats,
      authorization,
      authorizationDigest,
      projectEligibility,
    });
    return preview;
  }

  async commit(snapshotId: string, digest: string) {
    const pending = this.pending.get(snapshotId);
    this.pending.delete(snapshotId);
    if (!pending || pending.preview.expiresAt <= Date.now() || pending.preview.digest !== digest) {
      throw new Error("Memory 导入预览已失效，请重新确认");
    }
    if (
      hashAuthorization(this.ports.state()) !== pending.authorizationDigest ||
      Object.entries(pending.projectEligibility).some(
        ([projectId, epoch]) => this.ports.historyEligibility(projectId) !== epoch
      )
    ) {
      throw new Error("Memory 授权范围或 Project 历史资格已变化，请重新预览");
    }
    const grant = this.snapshots.pendingMemoryGrants().find((candidate) =>
      candidate.previewDigest === pending.preview.digest &&
      candidate.authorizationDigest === pending.authorizationDigest &&
      sameEligibility(candidate.projectEligibility, pending.projectEligibility) &&
      sameGrantSources(candidate, pending.snapshots) &&
      (candidate.product?.digest ?? null) === (pending.product?.digest ?? null)
    ) ?? await this.snapshots.createMemoryGrant({
      previewDigest: pending.preview.digest,
      snapshots: pending.snapshots,
      product: pending.product,
      scopeProjectIds: pending.scopeProjectIds,
      authorizationDigest: pending.authorizationDigest,
      projectEligibility: pending.projectEligibility,
    });
    await this.snapshots.supersedeReplacedMemoryGrantParts({
      currentGrantId: grant.id,
      scopeProjectIds: pending.scopeProjectIds,
      replaceProduct: pending.replaceProduct,
    });
    /* ==========================================================
     * 确认即受理。授权仪式到此已完成：preview/digest/漂移全部校验过，
     * Grant 与 supersede 决定都已落盘。剩下的交付是纯执行——可能是数百
     * 次 provider 往返（分钟级），不配扣住确认弹窗。
     *
     * 交付转入后台泵。durable Grant + 逐源水位本就允许在任意点撕裂：
     * 崩溃/退出等价于既有 interruptedGrant 仪式，重新预览即续用同一
     * Grant 收口；终态失败经 deliveryFailed 投影为 warning，不静默丢失。
     * ========================================================== */
    this.schedulePump({
      grantId: grant.id,
      snapshots: pending.snapshots,
      authorization: pending.authorization,
      scopeProjectIds: pending.scopeProjectIds,
    });
  }

  /** 任一已确认 Grant 仍在后台交付。 */
  delivering() {
    return this.activeDeliveries > 0;
  }

  /** 后台交付覆盖的 Project 集合；驱动 Sidebar 行级活动指示。 */
  deliveringProjects(): ReadonlySet<string> {
    return new Set(this.deliveringRefs.keys());
  }

  /** 等当前已受理的全部交付收尾；测试断言与诊断用，产品路径不得阻塞在此。 */
  settled() {
    return this.pumpTail;
  }

  private schedulePump(job: {
    grantId: string;
    snapshots: MemorySourceSnapshot[];
    authorization: HistoryMemoryAuthorization;
    scopeProjectIds: string[];
  }) {
    this.activeDeliveries += 1;
    for (const projectId of job.scopeProjectIds) {
      this.deliveringRefs.set(projectId, (this.deliveringRefs.get(projectId) ?? 0) + 1);
    }
    this.ports.deliveryChanged?.();
    this.pumpTail = this.pumpTail.then(async () => {
      try {
        await this.pump(job);
      } catch (cause) {
        this.ports.deliveryFailed?.(cause);
      } finally {
        this.activeDeliveries -= 1;
        for (const projectId of job.scopeProjectIds) {
          const next = (this.deliveringRefs.get(projectId) ?? 1) - 1;
          if (next > 0) this.deliveringRefs.set(projectId, next);
          else this.deliveringRefs.delete(projectId);
        }
        this.ports.deliveryChanged?.();
      }
    });
  }

  /** 交付泵体：未完成 phase 从 durable Grant 现态重derive，重复排泵自然收敛为 no-op。 */
  private async pump(job: {
    grantId: string;
    snapshots: MemorySourceSnapshot[];
    authorization: HistoryMemoryAuthorization;
  }) {
    const current = this.snapshots.memoryGrant(job.grantId);
    if (current?.state === "pending") {
      const pendingSourceIds = new Set(
        current.sources
          .filter((source) => source.state === "pending")
          .map((source) => source.snapshotId)
      );
      const foreign = job.snapshots.filter((snapshot) =>
        pendingSourceIds.has(snapshot.snapshotId)
      );
      if (foreign.length) {
        await this.deliver(current, foreign, job.authorization);
        await this.snapshots.completeMemoryGrantSources(
          current.id,
          foreign.map((snapshot) => snapshot.snapshotId)
        );
      }
      const afterForeign = await this.settleProductReceipt(job.grantId);
      if (afterForeign.product?.state === "pending") {
        if (!this.ports.commitProduct) throw new Error("产品 Chat Memory 回填端口尚未就绪");
        await this.commitProductPhase(job.grantId, afterForeign.product.intent);
      }
    }
    /* 新确认可能补齐旧 Grant 的部分水位；只重读本地 snapshot/watermark，
       把所有已满足的旧账一并收口，绝不借机重发 provider 内容。 */
    await this.reconcile();
  }

  async reconcile() {
    const authorizationDigest = hashAuthorization(this.ports.state());
    for (const grant of this.snapshots.pendingMemoryGrants()) {
      try {
        const delivered: string[] = [];
        for (const source of grant.sources) {
          if (source.state === "pending" && await this.snapshots.memoryGrantSourceDelivered(source)) {
            delivered.push(source.snapshotId);
          }
        }
        if (delivered.length) {
          await this.snapshots.completeMemoryGrantSources(grant.id, delivered);
        }
        const current = await this.settleProductReceipt(grant.id);
        if (current.state !== "pending") continue;
        if (
          current.authorizationDigest !== authorizationDigest ||
          current.sources.some((source) =>
            source.state === "pending" &&
            this.ports.historyEligibility(source.projectId) !== current.projectEligibility[source.projectId]
          )
        ) {
          await this.snapshots.supersedeMemoryGrant(grant.id);
          continue;
        }
        if (current.product?.state === "pending" && this.ports.commitProduct) {
          try {
            await this.commitProductPhase(grant.id, current.product.intent);
          } catch {
            /* durable intent 留在 pending；下一次启动或显式重确认继续收口。 */
          }
        }
      } catch {
        await this.snapshots.supersedeMemoryGrant(grant.id);
      }
    }
  }

  discard(snapshotId: string) {
    this.pending.delete(snapshotId);
  }

  /** 只按 Policy 回执收账（幂等、无 provider 副作用），可在漂移校验前调用。 */
  private async settleProductReceipt(grantId: string) {
    const current = this.snapshots.memoryGrant(grantId)!;
    if (current.product?.state === "pending" && this.ports.productCommitted?.(grantId)) {
      await this.snapshots.completeMemoryGrantProduct(grantId);
      return this.snapshots.memoryGrant(grantId)!;
    }
    return current;
  }

  /** 真提交 product effect；调用方必须已通过授权/资格漂移校验。 */
  private async commitProductPhase(grantId: string, intent: ProductHistoryIntent) {
    await this.ports.commitProduct!(grantId, intent);
    await this.snapshots.completeMemoryGrantProduct(grantId);
  }

  private async deliver(grant: HistoryMemoryGrant, snapshots: MemorySourceSnapshot[], authorization: HistoryMemoryAuthorization) {
    if (!snapshots.length) return;
    if (!this.ports.commitForeign) throw new Error("Memory 外源回填端口尚未就绪");
    const delivered = await this.ports.commitForeign({ grantId: grant.id, snapshots, authorization });
    const allowed = new Map(snapshots.map((snapshot) => [memorySourceKey(snapshot), snapshot] as const));
    const received = new Set<string>();
    for (const watermark of delivered) {
      const snapshot = allowed.get(watermark.source);
      const message = snapshot?.messages.find((candidate) => candidate.deliverySeq === watermark.deliverySeq);
      if (!snapshot || received.has(watermark.source) || !message || message.contentDigest !== watermark.contentDigest || snapshot.normalizedPrefixDigest !== watermark.normalizedPrefixDigest) {
        throw new Error("Memory provider 返回了不属于 Grant snapshot 的水位");
      }
      received.add(watermark.source);
      await this.snapshots.commitWatermark(
        watermark.source,
        watermark.deliverySeq,
        watermark.contentDigest,
        watermark.normalizedPrefixDigest
      );
    }
    if ([...allowed.keys()].some((source) => !received.has(source))) {
      throw new Error("Memory provider 未返回 Grant snapshot 的完整水位");
    }
  }
}

const sameGrantSources = (
  grant: HistoryMemoryGrant,
  snapshots: MemorySourceSnapshot[]
) => {
  const left = grant.sources.map((source) =>
    `${source.logicalSource}\0${source.historyRevision}\0${source.snapshotId}`
  ).sort();
  const right = snapshots.map((snapshot) =>
    `${memoryLogicalSourceKey(snapshot)}\0${snapshot.historyRevision}\0${snapshot.snapshotId}`
  ).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
};
const hashSnapshots = (snapshots: MemorySourceSnapshot[]) =>
  createHash("sha256").update(snapshots.map((snapshot) => snapshot.digest).sort().join("\0")).digest("hex");
const hashEligibility = (eligibility: Record<string, string>) => createHash("sha256")
  .update(JSON.stringify(Object.entries(eligibility).sort(([left], [right]) => left.localeCompare(right))))
  .digest("hex");
const sameEligibility = (left: Record<string, string>, right: Record<string, string>) => {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
};
const externalMemorySourceKey = (entry: AdapterEntry, sourceIncarnation: string) =>
  memorySourceIdentity(entry.sourceKind, entry.key.storageFingerprint, entry.key.canonicalNativeId, sourceIncarnation);
const hasAuthorization = (state: HistoryMemoryAuthorization) => Boolean(
  state.enabled && state.ready && state.providerId && state.providerDataInstanceId && state.consentEpochId
);
const hashAuthorization = (state: HistoryMemoryAuthorization) => createHash("sha256")
  .update(JSON.stringify([
    state.enabled,
    state.ready,
    state.sharingMode,
    state.providerId,
    state.providerDataInstanceId,
    state.consentEpochId,
  ]))
  .digest("hex");
const minDate = (left: number | null, right: number | null) =>
  left === null ? right : right === null ? left : Math.min(left, right);
const maxDate = (left: number | null, right: number | null) =>
  left === null ? right : right === null ? left : Math.max(left, right);
