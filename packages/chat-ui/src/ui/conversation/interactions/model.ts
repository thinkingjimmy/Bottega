/**
 * [INPUT]: The cloud live projection shapes.
 * [OUTPUT]: Provides ApprovalDecision, ApprovalRequest and PendingQuestion — the types both cards and every host share.
 * [POS]: conversation/interactions' vocabulary; it renders nothing and decides nothing.
 */
import type { LiveProjection } from "@ai-chat/cloud-protocol/turns/live";
export type ApprovalDecision = "accept" | "accept-for-session" | "decline" | `choice:${number}`;
export type ApprovalRequest = Omit<LiveProjection["approvals"][number], "choices"> & {
  cwd?: string;
  choices?: { decision: ApprovalDecision; label: string; tone: "primary" | "secondary" | "danger" }[];
};
export type PendingQuestion = {
  request: LiveProjection["userInputs"][number];
  index: number;
  queue: LiveProjection["userInputs"];
  busy: boolean;
  error: string | { copyKey: string };
  expiresAt?: number;
};
