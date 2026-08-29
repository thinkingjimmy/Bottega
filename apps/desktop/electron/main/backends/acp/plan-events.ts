/**
 * [INPUT]: Depends on ACP native plan updates and the shared Agent turn-item DTO
 * [OUTPUT]: Provides stable native Plan identity, snapshot mapping, removal, turn-finalization helpers, and the shared plan-entry checklist renderer
 * [POS]: ACP plan lifecycle primitive, separated from the general session-update translator
 */

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentTurnItem } from "../../../../shared/agent-ipc";

export type NativePlanState = {
  itemId: string;
  text: string;
  finalized: boolean;
};

type NativePlanEventState = {
  nativePlans: Map<string, NativePlanState>;
  turnFinalized: boolean;
};

type NativePlanEvent =
  | { type: "item"; item: AgentTurnItem }
  | { type: "item-removed"; itemId: string };

export function planEntryText(
  entries: ReadonlyArray<{ status: string; content: string }>
) {
  return entries
    .map((entry) => {
      const marker =
        entry.status === "completed"
          ? "x"
          : entry.status === "in_progress"
            ? ">"
            : " ";
      return `- [${marker}] ${entry.content}`;
    })
    .join("\n");
}

function planText(
  plan: Extract<SessionUpdate, { sessionUpdate: "plan_update" }>["plan"]
) {
  if (plan.type === "markdown") return plan.content;
  if (plan.type === "items") return planEntryText(plan.entries);
  return `Plan file: ${plan.uri}`;
}

const itemIdFor = (planId: string) => `acp-plan:${planId}`;

function itemOf(plan: NativePlanState): NativePlanEvent {
  return {
    type: "item",
    item: {
      itemId: plan.itemId,
      kind: "plan",
      title: "Plan",
      text: plan.text,
      status: plan.finalized ? "completed" : "running",
    },
  };
}

export function mapNativePlanUpdate(
  state: NativePlanEventState,
  plan: Extract<SessionUpdate, { sessionUpdate: "plan_update" }>["plan"]
) {
  const current = state.nativePlans.get(plan.planId);
  const next: NativePlanState = {
    itemId: current?.itemId ?? itemIdFor(plan.planId),
    text: planText(plan),
    finalized: current?.finalized ?? false,
  };
  state.nativePlans.set(plan.planId, next);
  return itemOf(next);
}

export function removeNativePlan(
  state: NativePlanEventState,
  planId: string
): NativePlanEvent | undefined {
  // ACP v1 cannot retract an already committed ChatMessage item across turns.
  if (state.turnFinalized) return undefined;
  const current = state.nativePlans.get(planId);
  if (!current) return undefined;
  state.nativePlans.delete(planId);
  return { type: "item-removed", itemId: current.itemId };
}

export function finalizeNativePlan(
  state: NativePlanEventState,
  planId: string,
  fallbackText?: string
): NativePlanEvent | undefined {
  const current = state.nativePlans.get(planId);
  /* `||` 而非 `??`：空快照（entries 为空的 items、空 markdown）是真会到的
     形态，它不该把 plan review 随请求捎来的完整计划正文挡在门外——否则
     「先收一份空 plan_update，再收决策卡」这一序列会一个 Plan 块都不出。 */
  const text = current?.text || fallbackText;
  if (!text) return undefined;
  const next: NativePlanState = {
    itemId: current?.itemId ?? itemIdFor(planId),
    text,
    finalized: true,
  };
  state.nativePlans.set(planId, next);
  return itemOf(next);
}

export function finalizeNativePlans(state: NativePlanEventState) {
  state.turnFinalized = true;
  return [...state.nativePlans].flatMap(([planId]) => {
    const event = finalizeNativePlan(state, planId);
    return event ? [event] : [];
  });
}
