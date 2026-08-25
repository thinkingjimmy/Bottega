/**
 * [INPUT]: Depends on React Local feedback text, lucide icons and runtime provided Plan decision status/action
 * [OUTPUT]: Provides ChatPlanDecision, which presents implementation, feedback planning and three paths of certainty skipping
 * [POS]: The Plan completion mode of chat/composer is replaced; Only collect user intent, and the actual turn mode switches to runtime
 */

import { useState } from "react";
import { ArrowRightIcon, PenLineIcon, XIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { PlanDecision } from "@/lib/chat-plan";
import type { PendingPlanDecisionState } from "../runtime/use-chat-session";

export function ChatPlanDecision({
  pending,
  onDecision,
}: {
  pending: PendingPlanDecisionState;
  onDecision: (decision: PlanDecision) => void;
}) {
  const [feedback, setFeedback] = useState("");

  const submitFeedback = () => {
    const value = feedback.trim();
    if (value) onDecision({ kind: "revise", feedback: value });
  };

  return (
    <section className="rounded-2xl border bg-background p-4">
      <div className="flex min-h-10 items-start gap-4">
        <h2 className="min-w-0 flex-1 pt-1.5 font-medium text-sm leading-5">
          Implement this plan?
        </h2>
        <Button
          aria-label="关闭 Plan 决策"
          disabled={pending.busy}
          onClick={() => onDecision({ kind: "skip" })}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>

      <button
        className="group mt-3 flex w-full items-center gap-3 rounded-xl bg-muted/70 px-2 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        disabled={pending.busy}
        onClick={() => onDecision({ kind: "implement" })}
        type="button"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground tabular-nums">
          1
        </span>
        <span className="min-w-0 flex-1 font-medium">
          Yes, implement this plan
        </span>
        <ArrowRightIcon className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>

      <form
        className="mt-2 flex items-center gap-3 px-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitFeedback();
        }}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted/60 text-muted-foreground">
          <PenLineIcon className="size-4" />
        </span>
        <input
          aria-label="告诉 Agent 如何调整 Plan"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          disabled={pending.busy}
          onChange={(event) => setFeedback(event.currentTarget.value)}
          placeholder="No, and tell the Agent what to do differently"
          value={feedback}
        />
        {feedback.trim() && (
          <Button
            className="rounded-full"
            disabled={pending.busy}
            size="sm"
            type="submit"
          >
            发送
          </Button>
        )}
        <Button
          className="shrink-0 rounded-full"
          disabled={pending.busy}
          onClick={() => onDecision({ kind: "skip" })}
          size="sm"
          type="button"
          variant="outline"
        >
          Skip
        </Button>
      </form>

      {pending.error && (
        <p className="mt-2 text-destructive text-xs">{pending.error}</p>
      )}
    </section>
  );
}
