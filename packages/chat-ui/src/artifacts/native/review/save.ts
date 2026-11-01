/**
 * [INPUT]: Revision-bound checkpoint writer, exact parent bridge and current source-backed comments.
 * [OUTPUT]: useNativeCommentSave persists one stable operation before send, queries its original result and clears only its draft, deduplicates the active action and serializes a different action after its original save.
 * [POS]: Trusted native review save controller; no model call, permanent store or automatic resubmission.
 */
import { useEffect, useRef, useState } from "react";
import { nativeCommentsSchema, type NativeComments, type NativeCommentSave } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import type { useNativeInput } from "../input";
import { commentDigest, commentIntent } from "./intent";
type Result = { revision: number; comments: NativeComments };
export function useNativeCommentSave({ send, subscribe, recovery, read, confirmed }: {
  send(message: unknown): void; subscribe(listener: (event: MessageEvent) => void): () => void; recovery: ReturnType<typeof useNativeInput>;
  read(): NativeComments; confirmed(document: NativeComments, revision: number): void;
}) {
  const [saving, setSaving] = useState(false), [failed, setFailed] = useState(false), writing = useRef(false), writes = useRef<Promise<void>>(Promise.resolve());
  const active = useRef<{ kind?: NativeCommentSave["kind"]; threadId?: string } | undefined>(undefined);
  const pending = useRef(new Map<string, { resolve(result: Result): void; reject(cause: Error): void; timer: ReturnType<typeof setTimeout> }>());
  useEffect(() => subscribe(event => {
    if (event.data?.type !== "bottega:native:comments-saved") return;
    const request = pending.current.get(event.data.requestId); if (!request) return;
    clearTimeout(request.timer); pending.current.delete(event.data.requestId);
    const result = event.data.result, parsed = nativeCommentsSchema.safeParse(result?.comments);
    if (event.data.ok === true && Number.isSafeInteger(result?.revision) && parsed.success) request.resolve({ revision: result.revision, comments: parsed.data });
    else request.reject(new Error("Original comment save is not confirmed"));
  }), [subscribe]);
  useEffect(() => {
    const requests = pending.current;
    return () => { for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error("Native review closed")); } requests.clear(); };
  }, []);
  const save = (kind?: NativeCommentSave["kind"], threadId?: string): Promise<void> => {
    if (writing.current) {
      if (kind && (active.current?.kind !== kind || active.current?.threadId !== threadId)) return writes.current.then(() => save(kind, threadId));
      return writes.current;
    }
    writing.current = true; active.current = { kind, threadId };
    const work = writes.current.catch(() => {}).then(async () => {
      setSaving(true); setFailed(false);
      try {
        let intent = recovery.current.current.commentSave;
        if (!intent) {
          if (!kind || !threadId) throw new Error("Original comment operation is missing");
          const identity = { kind, threadId, requestId: crypto.randomUUID(), at: Date.now() }, document = read();
          const desired = commentIntent(document, recovery.current.current, identity); if (!desired) throw new Error("Comment draft is missing");
          intent = { ...identity, beforeDigest: await commentDigest(document), digest: await commentDigest(desired) };
          try { await recovery.update({ ...recovery.current.current, commentSave: intent }); }
          catch (cause) {
            if (recovery.current.current.commentSave?.requestId === intent.requestId)
              await recovery.update({ ...recovery.current.current, commentSave: undefined }).catch(() => {});
            throw cause;
          }
        }
        await recovery.flush();
        const fixed = commentIntent(read(), recovery.current.current, intent), same = fixed && await commentDigest(fixed) === intent.digest;
        const { requestId } = intent;
        const result = await new Promise<Result>((resolve, reject) => {
          const timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error("Original comment result is unknown")); }, 10000);
          pending.current.set(requestId, { resolve, reject, timer });
          try { send({ type: "bottega:native:save-comments", requestId, commentDigest: intent.digest, beforeDigest: intent.beforeDigest, ...(same ? { comments: fixed } : {}) }); }
          catch (cause) { clearTimeout(timer); pending.current.delete(requestId); reject(cause); }
        });
        confirmed(result.comments, result.revision);
        const input = recovery.current.current;
        if (input.commentSave?.requestId === requestId) await recovery.update({ ...input, commentSave: undefined,
          ...(intent.kind === "create" && "c_" + input.compose?.requestId === intent.threadId ? { compose: undefined } : {}),
          ...(intent.kind === "reply" && input.reply?.threadId === intent.threadId ? { reply: undefined } : {}) });
      } catch (cause) { setFailed(true); throw cause; } finally { active.current = undefined; writing.current = false; setSaving(false); }
    });
    writes.current = work; return work;
  };
  return { saving, failed, writes, save, flush: async () => {
    await writes.current; await recovery.flush();
    if (recovery.current.current.commentSave) throw new Error("Confirm the original comment save before model admission");
  } };
}
