/**
 * [INPUT]: Depends on React local feedback state, lucide icons, Chat composer i18n, and runtime-provided Plan decision status/action
 * [OUTPUT]: Provides localized ChatPlanDecision with implementation, revision feedback, and explicit skip paths
 * [POS]: Composer replacement shown after Plan completion; collects intent while runtime owns the actual mode transition
 */

import { useState } from "react";
import { ArrowRightIcon, PenLineIcon, XIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { PlanDecision } from "@/lib/chat-plan";
import type { PendingPlanDecisionState } from "../runtime/use-chat-session";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function ChatPlanDecision({
  pending,
  onDecision,
}: {
  pending: PendingPlanDecisionState;
  onDecision: (decision: PlanDecision) => void;
}) {
  const { t } = useAppTranslation();
  const [feedback, setFeedback] = useState("");

  const submitFeedback = () => {
    const value = feedback.trim();
    if (value) onDecision({ kind: "revise", feedback: value });
  };

  return (
    <section className="rounded-2xl border bg-background p-4">
      <div className="flex min-h-10 items-start gap-4">
        <h2 className="min-w-0 flex-1 pt-1.5 font-medium text-sm leading-5">
          {t("chat.composer.plan.decisionTitle")}
        </h2>
        <Button
          aria-label={t("chat.composer.plan.closeDecision")}
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
          {t("chat.composer.plan.implement")}
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
          aria-label={t("chat.composer.plan.reviseLabel")}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          disabled={pending.busy}
          onChange={(event) => setFeedback(event.currentTarget.value)}
          placeholder={t("chat.composer.plan.revisePlaceholder")}
          value={feedback}
        />
        {feedback.trim() && (
          <Button
            className="rounded-full"
            disabled={pending.busy}
            size="sm"
            type="submit"
          >
            {t("chat.composer.plan.send")}
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
          {t("chat.composer.plan.skip")}
        </Button>
      </form>

      {pending.error && (
        <p className="mt-2 text-destructive text-xs">{pending.error}</p>
      )}
    </section>
  );
}
