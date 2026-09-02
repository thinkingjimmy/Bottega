/**
 * [INPUT]: Depends on canonical Chat summaries, native-only segment pages, Policy v4 shared generation, runtime-owned target/destination, scope resolver, and zod durable intent
 * [OUTPUT]: Provides paged one-time reason/mode/generation/history boundary authority, recoverable product history intent, and rebuild Consent/Grant for the current shared generation
 * [POS]: The main/memory/orchestration consent controller is usedSettings only save intent, permanently disclose the bul value here
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ChatMessage,
  ChatRecord,
  UserChatMessage,
} from "../../../../shared/chats-ipc";
import type { MemoryNativeSegmentPage } from "../../chats/sqlite/database-protocol";
import type {
  MemoryConsentAuthority,
  MemoryConsentPreview,
  MemoryConsentReason,
  MemoryEffectiveTarget,
} from "../../../../shared/memory-ipc";
import {
  MEMORY_SHARING_MODES,
  type MemorySharingMode,
} from "../../../../shared/settings-ipc";
import { memorySpaceId, sourceSessionKey } from "../core/domain";
import {
  memorySpaceForSubject,
  resolveMemoryScopeSubject,
} from "../core/memory-scope";
import { isMemorableAssistant } from "../core/domain";
import type { ChatBackfillGrant, MemoryPolicyStore } from "../policy/store";
import { stableMemoryDigest } from "../turn-deadline";

type ChatSummary = Readonly<{
  id: string;
  incarnationId: string;
  lastSeq: number;
  trimmedThroughSeq: number;
}>;

type HistoryBoundary = Readonly<{
  chatId: string;
  incarnationId: string;
  sourceSessionKey: string;
  memorySpaceId: string;
  upperSeq: number;
  upperTime: number;
}>;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const productBackfillGrantSchema = z.object({
  boundary: z.literal("chat"),
  id: z.string().min(1).max(512),
  memorySpaceId: z.string().min(1).max(512),
  chatIncarnations: z.array(z.string().min(1).max(512)),
  upperSeqBySession: z.record(z.string(), z.number().int().nonnegative()),
  upperTime: z.number().int().nonnegative(),
  lowerTime: z.number().int().nonnegative().nullable(),
  providerDataInstanceId: z.string().min(1).max(512),
  previewDigest: digestSchema,
}).strict();

export const productHistoryIntentSchema = z.object({
  schemaVersion: z.literal(1),
  previewDigest: digestSchema,
  providerId: z.string().min(1).max(128),
  providerDataInstanceId: z.string().min(1).max(512),
  extractionHostname: z.string().min(1).max(512),
  extractionModel: z.string().min(1).max(512),
  sharingMode: z.enum(MEMORY_SHARING_MODES),
  sharingGeneration: z.number().int().nonnegative(),
  effectiveAt: z.number().int().nonnegative(),
  backfillGrants: z.array(productBackfillGrantSchema),
}).strict();

export type ProductHistoryIntent = z.infer<typeof productHistoryIntentSchema>;

type ConsentAuthorityRecord = MemoryConsentAuthority & Readonly<{
  historyBoundaries: ReadonlyArray<HistoryBoundary>;
}>;

type ConsentControllerDependencies = {
  policy: MemoryPolicyStore;
  initializeOwners(): Promise<void>;
  resolveTarget(providerId: string): Promise<MemoryEffectiveTarget>;
  destination(providerId: string): Promise<{ hostname: string; model: string }>;
  readChat(chatId: string): Promise<ChatRecord | null>;
  listChatSummaries(): Promise<ChatSummary[]>;
  readNativeChatSegment?(
    chatId: string,
    afterSeq: number,
    limit: number
  ): Promise<MemoryNativeSegmentPage | null>;
};

export class MemoryConsentController {
  private readonly authorities = new Map<string, ConsentAuthorityRecord>();

  constructor(private readonly dependencies: ConsentControllerDependencies) {}

  async preview(
    providerId: string,
    includeHistory: boolean,
    reason: MemoryConsentReason,
    sharingMode: MemorySharingMode,
    excludedChatIds: ReadonlySet<string> = new Set()
  ): Promise<MemoryConsentPreview> {
    return (
      await this.buildPreview(
        providerId,
        includeHistory,
        reason,
        sharingMode,
        excludedChatIds
      )
    ).preview;
  }

  /** Settings 的组合确认必须先冻结可重放 intent，再交给外层 durable Grant。
      这里不写 Policy；只有用户确认后的 commitProductHistory 才产生 effect。 */
  async previewProductHistory(
    providerId: string,
    sharingMode: MemorySharingMode
  ) {
    const built = await this.buildPreview(
      providerId,
      true,
      "enable",
      sharingMode
    );
    const backfillGrants = await this.prepareHistoryGrants(
      built.preview,
      built.historyBoundaries
    );
    const intent = productHistoryIntentSchema.parse({
      schemaVersion: 1,
      previewDigest: built.preview.digest,
      providerId: built.preview.providerId,
      providerDataInstanceId: built.preview.providerDataInstanceId,
      extractionHostname: built.preview.hostname,
      extractionModel: built.preview.model,
      sharingMode: built.preview.nextSharingMode,
      sharingGeneration: built.preview.nextSharingGeneration,
      effectiveAt: Date.now(),
      backfillGrants,
    });
    return { preview: built.preview, intent };
  }

  async commitProductHistory(
    operationId: string,
    rawIntent: ProductHistoryIntent
  ) {
    const intent = productHistoryIntentSchema.parse(rawIntent);
    await this.dependencies.initializeOwners();
    const target = await this.dependencies.resolveTarget(intent.providerId);
    const destination = await this.dependencies.destination(intent.providerId);
    const policy = this.dependencies.policy.snapshot();
    if (
      !target.canEnable ||
      target.providerDataInstanceId !== intent.providerDataInstanceId ||
      destination.hostname !== intent.extractionHostname ||
      destination.model !== intent.extractionModel ||
      policy.state.sharingGeneration !== intent.sharingGeneration
    ) {
      throw new Error("产品 Chat Memory intent 的授权上下文已变化");
    }
    await this.dependencies.policy.createConsent({
      operationId,
      providerDataInstanceId: intent.providerDataInstanceId,
      providerId: intent.providerId,
      extractionHostname: intent.extractionHostname,
      extractionModel: intent.extractionModel,
      sharingMode: intent.sharingMode,
      effectiveAt: intent.effectiveAt,
      backfillGrants: intent.backfillGrants,
      purpose: "live",
    });
  }

  productHistoryCommitted(operationId: string) {
    return this.dependencies.policy.receipt(operationId) !== null;
  }

  private async buildPreview(
    providerId: string,
    includeHistory: boolean,
    reason: MemoryConsentReason,
    sharingMode: MemorySharingMode,
    excludedChatIds: ReadonlySet<string> = new Set()
  ) {
    await this.dependencies.initializeOwners();
    const target = await this.dependencies.resolveTarget(providerId);
    if (!target.canEnable || !target.providerDataInstanceId) {
      throw new Error(target.blockedReason ?? "当前 Memory 目标不可用");
    }
    const destination = await this.dependencies.destination(providerId);
    const policy = this.dependencies.policy.snapshot();
    const previousConsent = this.dependencies.policy.currentConsent(policy);
    const nextSharingGeneration =
      reason === "sharing"
        ? this.dependencies.policy.nextSharingGeneration(policy)
        : policy.state.sharingGeneration;
    const history = includeHistory
      ? await this.history(
          excludedChatIds,
          sharingMode,
          nextSharingGeneration,
          policy
        )
      : {
          stats: { chats: 0, turns: 0, from: null, to: null, gaps: 0 },
          boundaries: [] as HistoryBoundary[],
        };
    const base = {
      reason,
      providerId,
      providerDataInstanceId: target.providerDataInstanceId,
      hostname: destination.hostname,
      model: destination.model,
      previousHostname: previousConsent?.extractionHostname ?? null,
      previousModel: previousConsent?.extractionModel ?? null,
      currentSharingMode: previousConsent?.sharingMode ?? null,
      nextSharingMode: sharingMode,
      nextSharingGeneration,
      includeHistory,
      ...history.stats,
    };
    const digest = stableMemoryDigest({
      ...base,
      historyBoundaries: history.boundaries,
    });
    return {
      preview: Object.freeze({ ...base, digest }),
      historyBoundaries: Object.freeze(
        history.boundaries.map((boundary) => Object.freeze(boundary))
      ),
    };
  }

  async request(
    providerId: string,
    includeHistory: boolean,
    reason: MemoryConsentReason,
    sharingMode: MemorySharingMode,
    previewDigest: string
  ): Promise<MemoryConsentAuthority> {
    const built = await this.buildPreview(
      providerId,
      includeHistory,
      reason,
      sharingMode
    );
    const preview = built.preview;
    if (preview.digest !== previewDigest) {
      throw new Error("Memory 历史预览已变化，请重新确认");
    }
    const authority: ConsentAuthorityRecord = Object.freeze({
      token: randomUUID(),
      preview,
      expiresAt: Date.now() + 5 * 60_000,
      historyBoundaries: built.historyBoundaries,
    });
    this.authorities.set(authority.token, authority);
    return Object.freeze({
      token: authority.token,
      preview: authority.preview,
      expiresAt: authority.expiresAt,
    });
  }

  async consume(
    token: string,
    target: MemoryEffectiveTarget,
    purpose: "live" | "configuration" = "live"
  ) {
    const authority = this.authorities.get(token);
    this.authorities.delete(token);
    const currentConsent = this.dependencies.policy.currentConsent();
    if (
      !authority ||
      authority.expiresAt < Date.now() ||
      authority.preview.providerId !== target.providerId ||
      authority.preview.providerDataInstanceId !== target.providerDataInstanceId ||
      authority.preview.nextSharingGeneration !==
        (authority.preview.reason === "sharing"
          ? this.dependencies.policy.nextSharingGeneration()
          : this.dependencies.policy.snapshot().state.sharingGeneration)
    ) {
      throw new Error("Memory 授权确认已失效，请重新预览");
    }
    if (
      authority.preview.reason === "sharing" &&
      currentConsent?.sharingMode !== authority.preview.currentSharingMode
    ) {
      throw new Error("Memory 当前共享范围已变化，请重新预览");
    }
    if (authority.preview.includeHistory && purpose !== "live") {
      throw new Error("暂停期间不能导入历史，请恢复后重试");
    }
    const backfillGrants = authority.preview.includeHistory
      ? await this.prepareHistoryGrants(
          authority.preview,
          authority.historyBoundaries
        )
      : [];
    const destination = await this.dependencies.destination(
      authority.preview.providerId
    );
    if (
      destination.hostname !== authority.preview.hostname ||
      destination.model !== authority.preview.model
    ) {
      throw new Error("Memory 提取目的地已变化，请重新确认");
    }
    await this.dependencies.policy.createConsent({
      operationId: `consent:${token}`,
      providerDataInstanceId: authority.preview.providerDataInstanceId,
      providerId: authority.preview.providerId,
      extractionHostname: authority.preview.hostname,
      extractionModel: authority.preview.model,
      sharingMode: authority.preview.nextSharingMode,
      effectiveAt: Date.now(),
      advanceSharing: authority.preview.reason === "sharing",
      backfillGrants,
      purpose,
    });
    return authority;
  }

  async rebuild(
    operationId: string,
    previousInstanceId: string,
    target: MemoryEffectiveTarget
  ) {
    if (!target.providerDataInstanceId) {
      throw new Error("Rebuild replacement instance 缺失");
    }
    const before = this.dependencies.policy.snapshot().state;
    const currentSharing =
      this.dependencies.policy.currentConsent() ??
      Object.values(before.consentEpochs)
        .filter(
          (epoch) =>
            epoch.purpose !== "rebuild" &&
            epoch.sharingGeneration === before.sharingGeneration
        )
        .sort((left, right) => right.createdAt - left.createdAt)[0];
    if (!currentSharing) return { granted: 0, rebuildEpochId: null };
    const epochs = Object.values(before.consentEpochs).filter(
      (epoch) =>
        epoch.providerDataInstanceId === previousInstanceId &&
        epoch.purpose === "live" &&
        epoch.sharingMode === currentSharing.sharingMode &&
        epoch.sharingGeneration === before.sharingGeneration
    );
    if (epochs.length === 0) return { granted: 0, rebuildEpochId: null };
    const destination = await this.dependencies.destination(target.providerId);
    const rebuildUpperTime = Date.now();
    const activeLiveEpochId =
      this.dependencies.policy.activeConsent()?.id ?? null;
    const epochIds = new Set(epochs.map((epoch) => epoch.id));
    const priorGrants = Object.values(before.backfillGrants).filter(
      (grant): grant is ChatBackfillGrant =>
        grant.boundary === "chat" &&
        grant.providerDataInstanceId === previousInstanceId &&
        epochIds.has(grant.consentEpochId)
    );
    /* job capability 恒为 purpose=rebuild、不占 admission 槽位；
       grants 用它的 id 隔离，暂停/恢复动的是 live 槽位，与 job 互不干涉。 */
    await this.dependencies.policy.createConsent({
      operationId: `${operationId}:consent`,
      providerDataInstanceId: target.providerDataInstanceId,
      providerId: target.providerId,
      extractionHostname: destination.hostname,
      extractionModel: destination.model,
      sharingMode: currentSharing.sharingMode,
      effectiveAt: rebuildUpperTime,
      silent: true,
      purpose: "rebuild",
    });
    const consent = this.rebuildEpochFor(operationId, target);
    if (!consent) throw new Error("Rebuild Consent 未发布");
    let granted = 0;
    for (const summary of await this.dependencies.listChatSummaries()) {
      const chat = await this.inspectNativeChat(summary);
      if (!chat) continue;
      const source = sourceSessionKey({
        chatId: chat.id,
        incarnationId: chat.incarnationId,
      });
      if (before.tombstones[source]) continue;
      const spaceId = memorySpaceId(
        this.dependencies.policy.spaceFor(
          resolveMemoryScopeSubject(
            {
              chatId: chat.id,
              incarnationId: chat.incarnationId,
              projectId: chat.projectId,
            },
            currentSharing.sharingMode,
            before.scopeOwnerId
          )
        )
      );
      const intervals = [
        /* 未闭合（revokedAt=null）的 Epoch 只有一个合法形态：当前 active 的
           live Epoch——它确实授权到此刻。其它任何未闭合 Epoch 都是撤销边
           遗漏的产物，fail-closed 跳过，宁缺勿把未授权窗口伪造成历史。 */
        ...epochs
          .filter(
            (epoch) =>
              epoch.revokedAt !== null || epoch.id === activeLiveEpochId
          )
          .map((epoch) => ({
            lowerTime: epoch.effectiveAt,
            upperTime: epoch.revokedAt ?? rebuildUpperTime,
            upperSeq: summary.lastSeq,
            kind: `epoch:${epoch.id}`,
          })),
        ...priorGrants.flatMap((grant) => {
          const upperSeq = grant.upperSeqBySession[source];
          return upperSeq === undefined
            ? []
            : [{
                lowerTime: grant.lowerTime,
                upperTime: grant.upperTime,
                upperSeq,
                kind: `grant:${grant.id}`,
              }];
        }),
      ];
      for (const interval of intervals) {
        if (interval.upperTime < (interval.lowerTime ?? 0)) continue;
        if (!(await this.inspectNativeChat(summary, interval))?.hasMemorable) continue;
        const previewDigest = stableMemoryDigest({
          operationId,
          source,
          ...interval,
        });
        await this.dependencies.policy.addBackfillGrant({
          boundary: "chat",
          id: `rebuild-grant:${previewDigest}`,
          memorySpaceId: spaceId,
          chatIncarnations: [chat.incarnationId],
          upperSeqBySession: { [source]: interval.upperSeq },
          upperTime: interval.upperTime,
          lowerTime: interval.lowerTime,
          providerDataInstanceId: target.providerDataInstanceId,
          consentEpochId: consent.id,
          previewDigest,
        });
        granted += 1;
      }
    }
    return { granted, rebuildEpochId: consent.id };
  }

  /** 本轮 job 的 rebuild Epoch：按 purpose+instance 直查，幂等重放时同样成立。 */
  private rebuildEpochFor(operationId: string, target: MemoryEffectiveTarget) {
    void operationId;
    return (
      Object.values(this.dependencies.policy.snapshot().state.consentEpochs).find(
        (epoch) =>
          epoch.purpose === "rebuild" &&
          epoch.revokedAt === null &&
          epoch.providerDataInstanceId === target.providerDataInstanceId
      ) ?? null
    );
  }

  /** rebuild 收尾的 live 授权迁移：这是用户「开始重建」显式确认动作的必然
      结果（目的地逐字继承 job Epoch），不是自发签发——§6.1 禁止的是无
      用户动作凭据的后台 Epoch。未暂停且 live 授权缺失或仍指向旧 instance
      时才迁移；用户暂停中则什么都不做，resume 时按普通路径重新授权。 */
  async completeRebuild(operationId: string, target: MemoryEffectiveTarget) {
    const snapshot = this.dependencies.policy.snapshot();
    if (snapshot.state.pausedAt !== null || !target.providerDataInstanceId) return;
    const live = this.dependencies.policy.activeConsent(snapshot);
    if (!live || live.providerDataInstanceId === target.providerDataInstanceId) {
      return;
    }
    const source = this.rebuildEpochFor(operationId, target);
    if (!source) return;
    await this.dependencies.policy.createConsent({
      operationId: `${operationId}:live-consent`,
      providerDataInstanceId: target.providerDataInstanceId,
      providerId: target.providerId,
      extractionHostname: source.extractionHostname,
      extractionModel: source.extractionModel,
      sharingMode: source.sharingMode,
      effectiveAt: Date.now(),
      silent: true,
    });
  }

  private async history(
    excludedChatIds: ReadonlySet<string>,
    sharingMode: MemorySharingMode,
    sharingGeneration: number,
    policy: ReturnType<MemoryPolicyStore["snapshot"]>
  ) {
    const summaries = await this.dependencies.listChatSummaries();
    let chats = 0;
    let turns = 0;
    let from = Number.POSITIVE_INFINITY;
    let to = 0;
    let gaps = 0;
    const boundaries: HistoryBoundary[] = [];
    for (const summary of summaries) {
      if (excludedChatIds.has(summary.id)) continue;
      const chat = await this.inspectNativeChat(summary);
      if (!chat) continue;
      const upperSeq = Math.min(summary.lastSeq, chat.lastSeq);
      const upperTime = chat.to;
      chats += 1;
      turns += chat.turns;
      gaps += summary.trimmedThroughSeq > 0 ? 1 : 0;
      from = Math.min(from, chat.from);
      to = Math.max(to, chat.to);
      const source = sourceSessionKey({
        chatId: chat.id,
        incarnationId: chat.incarnationId,
      });
      const subject = resolveMemoryScopeSubject(
        {
          chatId: chat.id,
          incarnationId: chat.incarnationId,
          projectId: chat.projectId,
        },
        sharingMode,
        policy.state.scopeOwnerId
      );
      boundaries.push({
        chatId: chat.id,
        incarnationId: chat.incarnationId,
        sourceSessionKey: source,
        memorySpaceId: memorySpaceId(
          memorySpaceForSubject(
            subject,
            this.dependencies.policy.generationFor(subject, policy),
            sharingGeneration
          )
        ),
        upperSeq,
        upperTime,
      });
    }
    return {
      stats: {
        chats,
        turns,
        from: Number.isFinite(from) ? from : null,
        to: to || null,
        gaps,
      },
      boundaries: boundaries.sort((left, right) =>
        left.sourceSessionKey.localeCompare(right.sourceSessionKey)
      ),
    };
  }

  private async prepareHistoryGrants(
    preview: MemoryConsentPreview,
    boundaries: ReadonlyArray<HistoryBoundary>
  ) {
    const policy = this.dependencies.policy.snapshot();
    const grants: Array<
      Omit<
        ChatBackfillGrant,
        "createdAt" | "revokedAt" | "consentEpochId"
      >
    > = [];
    for (const boundary of boundaries) {
      const chat = await this.inspectNativeChat({
        id: boundary.chatId,
        incarnationId: boundary.incarnationId,
        lastSeq: boundary.upperSeq,
        trimmedThroughSeq: 0,
      });
      if (!chat) continue;
      const subject = resolveMemoryScopeSubject(
          {
            chatId: chat.id,
            incarnationId: chat.incarnationId,
            projectId: chat.projectId,
          },
          preview.nextSharingMode,
          policy.state.scopeOwnerId
        );
      const space = memorySpaceForSubject(
        subject,
        this.dependencies.policy.generationFor(subject, policy),
        preview.nextSharingGeneration
      );
      if (memorySpaceId(space) !== boundary.memorySpaceId) {
        throw new Error("Memory 历史预览的 Space 已变化，请重新确认");
      }
      grants.push({
        boundary: "chat",
        id: `product-grant:${stableMemoryDigest({
          previewDigest: preview.digest,
          sourceSessionKey: boundary.sourceSessionKey,
          upperSeq: boundary.upperSeq,
          upperTime: boundary.upperTime,
        })}`,
        memorySpaceId: boundary.memorySpaceId,
        chatIncarnations: [chat.incarnationId],
        upperSeqBySession: {
          [boundary.sourceSessionKey]: boundary.upperSeq,
        },
        upperTime: boundary.upperTime,
        lowerTime: null,
        providerDataInstanceId: preview.providerDataInstanceId,
        previewDigest: preview.digest,
      });
    }
    return grants;
  }

  private async inspectNativeChat(
    summary: ChatSummary,
    interval?: { lowerTime: number | null; upperTime: number; upperSeq: number }
  ) {
    const inspect = (input: {
      id: string;
      incarnationId: string;
      projectId: string | null;
      homeDir: string | null;
      lastSeq: number;
      trimmedThroughSeq: number;
      pages: AsyncIterable<Readonly<{
        precedingUser: ChatMessage | null;
        messages: readonly ChatMessage[];
      }>>;
    }) => this.inspectNativePages(input, summary, interval);
    if (!this.dependencies.readNativeChatSegment) {
      const chat = await this.dependencies.readChat(summary.id);
      if (!chat || chat.readOnlyReason) return null;
      return inspect({
        id: chat.id,
        incarnationId: chat.incarnationId,
        projectId: chat.projectId,
        homeDir: chat.homeDir ?? null,
        lastSeq: chat.messages.at(-1)?.seq ?? 0,
        trimmedThroughSeq: chat.trimmedThroughSeq ?? 0,
        pages: oneNativePage(chat.messages),
      });
    }
    const first = await this.dependencies.readNativeChatSegment(summary.id, 0, 128);
    if (!first) return null;
    const read = this.dependencies.readNativeChatSegment;
    return inspect({ ...first, pages: nativeSegmentPages(first, read) });
  }

  private async inspectNativePages(
    input: {
      id: string;
      incarnationId: string;
      projectId: string | null;
      homeDir: string | null;
      lastSeq: number;
      trimmedThroughSeq: number;
      pages: AsyncIterable<Readonly<{
        precedingUser: ChatMessage | null;
        messages: readonly ChatMessage[];
      }>>;
    },
    summary: ChatSummary,
    interval?: { lowerTime: number | null; upperTime: number; upperSeq: number }
  ) {
    if (input.incarnationId !== summary.incarnationId) return null;
    let turns = 0;
    let from = Number.POSITIVE_INFINITY;
    let to = 0;
    let hasMemorable = false;
    let lastUser: UserChatMessage | null = null;
    for await (const page of input.pages) {
      if (page.precedingUser?.role === "user") lastUser = page.precedingUser;
      for (const message of page.messages) {
        if (message.seq > summary.lastSeq) continue;
        from = Math.min(from, message.createdAt);
        to = Math.max(to, message.createdAt);
        if (message.role === "user") lastUser = message;
        if (message.role !== "assistant" || !isMemorableAssistant(message)) continue;
        turns += 1;
        const at = lastUser?.createdAt;
        if (
          interval && at !== undefined && message.seq <= interval.upperSeq &&
          at <= interval.upperTime &&
          (interval.lowerTime === null || at >= interval.lowerTime)
        ) hasMemorable = true;
      }
    }
    return {
      id: input.id,
      incarnationId: input.incarnationId,
      projectId: input.projectId,
      homeDir: input.homeDir,
      lastSeq: input.lastSeq,
      trimmedThroughSeq: input.trimmedThroughSeq,
      turns,
      from,
      to,
      hasMemorable,
    };
  }
}

async function* oneNativePage(messages: readonly ChatMessage[]) {
  yield { precedingUser: null, messages };
}

async function* nativeSegmentPages(
  first: MemoryNativeSegmentPage,
  read: NonNullable<ConsentControllerDependencies["readNativeChatSegment"]>
) {
  let page: MemoryNativeSegmentPage | null = first;
  while (page) {
    yield page;
    page = page.nextAfterSeq === null
      ? null
      : await read(page.id, page.nextAfterSeq, 128);
  }
}

export function assertConsentPreviewInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory 预览参数无效");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.providerId !== "string" ||
    typeof input.includeHistory !== "boolean" ||
    !["enable", "cutover", "sharing", "rebuild"].includes(
      String(input.reason)
    ) ||
    !MEMORY_SHARING_MODES.includes(input.sharingMode as MemorySharingMode)
  ) {
    throw new Error("Memory 预览参数无效");
  }
  return {
    providerId: input.providerId,
    includeHistory: input.includeHistory,
    reason: input.reason as MemoryConsentReason,
    sharingMode: input.sharingMode as MemorySharingMode,
  };
}

export function assertConsentAuthorityInput(value: unknown) {
  const input = assertConsentPreviewInput(value);
  const previewDigest = (value as Record<string, unknown>).previewDigest;
  if (typeof previewDigest !== "string" || !/^[a-f0-9]{64}$/.test(previewDigest)) {
    throw new Error("Memory 确认摘要无效");
  }
  return { ...input, previewDigest };
}
