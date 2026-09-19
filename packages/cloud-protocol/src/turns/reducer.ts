/**
 * [INPUT]: Depends on portable turn items, parts and product failures.
 * [OUTPUT]: Provides the sole live and terminal Chat draft reducer.
 * [POS]: Canonical reducer shared by desktop persistence, browser projection and server sealing.
 */
import type { AgentSubagentStatus, AgentTurnItem } from "./items";
import type { ProductFailure } from "../chats/content/failure";
import { MESSAGE_PART_LIMIT } from "../chats/content/budgets";
import type { ChatPart, ChatToolPart } from "../chats/content/parts";
type ChatTextPart = Extract<ChatPart, { type: "text" }>;
type ChatSubagentPart = Extract<ChatPart, { type: "subagent" }>;

export type DraftToolPart = Omit<ChatToolPart, "status"> & {
  status: "running" | "completed" | "failed";
};
export type DraftSubagentPart = Omit<ChatSubagentPart, "status"> & {
  status: "running" | "completed" | "failed";
};
export type DraftPart = ChatTextPart | DraftToolPart | DraftSubagentPart;


export type SubagentSettleOutcome = "completed" | "interrupted";


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

type FinalizedTurn = {
  content: string;
  parts?: ChatPart[];
  durationMs: number;

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
        ? { ...part, status: "failed" as const, completion: "interrupted" as const, completionReason: "execution-unconfirmed" as const }
        :
          part.type === "subagent" && part.status === "running"
          ? { ...part, status: SUBAGENT_PART_STATUS[subagentOutcome], ...(subagentOutcome === "interrupted" ? { completion: "interrupted" as const, completionReason: "execution-unconfirmed" as const } : {}) }
        : (part as ChatPart)
    );
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

type SettledTurn = FinalizedTurn & { isError?: boolean; failure?: ProductFailure };


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
