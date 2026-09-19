/**
 * [INPUT]: Depends on shared ConversationActions, localized transcript/revision/fork copy, formatting, clipboard, native mutation eligibility, and request-bound Memory receipts
 * [OUTPUT]: Provides localized copy/edit/fork actions followed by time and an optional icon-free Memory status
 * [POS]: Shared action row for user and assistant transcript messages
 */

import { ConversationActions } from "@ai-chat/ui/components/conversation/actions";
import { formatMessageTime } from "@/lib/chat-format";
import { writeClipboardText } from "@/lib/agent-client";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { TurnContextReceipt } from "../../../../shared/memory-ipc";
import { MemoryReceiptText } from "./memory-turn-receipt";

type ChatMessageActionsProps = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  contextReceipt?: TurnContextReceipt;
  onEdit?: () => void;
  editDisabledReason?: string;
  onFork?: () => void;
  forkDisabledReason?: string;
};

export function ChatMessageActions({
  role,
  content,
  createdAt,
  contextReceipt,
  onEdit,
  editDisabledReason,
  onFork,
  forkDisabledReason,
}: ChatMessageActionsProps) {
  const { t } = useAppTranslation();
  return (
    <ConversationActions
      role={role}
      onCopy={() => writeClipboardText(content)}
      copyLabel={t("chat.transcript.actions.copy")}
      copiedLabel={t("chat.transcript.actions.copied")}
      timestamp={formatMessageTime(createdAt)}
      suffix={<MemoryReceiptText receipt={contextReceipt} />}
      edit={{ label: t("chatRevision.edit"), onClick: onEdit, disabledReason: editDisabledReason }}
      fork={{ label: t("chat.fork.action"), onClick: onFork, disabledReason: forkDisabledReason }}
    />
  );
}
