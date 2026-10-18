/**
 * [INPUT]: Uses bounded native thread history and the product's persisted recovery boundary hashes.
 * [OUTPUT]: Exports nativeHistoryMatches for exact recovery evidence checks without transcript replay.
 * [POS]: Native recovery verification; saved hints do not grant execution authority.
 */
import { sessionAssistantHash, sessionBoundary, sessionTextHash, type NativeSessionHint } from "../../../../library/sessions/boundary";
import type { NativeConnection } from "../transport/connection";
import { nativeRecord } from "../transport/record";

export async function nativeHistoryMatches(rpc: NativeConnection, candidate: NativeSessionHint) {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  let cursor: string | null = null, bytes = 0;
  const cursors = new Set<string>();
  for (let page = 0; page < 160; page++) {
    const response = nativeRecord(await rpc.request("thread/turns/list", { threadId: candidate.sessionId, limit: 64, cursor, sortDirection: "asc", itemsView: "full" }));
    if (!Array.isArray(response.data)) throw new Error("Native history page is invalid");
    for (const value of response.data) {
      const turn = nativeRecord(value);
      if (!Array.isArray(turn.items)) throw new Error("Native history turn has no items");
      for (const raw of turn.items) {
        const item = nativeRecord(raw);
        if (item.type === "userMessage" && Array.isArray(item.content)) messages.push({ role: "user", content: item.content.map(c => { const r = nativeRecord(c); return r.type === "text" ? String(r.text ?? "") : ""; }).filter(Boolean).join("\n\n") });
        if (item.type === "agentMessage") messages.push({ role: "assistant", content: String(item.text ?? "") });
        bytes += JSON.stringify(item).length;
        if (bytes > 16 * 1024 * 1024 || messages.length > 10_000) throw new Error("Native recovery history exceeds its budget");
      }
    }
    if (response.nextCursor == null) {
      const actual = sessionBoundary(messages), sent = candidate.sentBoundary;
      return sent ? actual.userTurns === sent.userTurns && sent.userHashes.includes(sessionTextHash(messages.filter(m => m.role === "user").at(-1)?.content ?? "")) && sessionAssistantHash(messages) === sent.assistantHash
        : candidate.boundary.userTurns > 0 && actual.userTurns === candidate.boundary.userTurns && actual.lastTurnHash === candidate.boundary.lastTurnHash;
    }
    if (typeof response.nextCursor !== "string" || cursors.has(response.nextCursor)) throw new Error("Native history cursor is invalid");
    cursor = response.nextCursor; cursors.add(cursor);
  }
  throw new Error("Native history page budget exceeded");
}
