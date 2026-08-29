/**
 * [INPUT]: Depends on message action primitives, icons, formatting, clipboard, optional revision eligibility, and request-bound Memory receipts
 * [OUTPUT]: Provides copy/revision actions followed by time and an optional icon-free Memory status
 * [POS]: Shared action row for user and assistant transcript messages
 */

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, PencilIcon } from "lucide-react";
import {
  MessageAction,
  MessageActions,
} from "@ai-chat/ui/components/ai-elements/message";
import { cn } from "@ai-chat/ui/lib/utils";
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
};

export function ChatMessageActions({
  role,
  content,
  createdAt,
  contextReceipt,
  onEdit,
  editDisabledReason,
}: ChatMessageActionsProps) {
  const { t } = useAppTranslation();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = async () => {
    try {
      await writeClipboardText(content);
      setCopied(true);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.warn("[chat] message copy failed", error);
    }
  };

  return (
    <MessageActions
      className={cn(
        // focus-within 说明的是「点过」而非「正在看」：鼠标点完 Copy，focus 留在按钮上，
        // 这排动作会在指针早已移开后继续亮着。:focus-visible 只认键盘，可达性不受影响。
        "opacity-0 transition-opacity has-[:focus-visible]:opacity-100 group-hover:opacity-100",
        // 决策 8：同一 DOM，user 靠右且镜像（时间左、按钮右），assistant 正序（按钮左、时间右）
        role === "user" && "ml-auto flex-row-reverse"
      )}
    >
      <MessageAction
        className="cursor-pointer"
        label={copied ? "Copied" : "Copy"}
        tooltip={copied ? "Copied" : "Copy"}
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </MessageAction>
      {(onEdit || editDisabledReason) && (
        <MessageAction
          className={editDisabledReason ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
          disabled={Boolean(editDisabledReason)}
          label={editDisabledReason ?? t("chatRevision.edit")}
          tooltip={editDisabledReason ?? t("chatRevision.edit")}
          onClick={onEdit}
        >
          <PencilIcon />
        </MessageAction>
      )}
      <span className="text-muted-foreground text-xs">
        {formatMessageTime(createdAt)}
      </span>
      <MemoryReceiptText receipt={contextReceipt} />
    </MessageActions>
  );
}
