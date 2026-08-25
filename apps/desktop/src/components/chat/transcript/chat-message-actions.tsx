/**
 * [INPUT]: Depends on AI Elements MessageActions/MessageAction, and licide icons and lib/chat-format/agent-client
 * [OUTPUT]: Provides ChatMessageActions, hover time to appear + copy/ option to modify the action line
 * [POS]: The message action of chat/transcript is consumed by ChatTranscript (user) and ChatTurn (assistant)
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

type ChatMessageActionsProps = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  onEdit?: () => void;
};

export function ChatMessageActions({
  role,
  content,
  createdAt,
  onEdit,
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
      {onEdit && (
        <MessageAction
          className="cursor-pointer"
          label={t("chatRevision.edit")}
          tooltip={t("chatRevision.edit")}
          onClick={onEdit}
        >
          <PencilIcon />
        </MessageAction>
      )}
      <span className="text-muted-foreground text-xs">
        {formatMessageTime(createdAt)}
      </span>
    </MessageActions>
  );
}
