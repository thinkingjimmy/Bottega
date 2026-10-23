/**
 * [INPUT]: Host header with a side-panel-trigger slot, the shared Chat minimum-width policy, one conversation surface, the retained side-panel slot and navigation guards.
 * [OUTPUT]: One responsive Chat workspace tree with a shared 180px conversation minimum, a stable column during panel takeover and an open trigger hidden while its panel is open.
 * [POS]: Shared page layout; transport adapters supply data and controls without owning columns or panel placement.
 */
import type { ReactNode, Ref } from "react";
import { cn } from "@ai-chat/ui/lib/utils";
import { CHAT_MAIN_COLUMN_MIN_WIDTH } from "@ai-chat/ui/lib/side-panel-layout";
export function ChatPageFrame({ containerRef, takeover = false, header, notices, children, panel, navigation, className, containOverflow = true }: {
  containerRef?: Ref<HTMLDivElement>; takeover?: boolean; header?: ReactNode; notices?: ReactNode; children?: ReactNode;
  panel?: ReactNode; navigation?: ReactNode; className?: string; containOverflow?: boolean;
}) {
  return <div className={cn("chat-workspace flex h-full min-w-0 [&:has(>[data-slot=side-panel][data-state=open])>.chat-conversation-column_[data-slot=side-panel-trigger]]:hidden", className)} ref={containerRef} style={{ overflow: containOverflow ? "hidden" : "visible" }} data-takeover={takeover || undefined}>
    <section className="chat-detail chat-conversation-column flex min-h-0 min-w-0 flex-1 flex-col" data-testid="chat-main-column" data-layout="fill" style={{ minWidth: `min(100%, ${CHAT_MAIN_COLUMN_MIN_WIDTH}px)` }} hidden={takeover} inert={takeover}>
      {header}{notices}{children}
    </section>
    {panel}{navigation}
  </div>;
}
