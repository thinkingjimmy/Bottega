/**
 * [INPUT]: Depends on SettledTurn from chat-turn-reducer ((plan tag + content) and DTO approval from agent-ipc
 * [OUTPUT]: Provides main/renderer shared, explicitly blocked PlanRequested Plan message classification pure function, and reconnects with plan-review mode after decision
 * [POS]: The shared Plan End-Mode classification is a single source of truth; The original plan item is not intended to be used as a guessing item; The main task of the project is to create a new version of the project
 */

import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
} from "./agent-ipc";

/** 与 TurnSnapshot.terminal / SourceTerminal.type 同词表，调用方零翻译直传 */
export type ChatTurnTerminal = "done" | "cancelled" | "error";

export function planMessageKind(
  terminal: ChatTurnTerminal,
  settled: { plan?: true; content: string },
  planRequested = true
): "plan" | undefined {
  return planRequested &&
    settled.plan &&
    terminal === "done" &&
    settled.content.trim()
    ? "plan"
    : undefined;
}

/* ── plan-review 决策 → 是否仍在 Plan 中 ──────────────────────
 * Claude 的 "plan"（继续完善）、Kimi 的 "plan_revise"（要求修改）与
 * Codex 的 "revise_plan"（No, and tell Codex what to do differently）
 * 都意味着本轮剩余产出仍是计划；其余选项（批准各档 —— 含 codex 的
 * "implement_plan" —— 与拒绝退出）一律离开 Plan。
 * undefined = 非 plan-review 或选项已失效，不表态。
 *
 * 这张表**必须与 map-events 的 plan-review 识别同时生效**：识别不出来
 * ⇒ purpose 不是 plan-review ⇒ 此函数恒 undefined ⇒ main 不更新
 * planRequested ⇒ 已实施的 turn 仍被 planMessageKind 判成计划消息、
 * 二次弹卡。2026-08-27 codex-acp 1.6.2 就是这么炸的（见 acp/map-events
 * 的 codex 双判据注释），负向用例钉在 acp-transport.test.ts。
 * ────────────────────────────────────────────────────────── */
const PLAN_CONTINUE_OPTION_IDS = new Set([
  "plan",
  "plan_revise",
  "revise_plan",
]);

export function planModeAfterPlanReview(
  approval: Pick<AgentApprovalRequest, "purpose" | "choices">,
  decision: AgentApprovalDecision
): boolean | undefined {
  if (approval.purpose !== "plan-review") return undefined;
  const choice = approval.choices?.find(
    (candidate) => candidate.decision === decision
  );
  return choice ? PLAN_CONTINUE_OPTION_IDS.has(choice.optionId) : undefined;
}
