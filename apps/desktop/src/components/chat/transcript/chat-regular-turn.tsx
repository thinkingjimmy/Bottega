/**
 * [INPUT]: Depends on projected assistant messages, structured Agent failures, localized copy, and a prebuilt process timeline
 * [OUTPUT]: Provides RegularChatTurn, the final-response/error/usage-limit presentation for non-plan assistant turns
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
import { agentFailureCopy, rendererAgentFailure } from "@/lib/agent-failure";
import { skillFailureText } from "@/lib/skill-failure-text";
import { ChatMessageActions } from "./chat-message-actions";
import { TurnErrorCard } from "./chat-error-card";
import { UsageLimitCard } from "./chat-usage-limit-card";

export function RegularChatTurn({
  backendId,
  backendDisplayName,
  message,
  showContinue,
  onContinue,
  onRetry,
  process,
}: {
  backendDisplayName: string;
  backendId?: AgentBackendId;
  message: AssistantChatMessage;
  showContinue: boolean;
  onContinue: () => void;
  onRetry: () => void;
  process: ReactNode;
}) {
  const { t } = useAppTranslation();
  const legacyCode =
    message.failureKind === "auth-required"
      ? "auth-required"
      : message.failureKind === "usage-limit"
        ? message.usageLimit?.window === "provider"
          ? "rate-limited"
          : "quota-exhausted"
        : "unknown";
  const failure =
    message.failure ??
    (message.isError
      ? rendererAgentFailure(legacyCode, message.content || undefined)
      : undefined);
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
          failure={failure ?? rendererAgentFailure("unknown")}
          onContinue={showContinue ? onContinue : undefined}
        />
      ) : (
        <MessageContent>
          <MessageResponse>{content}</MessageResponse>
        </MessageContent>
      )}
      <ChatMessageActions
        content={content}
        contextReceipt={message.contextReceipt}
        createdAt={message.createdAt}
        role="assistant"
      />
    </Message>
  );
}
