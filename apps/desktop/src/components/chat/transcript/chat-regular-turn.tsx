/**
 * [INPUT]: Depends on projected assistant messages, the persisted ProductFailure when one exists, localized copy/fork action, and a prebuilt process timeline
 * [OUTPUT]: Renders regular assistant messages with copy/Fork actions, failure copy, usage-limit retry, and accessible structured interruption status.
 * [POS]: Chat transcript terminal renderer; keeps user-facing failure projection separate from the process-heavy turn renderer
 */

import type { ReactNode } from "react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { AssistantChatMessage } from "../../../../shared/chats-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { agentFailureCopy } from "@/lib/agent-failure";
import { skillFailureText } from "@/lib/skill-failure-text";
import { ChatMessageActions } from "./chat-message-actions";
import { TurnErrorCard } from "./chat-error-card";
import { UsageLimitCard } from "./chat-usage-limit-card";

export function RegularChatTurn({
  backendId,
  backendDisplayName,
  message,
  onRetry,
  process,
  onFork,
  forkDisabledReason,
}: {
  backendDisplayName: string;
  backendId?: AgentBackendId;
  message: AssistantChatMessage;
  onRetry: () => void;
  process: ReactNode;
  onFork?: () => void;
  forkDisabledReason?: string;
}) {
  const { t } = useAppTranslation();
  const failure = message.failure;
  const failureCopy = failure
    ? agentFailureCopy(t, failure, {
        backend: backendDisplayName,
        backendId,
      })
    : undefined;
  const content = failure
    ? failure.domain === "agent-runtime"
      ? [failureCopy?.title, failureCopy?.explanation, failureCopy?.resolution]
          .filter(Boolean)
          .join("\n\n")
      : skillFailureText(t, failure)
    : message.content || t("chat.noText");
  const usageLimit =
    message.failureKind === "usage-limit" ? message.usageLimit : undefined;

  return (
    <Message from="assistant">
      {process}
      {message.completion === "interrupted" && <p role="status" className="text-sm text-muted-foreground">{t("chat.interrupted")}</p>}
      {usageLimit ? (
        <UsageLimitCard
          backendId={backendId}
          backendDisplayName={backendDisplayName}
          failure={failure}
          limit={usageLimit}
          message={content}
          onRetry={onRetry}
        />
      ) : message.isError ? (
        <TurnErrorCard
          backend={backendDisplayName}
          backendId={backendId}
          failure={failure}
          message={content}
        />
      ) : (
        <MessageContent>
          <MessageResponse>{content}</MessageResponse>
        </MessageContent>
      )}
      <ChatMessageActions
        content={message.completion === "interrupted" ? `${content}\n\n[${t("chat.interrupted")}]` : content}
        contextReceipt={message.contextReceipt}
        createdAt={message.createdAt}
        onFork={onFork}
        forkDisabledReason={forkDisabledReason}
        role="assistant"
      />
    </Message>
  );
}
