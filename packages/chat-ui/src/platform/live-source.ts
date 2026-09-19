/**
 * [INPUT]: Depends on injected authorized turn queries/subscriptions and the canonical live reducer.
 * [OUTPUT]: Provides one disposable, contiguous-watermark LiveTurnSource for desktop and browser adapters.
 * [POS]: Read-only replay coordination; a missing chunk never implies an empty or finished result.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { hashTurnChunk } from "@ai-chat/cloud-protocol/turns/live";
import type { LiveProjection } from "@ai-chat/cloud-protocol/turns/live";
import { createLiveProjection, reduceLiveProjection } from "@ai-chat/cloud-protocol/turns/projection";
import type { ChatQueryResult } from "./read-source";
import type { LiveTurnSource, Unsubscribe } from "./contracts";
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
