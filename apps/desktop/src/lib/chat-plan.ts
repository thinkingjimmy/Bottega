/**
 * [INPUT]: The unreliable pure rule module
 * [OUTPUT]: Provides PlanDecision type and implement/revise/skip follow-up turn alignment rules
 * [POS]: The renderer Plan is a decision-making framework that is purely rules-based; The authority of the message classification of the Plan is determined when the message is in the shared/chat-plan-kind (main) cache, and the renderer is no longer recalculated
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
