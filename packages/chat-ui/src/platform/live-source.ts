/**
 * [INPUT]: Depends on injected authorized turn queries/subscriptions, the canonical live reducer, bounded local receive diagnostics and optional structural browser event/visibility scopes through globalThis; no ambient DOM types.
 * [OUTPUT]: Contiguous-watermark LiveTurnSource and reattachingLive with opaque verified receive/settlement milestones; verified content survives replay, transient failures recover on 2/5/15/30 seconds or foreground/network events, deterministic failures never retry.
 * [POS]: Read-only replay coordination; a missing chunk never implies an empty or finished result.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { hashTurnChunk } from "@ai-chat/cloud-protocol/turns/live";
import type { LiveProjection } from "@ai-chat/cloud-protocol/turns/live";
import { createLiveProjection, reduceLiveProjection } from "@ai-chat/cloud-protocol/turns/projection";
import type { ChatQueryResult } from "./read-source";
import type { LiveTurnSource, Unsubscribe } from "./contracts";
import type { ChatLiveView } from "./model";
import { beginReceive } from "./transcript/receive-diagnostics";
import { CryptoError } from "@ai-chat/cloud-protocol/encryption";
export interface LiveReadPorts {
  head(chatId: string, changed: (value: CloudChatHead | null) => void, failed: (error: unknown) => void): Unsubscribe;
  state(chatId: string, turnId: string, changed: (value: ChatQueryResult<"turns/reads:state">) => void, failed: (error: unknown) => void): Unsubscribe;
  page(chatId: string, turnId: string, afterSeq: number, throughSeq: number, signal: AbortSignal): Promise<ChatQueryResult<"turns/reads:page">>;
}
export function liveTurnSource(ports: LiveReadPorts): LiveTurnSource {
  return { attach(chatId, changed, failed) {
    let closed = false, identity = "", stopTurn: Unsubscribe | null = null, controller = new AbortController();
    let observed: ChatQueryResult<"turns/reads:state"> = null, projection: LiveProjection | null = null, high = 0, busy = false, dirty = false;
    let ciphertextHash: string | null = null;
    const failure = (error: unknown) => { if (!closed) failed(error); };
    async function replay() {
      if (busy) { dirty = true; return; }
      busy = true;
      const request = controller;
      try {
        do {
          dirty = false;
          const state = observed;
          if (!state) continue;
          const watermark = state.chunkHighSeq;
          let next = projection ?? createLiveProjection(state.createdAt), cursor = high;
          let previousHash = ciphertextHash ?? state.ciphertextIdentityHash;
          if (!projection) changed({ state, projection: null, contentReady: false, replayComplete: false });
          while (cursor < watermark && state.chunksAvailable) {
            const page = await ports.page(chatId, state.receipt.turnId, cursor, watermark, request.signal);
            if (closed || request !== controller || request.signal.aborted) return;
            if (!page.state || !page.state.chunksAvailable) break;
            if (!page.chunks.length) throw new Error("LIVE_REPLAY_GAP");
            for (const chunk of page.chunks) {
              if (chunk.seq !== cursor + 1 || chunk.seq > watermark || hashTurnChunk(chunk) !== chunk.payloadHash || chunk.previousCiphertextHash !== previousHash) throw new Error("LIVE_REPLAY_GAP");
              next = reduceLiveProjection(next, chunk.events); cursor = chunk.seq;
              previousHash = chunk.ciphertextHash;
            }
          }
          if (closed || request !== controller || request.signal.aborted) return;
          if (cursor === watermark) {
            if (previousHash !== state.lastCiphertextHash) throw new Error("LIVE_REPLAY_GAP");
            projection = next; high = cursor; ciphertextHash = previousHash;
          }
          changed({ state, projection, contentReady: state.contentReady, replayComplete: cursor === watermark });
        } while (dirty);
      } catch (error) { if (request === controller && !request.signal.aborted) failure(error); }
      finally { busy = false; if (!closed && request !== controller) void replay(); }
    }
    const stopHead = ports.head(chatId, head => {
      if (closed) return;
      if (!head) {
        controller.abort(); stopTurn?.(); stopTurn = null; identity = ""; observed = null; projection = null; high = 0; ciphertextHash = null;
        changed({ state: null, projection: null, contentReady: false, replayComplete: false }); return;
      }
      // Keep observing the previous turn after the head clears its open-turn barrier.
      if (!head.openTurnId || identity === `${head.chat.incarnationId}:${head.openTurnId}`) return;
      controller.abort(); controller = new AbortController(); stopTurn?.(); observed = null; projection = null; high = 0; ciphertextHash = null;
      identity = `${head.chat.incarnationId}:${head.openTurnId}`;
      const current = identity;
      changed({ state: null, projection: null, contentReady: false, replayComplete: false });
      stopTurn = ports.state(chatId, head.openTurnId, state => {
        if (closed || identity !== current) return;
        observed = state;
        if (state) void replay();
      }, failure);
    }, failure);
    return () => { closed = true; controller.abort(); stopTurn?.(); stopHead(); };
  } };
}
/** A host's live read failure that crossed a boundary without its error: transient means another attach may succeed. */
export class LiveReadFailure extends Error {
  constructor(readonly transient: boolean) { super("CHAT_LIVE_UNAVAILABLE"); }
}
/** Deterministic failures never become valid by reading again: a refusal by name, a decrypt failure, a result of the wrong shape. */
export function liveFailureTransient(error: unknown): boolean {
  if (error instanceof LiveReadFailure) return error.transient;
  if (error instanceof CryptoError) return false;
  if (error instanceof Error && error.name === "ZodError") return false;
  return !(error && typeof error === "object" && "data" in error && typeof error.data === "string");
}
export const LIVE_RETRY_MS = [2_000, 5_000, 15_000, 30_000] as const;
type Schedule = (run: () => void, delay: number) => () => void;
type ResumeEventTarget = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
type LiveBrowserScope = { window?: ResumeEventTarget; document?: ResumeEventTarget & { readonly visibilityState?: string } };
const timer: Schedule = (run, delay) => { const handle = setTimeout(run, delay); return () => clearTimeout(handle); };
/**
 * TASK-20 T20-8b: a transient live failure re-attaches on the 2/5/15/30 s ladder instead of leaving the open Chat's live view
 * dead; verified content remains visible while a replacement subscription replays.
 * Deterministic failures are reported once and never retried.
 */
export function reattachingLive(source: LiveTurnSource, schedule: Schedule = timer): LiveTurnSource {
  return { attach(chatId, changed, failed) {
    const scope = globalThis as LiveBrowserScope;
    const hostWindow = scope.window, hostDocument = scope.document;
    let closed = false, failures = 0, stop: Unsubscribe | null = null, cancel: (() => void) | null = null;
    let retained: ChatLiveView | null = null, retryable = false, generation = 0, progress = beginReceive("live");
    const start = () => {
      const current = ++generation;
      stop = source.attach(chatId, value => {
        if (closed || current !== generation) return;
        if (!value.state && retained?.state) return;
        const sameTurn = retained?.state?.receipt.turnId === value.state?.receipt.turnId;
        if (sameTurn && retained?.state?.receipt.settlementState === "settled" && value.state?.receipt.settlementState !== "settled") return;
        if (!sameTurn && retained?.state && value.state) { progress.close(); progress = beginReceive("live"); }
        const settled = value.state?.receipt.settlementState === "settled";
        progress.update({ phase: settled ? "settlement-observed" : value.replayComplete ? "verified" : "replaying",
          ...(value.replayComplete && value.state ? { verifiedChunkSeq: value.state.chunkHighSeq } : {}), settlementObserved: settled });
        retained = sameTurn && retained?.projection && !value.replayComplete ? { ...value, projection: retained.projection } : value;
        if (value.replayComplete) { failures = 0; retryable = false; cancel?.(); cancel = null; }
        changed(retained);
      }, error => {
        if (closed || current !== generation) return;
        failed(error);
        retryable = liveFailureTransient(error);
        if (!retryable) { progress.update({ phase: "failed" }); return; }
        if (cancel) return;
        const delay = LIVE_RETRY_MS[Math.min(failures++, LIVE_RETRY_MS.length - 1)]!;
        progress.retry(Date.now() + delay);
        cancel = schedule(() => { cancel = null; if (closed) return; stop?.(); start(); }, delay);
      });
    };
    const resume = () => {
      if (!retryable || hostDocument?.visibilityState !== "visible") return;
      cancel?.(); cancel = null; stop?.(); start();
    };
    if (hostWindow && hostDocument) { hostWindow.addEventListener("online", resume); hostWindow.addEventListener("pageshow", resume); hostDocument.addEventListener("visibilitychange", resume); }
    start();
    return () => {
      closed = true; progress.close(); cancel?.(); cancel = null; stop?.();
      if (hostWindow && hostDocument) { hostWindow.removeEventListener("online", resume); hostWindow.removeEventListener("pageshow", resume); hostDocument.removeEventListener("visibilitychange", resume); }
    };
  } };
}
