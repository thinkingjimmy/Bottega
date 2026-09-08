/**
 * [INPUT]: Depends on shared task identities/phases and Lucide status icons.
 * [OUTPUT]: Provides stable task keys, phase translation keys, and distinct static status symbols.
 * [POS]: Shared presentation vocabulary for the compact strip and expanded task rows.
 */
import React from "react";
import { Check, CircleAlert, Clock3, MessageCircleQuestion, Minus, ShieldQuestion, Zap } from "lucide-react";
import type { TaskPhase, TaskReference } from "../../shared/presence-ipc";

export const taskKey = (task: TaskReference) => `${task.chatId}:${task.incarnationId}`;
export const phaseKey = (phase: TaskPhase) => phase === "running" ? "active" : phase === "failed" ? "taskFailed" : phase;
export function TaskStateIcon({ phase }: { phase: TaskPhase }) {
  const Icon = phase === "approval" ? ShieldQuestion : phase === "answer" ? MessageCircleQuestion
    : phase === "recovery" || phase === "failed" ? CircleAlert : phase === "completed" ? Check
    : phase === "cancelled" ? Minus : phase === "preparing" || phase === "finishing" ? Clock3 : Zap;
  return <Icon className="state-icon" aria-hidden="true" />;
}
