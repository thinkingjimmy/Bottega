/**
 * [INPUT]: Host header, one conversation surface, retained panel and navigation guard slots.
 * [OUTPUT]: One responsive Chat workspace tree with a stable conversation column during panel takeover.
 * [POS]: Shared page layout; transport adapters supply data and controls without owning columns or panel placement.
 */
import type { ReactNode, Ref } from "react";
import { cn } from "@ai-chat/ui/lib/utils";
export function ChatPageFrame({ containerRef, takeover = false, header, notices, children, panel, navigation, className, containOverflow = true }: {
  containerRef?: Ref<HTMLDivElement>; takeover?: boolean; header?: ReactNode; notices?: ReactNode; children?: ReactNode;
  panel?: ReactNode; navigation?: ReactNode; className?: string; containOverflow?: boolean;
}) {
  return <div className={cn("chat-workspace flex h-full min-w-0", className)} ref={containerRef} style={{ overflow: containOverflow ? "hidden" : "visible" }} data-takeover={takeover || undefined}>
    <section className="chat-detail chat-conversation-column flex min-h-0 min-w-0 flex-1 flex-col" data-testid="chat-main-column" data-layout="fill" style={{ minWidth: "min(100%, 360px)" }} hidden={takeover} inert={takeover}>
      {header}{notices}{children}
    </section>
    {panel}{navigation}
  </div>;
}
