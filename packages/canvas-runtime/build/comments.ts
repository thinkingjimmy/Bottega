/**
 * [INPUT]: Original-parent fixed comment identity/digests, serialized native backend and original journal result endpoint.
 * [OUTPUT]: installNativeComments recovers prepared fixed saves before sending any retained original batch.
 * [POS]: Trusted editor-only comment adapter; authored child frames cannot invoke this parent capability.
 */
import { nativeFetch } from "./transport";
import type { PublishBatch } from "../.build/source/packages/slides/src/file-protocol";
type Request = { digest: string; batch?: PublishBatch; result?: Promise<unknown>; complete: boolean; receipt?: unknown };
async function digest(text: string) {
  return "sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function installNativeComments(input: { token: string | undefined; base: string; publish(batch: PublishBatch, requestId: string): Promise<unknown> }) {
  const requests = new Map<string, Request>();
  window.addEventListener("message", event => {
    if (!event.isTrusted || event.source !== window.parent || !input.token || event.data?.type !== "bottega:native:save-comments" || event.data.token !== input.token) return;
    const { requestId, comments, commentDigest, beforeDigest } = event.data;
    if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId) || !/^sha256:[a-f0-9]{64}$/.test(commentDigest) || !/^sha256:[a-f0-9]{64}$/.test(beforeDigest)) return;
    const respond = (ok: boolean, result?: unknown) => window.parent.postMessage({ type: "bottega:native:comments-saved", token: input.token, requestId, ok, result }, "*");
    void (async () => {
      const text = comments === undefined ? undefined : JSON.stringify(comments);
      if (text !== undefined && (new TextEncoder().encode(text).length > 1024 * 1024 || await digest(text) !== commentDigest)) throw new Error("Native comment bytes changed");
      let record = requests.get(requestId);
      if (record && record.digest !== commentDigest) throw new Error("Comment request parameters changed");
      if (!record) {
        if ([...requests.values()].filter(row => !row.complete).length >= 8) throw new Error("Original comment saves need their results");
        if (requests.size >= 128) { const oldest = [...requests].find(([, value]) => value.complete); if (oldest) requests.delete(oldest[0]); }
        record = { digest: commentDigest, complete: false }; requests.set(requestId, record);
      }
      const owned = record;
      if (owned.complete) { respond(true, owned.receipt); return; }
      owned.result ??= (async () => {
        const lookup = () => nativeFetch(input.base + "__deck/comment-result", { method: "POST", headers: {
          "Content-Type": "application/json", "X-Bottega-Native": input.token!, "X-Bottega-Request": "native-" + requestId
        }, body: JSON.stringify({ digest: commentDigest }) });
        let response = await lookup();
        if (response.status === 404) {
          if ((await response.json()).beforeDigest !== beforeDigest || text === undefined) throw new Error("Retained original comments need their unchanged baseline");
          if (!owned.batch) {
            const response = await nativeFetch(input.base + "_files.json", { cache: "no-store" }); if (!response.ok) throw new Error("Native source is unavailable");
            const index = await response.json(), ifMatch = index.files?.["project/comments.json"]?.sha256 ?? null;
            owned.batch = { "project/comments.json": { content: text + "\n", contentType: "application/json", ifMatch } };
          }
          await input.publish(owned.batch, requestId); response = await lookup();
        }
        if (!response.ok) throw new Error("Original comment save is not confirmed");
        const result = await response.json(); owned.complete = true; owned.receipt = result; owned.batch = undefined;
        window.parent.postMessage({ type: "bottega:native:saved", token: input.token, result }, "*");
        return result;
      })().catch(cause => { owned.result = undefined; throw cause; });
      respond(true, await owned.result);
    })().catch(() => respond(false));
  });
}
