/**
 * [INPUT]: Projected turn content, elapsed timestamps, an activity label and host translation.
 * [OUTPUT]: ConversationDraft and ConversationElapsed with one native activity indicator.
 * [POS]: Shared live-turn presentation for native and remote transcript adapters.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Message } from "@ai-chat/ui/components/ai-elements/message";
import { ThinkingShimmer } from "@ai-chat/ui/components/ai-elements/thinking-shimmer";
import { ConversationProcessHeading } from "@ai-chat/ui/components/conversation/process";

export function ConversationElapsed({ startedAt, endedAt, label }: {
  startedAt: number; endedAt?: number; label(durationMs: number, finished: boolean): string;
}) {
  const [now, setNow] = useState(() => endedAt ?? Date.now());
  useEffect(() => {
    if (endedAt !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [endedAt]);
  return <ConversationProcessHeading label={label(Math.max(0, (endedAt ?? now) - startedAt), endedAt !== undefined)} />;
}

export function ConversationDraft({ children, elapsed, label, active = true, editingPlan = false }: {
  children?: ReactNode; elapsed?: ReactNode; label: string; active?: boolean; editingPlan?: boolean;
}) {
  return <Message from="assistant">{elapsed}{children}
    {active && !editingPlan && <ThinkingShimmer>{label}</ThinkingShimmer>}
  </Message>;
}
