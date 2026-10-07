/**
 * [INPUT]: Portable turn parts, streaming identities and host-owned media/failure/subagent renderers.
 * [OUTPUT]: ConversationParts with shared text, reasoning and tool-group layout.
 * [POS]: Common content ordering for native, portable and live assistant turns.
 */
import { Fragment, type ReactNode } from "react";
import type { DraftPart } from "@ai-chat/cloud-protocol/turns/reducer";
import { MessageContent, MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { groupParts } from "@ai-chat/ui/components/conversation/activity/groups";
import { ToolGroup, ToolRow } from "@ai-chat/ui/components/conversation/activity/tools";

export function ConversationParts({ parts, streamingIds, text = value => value, image, failure, subagent }: {
  parts: readonly DraftPart[]; streamingIds?: ReadonlySet<string>; text?(value: string): string;
  image?(part: Extract<DraftPart, { type: "tool" }>): ReactNode;
  failure?(part: Extract<DraftPart, { type: "tool" }>): ReactNode;
  subagent(part: Extract<DraftPart, { type: "subagent" }>): ReactNode;
}) {
  return <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2">
    {groupParts(parts).map(group => {
      if (group.type === "text") return <MessageContent className="w-full" key={group.part.itemId}>
        <MessageResponse isAnimating={streamingIds?.has(group.part.itemId)}>{text(group.part.text)}</MessageResponse>
      </MessageContent>;
      if (group.type === "subagent") return <Fragment key={group.part.itemId}>{subagent(group.part)}</Fragment>;
      if (group.type === "image" || group.type === "failure") {
        const render = group.type === "image" ? image : failure;
        return <Fragment key={group.part.itemId}>{render ? render(group.part) : <ToolRow part={group.part} />}</Fragment>;
      }
      return group.parts.length === 1 && group.parts[0]!.tool === "reasoning"
        ? <div className="w-full" key={group.key}><ToolRow part={group.parts[0]!} /></div>
        : <ToolGroup key={group.key} parts={group.parts} />;
    })}
  </div>;
}
