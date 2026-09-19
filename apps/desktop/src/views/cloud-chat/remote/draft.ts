/**
 * [INPUT]: Depends on the existing per-Chat composer store and durable continuation draft service.
 * [OUTPUT]: Provides an editable remote text draft after hydration, retaining unsupported nodes and corrections after persistence failures.
 * [POS]: Renderer projection; remote commands never receive local file or Skill references.
 */
import { useCallback } from "react";
import { useComposerState, updateComposer } from "@/lib/chat-composer-store";
import type { ContinuationDraft } from "../continuation";
import type { RemoteDraft } from "@ai-chat/chat-ui/remote-conversation";
export function useRemoteComposerDraft(chatId: string, draft: ContinuationDraft): RemoteDraft {
  const composer = useComposerState(chatId);
  const change = useCallback((text: string) => {
    updateComposer(chatId, current => ({ ...current, draft: { ...current.draft, richValue: [
      ...(text ? [{ id: current.draft.richValue.find(node => node.type === "text")?.id ?? crypto.randomUUID(), type: "text" as const, value: text }] : []),
      ...current.draft.richValue.filter(node => node.type !== "text"),
    ] } }));
  }, [chatId]);
  return { text: composer.draft.richValue.filter(node => node.type === "text").map(node => node.value).join(""), change,
    ready: draft.ready, flush: draft.flush, unsupported: composer.draft.files.length > 0 || composer.draft.richValue.some(node => node.type !== "text") };
}
