/**
 * [INPUT]: No external dependencies; a self-contained pure rule module
 * [OUTPUT]: Provides PlanDecision type and implement/revise/skip follow-up turn alignment rules
 * [POS]: Renderer's purely rule-based Plan decision layer; a Plan message's authority classification is decided once (cached by shared/chat-plan-kind, computed in main) and never recomputed by the renderer
 */

export type PlanDecision =
  | { kind: "implement" }
  | { kind: "revise"; feedback: string }
  | { kind: "skip" };

export function planDecisionInput(
  decision: PlanDecision
): { displayText: string; planMode: boolean } | null {
  if (decision.kind === "skip") return null;
  if (decision.kind === "implement") {
    return { displayText: "Implement this plan.", planMode: false };
  }
  const displayText = decision.feedback.trim();
  return displayText ? { displayText, planMode: true } : null;
}
