/**
 * [INPUT]: React, shared UI primitives and host-owned presentation slots.
 * [OUTPUT]: Shared Chat empty state and composer layout without platform effects.
 * [POS]: Common Chat presentation for local desktop, remote desktop and browser.
 */
import type { ReactNode } from "react";
import { PRODUCT_MARK_SIZE, PRODUCT_MARK_URL, PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
export function ChatEmptyState({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-8 text-center" data-testid="chat-empty-state">
    <img alt={PRODUCT_NAME} className="pointer-events-none h-14 w-auto select-none" draggable={false} height={PRODUCT_MARK_SIZE.height} src={PRODUCT_MARK_URL} width={PRODUCT_MARK_SIZE.width} />
    <div className="space-y-2"><h2 className="text-balance font-medium text-xl">{title}</h2>
      {description && <p className="max-w-md text-balance text-muted-foreground text-sm">{description}</p>}
    </div>
  </div>;
}
