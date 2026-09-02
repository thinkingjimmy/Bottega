/**
 * [INPUT]: Depends on shared Chat and Agent IPC turn-item vocabulary
 * [OUTPUT]: Provides sequential TurnDraft, Plan projection, delta/item/finalize state machines, ProductFailure-preserving terminal and warning projection, and the SubagentSettleOutcome ruler that converges still-running subagents by the turn's own terminal
 * [POS]: Shared turn-state core consumed by main persistence and renderer live projection
 */

import type { AgentSubagentStatus, AgentTurnItem } from "./agent-ipc";
import type { ProductFailure } from "./product-failure";
import {
  MESSAGE_PART_LIMIT,
  type ChatPart,
  type ChatSubagentPart,
  type ChatTextPart,
  type ChatToolPart,
} from "./chats-ipc";

export type DraftToolPart = Omit<ChatToolPart, "status"> & {
  status: "running" | "completed" | "failed";
};
export type DraftSubagentPart = Omit<ChatSubagentPart, "status"> & {
  status: "running" | "completed" | "failed";
};
export type DraftPart = ChatTextPart | DraftToolPart | DraftSubagentPart;

/* ============================================================
 * 子 agent 收敛口径：wire **只在真被打断时**才下发终态，「turn 结束时它还
 * 是 running」在善终 turn 里等于「它跑完了」。恒判中断会把成功的子 agent
 * 落盘成失败、UI 画红叉。收敛值因此由 **turn 终态**给出，而不是猜：
 *   done → completed；cancelled / error → interrupted。
 * part（completed｜failed）与 meta（completed｜interrupted）是两套词表，
 * 但只有这一个来源，映射也只有 SUBAGENT_PART_STATUS 这一张表。
 * ============================================================ */
export type SubagentSettleOutcome = "completed" | "interrupted";

/** 子 agent 状态 → part 展示态：applySubagent 与 finalize 共用的唯一尺子。
 *  写成全枚举表而非分支链，是为了让 SubagentSettleOutcome 这个封闭二元子集
 *  在类型上直接落到 `completed｜failed`，不必再补一句断言。 */
const SUBAGENT_PART_STATUS = {
  pendingInit: "running",
  running: "running",
  completed: "completed",
  shutdown: "completed",
  interrupted: "failed",
  errored: "failed",
  notFound: "failed",
} as const satisfies Record<AgentSubagentStatus, DraftSubagentPart["status"]>;

export type TurnDraft = {
  startedAt: number;
  parts: DraftPart[];
  streaming: ReadonlyMap<string, string>;
  plan?: {
    itemId: string;
    status: "editing" | "completed";
  };
};

export type SerializedTurnDraft = Omit<TurnDraft, "streaming"> & {
  streaming: [string, string][];
};

export type DraftPlanProjection = {
  itemId: string;
  content: string;
  editing: boolean;
};

/** 结构性事实优先于过程噪声：subagent 与用户问答不该被 reasoning/command 洪流挤出 */
const isProtected = (part: ChatPart) =>
  part.type === "subagent" ||
  (part.type === "tool" &&
    (part.tool === "user-input" || part.tool === "agent-failure"));

export function slicePartsProtected(
  parts: ChatPart[],
  limit = MESSAGE_PART_LIMIT
) {
  if (parts.length <= limit) return parts;
  const protectedIndexes = parts.flatMap((part, index) =>
    isProtected(part) ? [index] : []
  ).slice(-limit);
  const retained = new Set(protectedIndexes);
  for (let index = parts.length - 1; index >= 0 && retained.size < limit; index -= 1) {
    retained.add(index);
  }
  return parts.filter((_part, index) => retained.has(index));
}

export const createDraft = (startedAt: number): TurnDraft => ({
  startedAt,
  parts: [],
  streaming: new Map(),
});

export const serializeDraft = (draft: TurnDraft): SerializedTurnDraft => ({
  ...draft,
  streaming: [...draft.streaming],
});

export const hydrateDraft = (draft: SerializedTurnDraft): TurnDraft => ({
  ...draft,
  streaming: new Map(draft.streaming),
});

export function applyDelta(draft: TurnDraft, itemId: string, text: string) {
  const streaming = new Map(draft.streaming);
  streaming.set(itemId, `${streaming.get(itemId) ?? ""}${text}`);
  return { ...draft, streaming };
}

const upsert = (parts: DraftPart[], next: DraftPart) => {
  const index = parts.findIndex((part) => part.itemId === next.itemId);
  return index < 0
    ? [...parts, next]
    : [...parts.slice(0, index), next, ...parts.slice(index + 1)];
};

export function applyItem(draft: TurnDraft, item: AgentTurnItem): TurnDraft {
  if (item.kind === "agent-message" || item.kind === "plan") {
    if (item.status === "running") {
      return item.kind === "plan"
        ? {
            ...draft,
            streaming: new Map(draft.streaming).set(
              item.itemId,
              item.text ?? ""
            ),
            plan: { itemId: item.itemId, status: "editing" },
          }
        : draft;
    }
    const streaming = new Map(draft.streaming);
    streaming.delete(item.itemId);
    return {
      ...draft,
      streaming,
      ...(item.kind === "plan"
        ? {
            plan: {
              itemId: item.itemId,
              status: "completed" as const,
            },
          }
        : {}),
      parts: upsert(draft.parts, {
        type: "text",
        itemId: item.itemId,
        text: item.text ?? "",
        ...(item.kind === "plan" ? { kind: "plan" as const } : {}),
      }),
    };
  }
  return {
    ...draft,
    parts: upsert(draft.parts, {
      type: "tool",
      itemId: item.itemId,
      tool: item.kind,
      title: item.title,
      ...(item.detail ? { detail: item.detail } : {}),
      status: item.status,
      ...(item.failure ? { failure: item.failure } : {}),
      ...(item.severity ? { severity: item.severity } : {}),
    }),
  };
}

export function applyItemRemoved(
  draft: TurnDraft,
  itemId: string
): TurnDraft {
  const streaming = new Map(draft.streaming);
  streaming.delete(itemId);
  return {
    ...draft,
    streaming,
    parts: draft.parts.filter((part) => part.itemId !== itemId),
    ...(draft.plan?.itemId === itemId ? { plan: undefined } : {}),
  };
}

export function projectDraftPlan(
  draft: TurnDraft
): DraftPlanProjection | null {
  if (!draft.plan) return null;
  const completed = draft.parts.find(
    (part) =>
      part.type === "text" &&
      part.kind === "plan" &&
      part.itemId === draft.plan?.itemId
  );
  return {
    itemId: draft.plan.itemId,
    content:
      draft.streaming.get(draft.plan.itemId) ??
      (completed?.type === "text" ? completed.text : ""),
    editing: draft.plan.status === "editing",
  };
}

export function applySubagent(
  draft: TurnDraft,
  agent: {
    agentThreadId: string;
    name: string;
    status: string;
    origin?: ChatSubagentPart["origin"];
    agent?: ChatSubagentPart["agent"];
  }
): TurnDraft {
  const status =
    SUBAGENT_PART_STATUS[agent.status as AgentSubagentStatus] ?? "failed";
  return {
    ...draft,
    parts: upsert(draft.parts, {
      type: "subagent",
      itemId: `subagent:${agent.agentThreadId}`,
      agentThreadId: agent.agentThreadId,
      name: agent.name,
      status,
      ...(agent.origin ? { origin: agent.origin } : {}),
      ...(agent.agent ? { agent: agent.agent } : {}),
    }),
  };
}

export type FinalizedTurn = {
  content: string;
  parts?: ChatPart[];
  durationMs: number;
  /** content 来自原生 plan item（计划正文是本轮权威产出） */
  plan?: true;
};

export function finalize(
  draft: TurnDraft,
  endedAt: number,
  planRequested = true,
  subagentOutcome: SubagentSettleOutcome = "interrupted"
): FinalizedTurn {
  const parts: DraftPart[] = [...draft.parts];
  for (const [itemId, text] of draft.streaming) {
    if (text && !parts.some((part) => part.itemId === itemId)) {
      parts.push({ type: "text", itemId, text });
    }
  }
  const settled: ChatPart[] = parts
    .filter((part) => part.type !== "text" || part.text.trim())
    .map((part) =>
      part.type === "tool" && part.status === "running"
        ? { ...part, status: "failed" as const }
        : /* 工具没报完成就是失败（工具必报终态）；子 agent 不是——它的终态
             由 turn 终态收敛，见 SubagentSettleOutcome。 */
          part.type === "subagent" && part.status === "running"
          ? { ...part, status: SUBAGENT_PART_STATUS[subagentOutcome] }
        : (part as ChatPart)
    );
  // 最终正文取「最后一个 plan part，否则最后一条 text」——计划是本轮权威产出，
  // 它之前/之后的普通文本（开场白、补充说明）一律沉入折叠过程区。
  const texts = settled
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.type === "text") as Array<{
    part: ChatTextPart;
    index: number;
  }>;
  const finalText = planRequested
    ? texts.filter(({ part }) => part.kind === "plan").at(-1) ?? texts.at(-1)
    : texts.filter(({ part }) => part.kind !== "plan").at(-1);
  const content = finalText?.part.text ?? "";
  const remaining = slicePartsProtected(finalText
    ? settled.filter((_part, index) => index !== finalText.index)
    : settled, MESSAGE_PART_LIMIT);
  return {
    content,
    ...(remaining.length ? { parts: remaining } : {}),
    durationMs: Math.max(0, endedAt - draft.startedAt),
    ...(finalText?.part.kind === "plan" ? { plan: true as const } : {}),
  };
}

export type SettledTurn = FinalizedTurn & { isError?: boolean; failure?: ProductFailure };

/** 失败归属与失败原因必须同行：只给 message 的旧签名让调用方无从表达"谁失败了"。 */
export type TurnFailure = { agent?: string; message?: string; failure?: ProductFailure };

export function settle(
  draft: TurnDraft,
  endedAt: number,
  failure?: TurnFailure,
  planRequested = true,
  subagentOutcome: SubagentSettleOutcome = "interrupted"
): SettledTurn | null {
  const result = finalize(draft, endedAt, planRequested, subagentOutcome);
  if (!failure) return result.content || result.parts ? result : null;
  const parts = [...(result.parts ?? [])];
  if (result.content) {
    parts.push({ type: "text", itemId: "partial-final", text: result.content });
  }
  const content = failure.message
    ? `${failure.agent ? `**${failure.agent}:** ` : ""}${failure.message}`
    : "";
  return {
    content,
    ...(parts.length ? { parts } : {}),
    durationMs: result.durationMs,
    isError: true as const,
    ...(failure.failure ? { failure: failure.failure } : {}),
  };
}

export function shimmerLabel(
  draft: TurnDraft,
  hasPendingApproval: boolean,
  queued = false
) {
  if (queued) return "排队中…";
  if (hasPendingApproval) return "Waiting for approval";
  if (draft.streaming.size) return "Responding";
  const running = [...draft.parts]
    .reverse()
    .find((part) => part.type === "tool" && part.status === "running");
  return running?.type === "tool" ? running.title : "Thinking";
}
