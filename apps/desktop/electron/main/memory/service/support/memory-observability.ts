/**
 * [INPUT]: Depends on Policy/Delivery/RecallStats, MemoryAuthority/Network, turn receipt and Chat headings read-only ports
 * [OUTPUT]: PrOvides pause, still retain the state/provide projections in the final authorization range, first cut back and then O(1) metadata source line, recall execution, prompt contribution and settled recall calculation purely compile functions
 * [POS]: The coordinated boundaries of the main/memory/service/support observation; MemoryService only has owner and lifecycle, no statistics/recall algorithms
 */

import type {
  MemoryEffectiveTarget,
  MemoryStatusSnapshot,
  MemorySupplyResult,
  MemorySupplyRow,
} from "../../../../../shared/memory-ipc";
import type { MemorySettings } from "../../../../../shared/settings-ipc";
import type {
  FrozenTurnMemoryAdmission,
  MemoryRecallProjection,
} from "../../core/domain";
import {
  MemoryProviderError,
  PROVIDER_SNIPPET_CHAR_CAP,
} from "../../core/provider";
import { sumStreams, type MemoryDeliveryStore } from "../../delivery/store";
import type { MemoryRebuildController } from "../../orchestration/rebuild-controller";
import type { MemoryTurnSettledEvent } from "../memory-state";
import {
  emptyRecallProjection,
  pausedRecallProjection,
  projectMemoryStatus,
  unavailableRecallProjection,
} from "../memory-status";
import type { MemoryPolicyStore } from "../../policy/store";
import {
  PromptContributionLease,
  renderRecallProjection,
} from "../../prompt-lane";
import type { MemoryHealthMonitor } from "../../runtime/control/health-monitor";
import type { MemoryNetworkRuntime } from "../../runtime/network-runtime";
import {
  combineMemorySignals,
  MemoryAbortError,
  MemoryDeadlineError,
  raceMemoryDeadline,
} from "../../turn-deadline";
import { RecallStatsStore, recallBucketKey } from "../recall-stats";
import type { MemoryAuthorityGuard } from "./memory-authority";
import type { MemoryServiceOptions } from "./memory-service-options";

/* 外部导入的来源键是 `foreign:${sha256}`；只认前缀会让一个恰好叫 foreign 的
   chatId 整行落进外部分支，chatId 与标题一起消失。摘要形状即判据。 */
const FOREIGN_SOURCE_KEY = /^foreign:[a-f0-9]{64}$/;

export function currentMemoryStatus(input: {
  memory: MemorySettings | null;
  target: MemoryEffectiveTarget | null;
  policy: MemoryPolicyStore;
  delivery: MemoryDeliveryStore;
  rebuild: MemoryRebuildController;
  health: MemoryHealthMonitor;
  recallStats: RecallStatsStore;
  lastCaptureAt: number | null;
  warning: string | null;
  recallWarning: string | null;
}): MemoryStatusSnapshot {
  const policy = input.policy.snapshot();
  /* 判据只看 Policy 自己初始化成功没有，与 supply 的 owners 全就绪不是一回事：
     policy 成功而 delivery 失败的窗口里，状态照常投影授权范围（授权事实归 Policy），
     供给明细则返回 disabled（账本真相源没起来，宁可不答）。 */
  const consent = policy.initialized
    ? input.policy.activeConsent(policy) ?? (
        input.memory?.enabled && input.memory.paused
          ? input.policy.latestLiveConsent(policy)
          : null
      )
    : null;
  const sharingScope = consent
    ? {
        providerDataInstanceId: consent.providerDataInstanceId,
        sharingMode: consent.sharingMode,
        sharingGeneration: consent.sharingGeneration,
      }
    : null;
  return projectMemoryStatus({
    ...input,
    sharingScope,
    /* 两个告警属于不同 owner：provider 侧是本次召回的瞬时诊断，统计 owner 侧是
       durable 故障。谁也不许遮蔽谁；瞬时诊断排前，因为它才是用户刚看到的因果。 */
    recallWarning: [
      input.recallWarning,
      input.recallStats.lastError
        ? `召回观测不可用：${input.recallStats.lastError}`
        : null,
    ].filter(Boolean).join("；") || null,
    recall: input.recallStats.projectRecall(
      sharingScope ? recallBucketKey(sharingScope) : null
    ),
    epoch: consent
      ? {
          effectiveAt: consent.effectiveAt,
          sharingGeneration: consent.sharingGeneration,
        }
      : null,
  });
}

export async function performMemoryRecall(input: Readonly<{
  admission: FrozenTurnMemoryAdmission;
  queryText: string;
  signal: AbortSignal;
  deadlineAt: number;
  authority: MemoryAuthorityGuard;
  network: MemoryNetworkRuntime;
  policy: MemoryPolicyStore;
  setWarning(next: string | null): void;
}>): Promise<MemoryRecallProjection> {
  if (input.admission.kind !== "eligible") {
    return emptyRecallProjection(input.admission.requestId);
  }
  const context = input.admission.context;
  let controller: AbortController | null = null;
  let combined: ReturnType<typeof combineMemorySignals> | null = null;
  try {
    const proof = await input.authority.trustedProviderReady(
      context,
      input.signal,
      input.deadlineAt
    );
    controller = input.network.controller();
    combined = combineMemorySignals(input.signal, controller.signal, input.deadlineAt);
    const result = await raceMemoryDeadline(
      proof.provider.recall({
        query: input.queryText,
        workspacePeerId: context.expectedPeerId,
        snippetCharCap: PROVIDER_SNIPPET_CHAR_CAP,
        signal: combined.signal,
      }),
      input.signal,
      input.deadlineAt
    );
    if (!input.authority.validateFrozen(context, proof)) {
      if (input.policy.snapshot().state.pausedAt !== null) {
        return pausedRecallProjection(context.requestId);
      }
      return unavailableRecallProjection(context.requestId, "stale-capability");
    }
    input.setWarning(null);
    return renderRecallProjection({
      requestId: context.requestId,
      result,
      expectedPeerId: context.expectedPeerId,
    });
  } catch (cause) {
    if (cause instanceof MemoryAbortError) {
      return emptyRecallProjection(context.requestId);
    }
    if (input.policy.snapshot().state.pausedAt !== null) {
      return pausedRecallProjection(context.requestId);
    }
    const failureKind = cause instanceof MemoryDeadlineError
      ? "deadline"
      : "provider";
    const detail = cause instanceof MemoryProviderError
      ? `：${cause.message.slice(0, 500)}`
      : "";
    input.setWarning(`Memory 召回失败（${failureKind}）${detail}`);
    return unavailableRecallProjection(context.requestId, failureKind);
  } finally {
    combined?.dispose();
    if (controller) input.network.release(controller);
  }
}

export function prepareMemoryContribution(
  admission: FrozenTurnMemoryAdmission,
  projection: MemoryRecallProjection,
  authority: MemoryAuthorityGuard,
  leases: Set<PromptContributionLease>
) {
  if (
    admission.kind !== "eligible" ||
    (projection.prepared.kind !== "content" && projection.prepared.kind !== "none")
  ) return null;
  const lease = new PromptContributionLease(admission.context.requestId, () =>
    authority.validateContext(admission.context)
  );
  leases.add(lease);
  return {
    kind: "sensitive-context" as const,
    text: projection.promptText,
    count: projection.prepared.kind === "content" ? projection.prepared.count : 0,
    bytes: Buffer.byteLength(projection.promptText, "utf8"),
    consume: () => {
      const result = lease.consume();
      leases.delete(lease);
      return result;
    },
    release: () => {
      lease.revoke();
      leases.delete(lease);
    },
  };
}

export async function recordSettledRecall(
  stats: RecallStatsStore,
  event: MemoryTurnSettledEvent
) {
  const receipt = event.assistantMessage?.role === "assistant"
    ? event.assistantMessage.contextReceipt
    : undefined;
  const admission = event.context?.memory;
  if (event.outcome !== "stored" || !receipt || !admission) return undefined;
  const scope = admission.kind === "eligible"
    ? {
        providerDataInstanceId: admission.context.providerDataInstanceId,
        sharingMode: admission.context.sharingMode,
        sharingGeneration: admission.context.sharingGeneration,
      }
    : admission.kind === "unavailable"
      ? admission.observationScope ?? null
      : null;
  if (!scope) return undefined;
  await stats.recordSettledReceipt(recallBucketKey(scope), receipt, event.requestId);
}

export async function currentMemorySupply(input: {
  enabled: boolean;
  paused: boolean;
  initialized: boolean;
  policy: MemoryPolicyStore;
  delivery: MemoryDeliveryStore;
  readChatRef: MemoryServiceOptions["readChatRef"];
}): Promise<MemorySupplyResult> {
  /* initialized 是 owners 全就绪（Policy + Delivery），比 status 的 policy.initialized
     严格：delivery 初始化失败的窗口里 status 仍有 scope，这里一律 disabled——
     零读零写，绝不让未初始化的 Delivery 账本被读路径顺手创建出来。 */
  if (!input.enabled || !input.initialized) return { state: "disabled" };
  const policy = input.policy.snapshot();
  const consent = input.policy.activeConsent(policy) ??
    (input.paused ? input.policy.latestLiveConsent(policy) : null);
  if (!consent) return { state: "disabled" };
  const providerDataInstanceId = consent.providerDataInstanceId;
  const scope = {
    providerDataInstanceId,
    sharingMode: consent.sharingMode,
    sharingGeneration: consent.sharingGeneration,
  } as const;
  const streams = input.delivery.streamsForSharingScope(providerDataInstanceId, scope);
  const grouped = new Map<string, typeof streams>();
  for (const stream of streams) {
    const rows = grouped.get(stream.sourceSessionKey) ?? [];
    rows.push(stream);
    grouped.set(stream.sourceSessionKey, rows);
  }
  const summaries = [...grouped].map(([id, group]) => ({
    id,
    ...sumStreams(group),
  }));
  summaries.sort((left, right) =>
    (right.delivered + right.pending + right.gap) -
    (left.delivered + left.pending + left.gap)
  );
  const rows: MemorySupplyRow[] = summaries.slice(0, 50).map((summary) => {
    if (FOREIGN_SOURCE_KEY.test(summary.id)) {
      return { ...summary, kind: "foreign" };
    }
    const separator = summary.id.lastIndexOf(":");
    const chatId = separator < 0
      ? summary.id
      : summary.id.slice(0, separator);
    const incarnationId = separator < 0
      ? ""
      : summary.id.slice(separator + 1);
    let chat: ReturnType<MemoryServiceOptions["readChatRef"]> = null;
    try {
      chat = input.readChatRef(chatId);
    } catch {
      /* 单条 metadata 故障只把该来源降为 deleted，不拖垮整份观测。 */
    }
    const matchedChat = chat?.incarnationId === incarnationId ? chat : null;
    return {
      ...summary,
      kind: "chat" as const,
      chatId,
      title: matchedChat?.title ?? null,
      state: !matchedChat
        ? "deleted" as const
        : matchedChat.archivedAt
          ? "archived" as const
          : "active" as const,
    };
  });
  return {
    state: "ready",
    scope,
    rows,
    totalStreams: summaries.length,
    totalDelivered: sumStreams(streams).delivered,
  };
}
