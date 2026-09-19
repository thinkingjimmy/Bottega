/**
 * [INPUT]: Depends on shared AgentFailureNotice and its localized diagnostic labels, ProductFailureNotice, ProductFailure/backend identity, UI Button, and a Lucide status icon
 * [OUTPUT]: Provides TurnErrorCard with localized recovery copy and folded diagnostics or the raw error text, and FailureCard with an explicit transcript-level recovery action
 * [POS]: Default structured Agent failure card for chat/transcript, selected by ChatTurn when no specialized usage-limit surface applies
 */

import type { ReactNode } from "react";
import { CircleXIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  AgentFailureNotice,
  agentFailureNoticeLabels,
} from "@/components/agent-failure-notice";
import { ProductFailureNotice } from "@ai-chat/ui/components/feedback/failure-notice";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { ProductFailure } from "../../../../shared/product-failure";

// Keep folded diagnostics outside the alert so screen readers announce only recovery copy.

export function TurnErrorCard({
  failure,
  message,
  backend,
  backendId,
}: {
  /** Render the raw message when no structured failure was persisted. */
  failure?: ProductFailure;
  message: string;
  backend: string;
  backendId?: AgentBackendId;
}) {
  const { t } = useAppTranslation();
  if (!failure) {
    return (
      <ProductFailureNotice
        copy={{ title: message, explanation: "", resolution: "" }}
        labels={agentFailureNoticeLabels(t)}
      />
    );
  }
  return (
    <AgentFailureNotice
      backend={backend}
      backendId={backendId}
      failure={failure}
    />
  );
}

// Transcript-level failures share the neutral surface used by usage-limit cards.
export function FailureCard({
  action,
  body,
  icon,
  onAct,
  title,
}: {
  action: string;
  body: string;
  icon?: ReactNode;
  onAct(): void;
  title: string;
}) {
  return (
    <div
      className="w-full min-w-0 rounded-xl border bg-muted/40 p-4"
      role="alert"
    >
      <div className="flex items-center gap-2">
        <CircleXIcon className="size-4 shrink-0 text-destructive" />
        <span className="font-medium text-base">{title}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground text-sm">
        {body}
      </p>
      <div className="mt-4 flex justify-end">
        <Button onClick={onAct} size="sm" type="button" variant="outline">
          {icon}
          {action}
        </Button>
      </div>
    </div>
  );
}
