/**
 * [INPUT]: Transport-adapted transcript, composer, status and dialog regions, plus the host's port-swap signal.
 * [OUTPUT]: One conversation layout with stable transcript space, a composer below it, and unclaimed focus returned to a composer rebuilt by an execution-port swap.
 * [POS]: ChatPage conversation body; both native and cloud session adapters supply these same regions.
 */
import { useCallback, useEffect, useRef, type ReactNode, type Ref } from "react";
import { cn } from "@ai-chat/ui/lib/utils";
export type ConversationRegions = { transcript: ReactNode; composer?: ReactNode; status?: ReactNode; overlay?: ReactNode; footer?: ReactNode;
  containerRef?: Ref<HTMLDivElement>; layout?: "page" | "fill"; className?: string;
  /** The reader was already typing here and the port under them changed: take the caret back. */
  focusComposer?: boolean };
/** Forwards the column node to the host's callback or object ref; it runs at commit through `attach`, never during render. */
function forwardNode(ref: Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}
export function ChatConversation({ transcript, composer, status, overlay, footer, containerRef, layout = "fill", className, focusComposer = false }: ConversationRegions) {
  const own = useRef<HTMLDivElement | null>(null), focused = useRef<HTMLElement | null>(null);
  /* The composer is the last editable surface in this column — the transcript's own editors only
     exist while a message is being revised. It can arrive a tick after the column does, so this
     keeps looking until it does, and once focus has been placed it only takes it back if the
     editor left the DOM without anything else claiming it. */
  useEffect(() => {
    if (!focusComposer) return;
    if (focused.current?.isConnected || document.activeElement !== document.body) return;
    const editors = own.current?.querySelectorAll<HTMLElement>('[role="textbox"]');
    const editor = editors?.[editors.length - 1];
    if (!editor) return;
    focused.current = editor;
    editor.focus({ preventScroll: true });
  }, [composer, focusComposer]);
  const attach = useCallback((node: HTMLDivElement | null) => {
    own.current = node;
    forwardNode(containerRef, node);
  }, [containerRef]);
  return <div ref={attach} className={cn(layout === "fill" && "flex min-h-0 min-w-0 flex-1 flex-col", className)} data-layout={layout}>
    {overlay}{transcript}{status}{composer}{footer}
  </div>;
}
