/**
 * [INPUT]: Exact-editor messages, existing checkpoint CAS writer and current native draft.
 * [OUTPUT]: useNativeSuggestions durably appends advisory prompts with bounded original-request deduplication.
 * [POS]: Native review bridge; a successful acknowledgement opens instructions without starting a model.
 */
import { useEffect, useRef } from "react";
import { nativeComposeSchema, nativeInputSchema, type NativeInput } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import { checkpointSchema } from "@ai-chat/cloud-protocol/artifacts/design/review";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
type Request = { prompt: string; done: boolean; result: Promise<boolean> };
export function useNativeSuggestions({ state, subscribe, send, read, update, open }: { state: WorkspaceRead;
  subscribe(listener: (event: MessageEvent) => void): () => void; send(message: unknown): void;
  read: { current: NativeInput }; update(input: NativeInput): Promise<unknown>; open(): void }) {
  const requests = useRef(new Map<string, Request>());
  useEffect(() => {
    let alive = true;
    const stop = subscribe(event => {
      const message = event.data;
      if (message.type !== "editor:suggest-prompt" || !nativeComposeSchema.shape.requestId.safeParse(message.requestId).success) return;
      const requestId = message.requestId as string;
      const reply = (ok: boolean) => { if (alive) { if (ok) open(); send({ type: "editor:suggest-prompt-result", requestId, ok }); } };
      if (typeof message.prompt !== "string" || !message.prompt.trim() || message.prompt.length > 4096) { reply(false); return; }
      const previous = requests.current.get(requestId);
      if (previous) { if (previous.prompt !== message.prompt) reply(false); else void previous.result.then(reply); return; }
      if ([...requests.current.values()].filter(request => !request.done).length >= 4) { reply(false); return; }
      while (requests.current.size >= 64) {
        const oldest = [...requests.current].find(([, request]) => request.done);
        if (!oldest) { reply(false); return; } requests.current.delete(oldest[0]);
      }
      const entry: Request = { prompt: message.prompt, done: false, result: Promise.resolve(false) };
      requests.current.set(requestId, entry);
      entry.result = Promise.resolve().then(async () => {
        if (!alive) return false;
        const previous = read.current.instruction;
        const instruction = previous.includes(entry.prompt) ? previous : [previous, entry.prompt].filter(Boolean).join("\n\n");
        const native = nativeInputSchema.parse({ ...read.current, instruction });
        checkpointSchema.parse({ documentId: state.documentId, revision: state.revision, boardId: state.manifest.launchBoard, notes: [], native });
        await update(native); return true;
      }).catch(() => false).finally(() => { entry.done = true; });
      void entry.result.then(reply);
    });
    return () => { alive = false; stop(); };
  }, [state, subscribe, send, read, update, open]);
}
