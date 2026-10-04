/**
 * [INPUT]: Private original events or authenticated closed routing headers and prior confirmation state.
 * [OUTPUT]: Exact allowed interaction IDs, replacement cursors and terminal admission without server content reduction.
 * [POS]: Shared structural validator; complete replacement content is verified only by the client projection reducer.
 */
import { canonicalJson } from "../../encryption/encoding";
import { assertCrypto } from "../../encryption";
import { utf8Length } from "../../chats/content/parts";
import { reduceLiveProjection } from "../projection";
import type { LiveEvent, LiveProjection, TurnChunk } from "../live";
import { interactionIdsSchema, type TurnRoutingEvent } from "./model";
type RoutingState = { interactions: { approvals: string[]; inputs: string[] }; terminal: "done" | "error" | "cancelled" | null;
  replacement: { snapshotId: string; bytes: number; receivedBytes: number; count: number } | null };
function route(event: LiveEvent, interactions?: RoutingState["interactions"]): TurnRoutingEvent {
  switch (event.type) {
    case "replacement-begin": return { type: event.type, snapshotId: event.snapshotId, bytes: event.bytes };
    case "replacement-part": return { type: event.type, snapshotId: event.snapshotId, index: event.index, bytes: utf8Length(event.text) };
    case "replacement-commit": assertCrypto(interactions); return { type: event.type, snapshotId: event.snapshotId, interactions };
    case "replacement-abort": return { type: event.type, snapshotId: event.snapshotId };
    case "terminal": return event;
    case "approval-requested": return { type: event.type, requestId: event.approval.approvalId };
    case "approval-closed": return { type: event.type, requestId: event.approvalId };
    case "user-input-requested": return { type: event.type, requestId: event.request.userInputId };
    case "user-input-closed": return { type: event.type, requestId: event.userInputId };
    default: return { type: "content" };
  }
}
export function prepareTurnRouting(chunk: TurnChunk, previous: LiveProjection) {
  let projection = previous; const routing: TurnRoutingEvent[] = [];
  if (chunk.events.some(event => event.type === "replacement-commit")) {
    for (const event of chunk.events) {
      projection = reduceLiveProjection(projection, [event]);
      routing.push(route(event, { approvals: projection.approvals.map(value => value.approvalId), inputs: projection.userInputs.map(value => value.userInputId) }));
    }
  } else { projection = reduceLiveProjection(previous, chunk.events); routing.push(...chunk.events.map(event => route(event))); }
  return { routing, projection };
}
export function assertPrivateRouting(chunk: TurnChunk, routing: TurnRoutingEvent[]) {
  assertCrypto(chunk.events.length === routing.length);
  for (const [index, event] of chunk.events.entries()) {
    const claimed = routing[index]!;
    const expected = route(event, claimed.type === "replacement-commit" ? interactionIdsSchema.parse(claimed.interactions) : undefined);
    assertCrypto(canonicalJson(expected) === canonicalJson(claimed));
  }
}
export function reduceTurnRouting(previous: RoutingState, events: TurnRoutingEvent[]): RoutingState {
  const state = structuredClone(previous);
  for (const event of events) {
    assertCrypto(!state.terminal || event.type === "terminal" && event.terminal === state.terminal);
    if (event.type === "replacement-begin") { state.replacement = { snapshotId: event.snapshotId, bytes: event.bytes, receivedBytes: 0, count: 0 }; continue; }
    if (event.type === "replacement-part") {
      const pending = state.replacement;
      assertCrypto(pending && pending.snapshotId === event.snapshotId && pending.count === event.index && pending.count < 512);
      pending.count++; pending.receivedBytes += event.bytes; assertCrypto(pending.receivedBytes <= pending.bytes); continue;
    }
    if (event.type === "replacement-commit" || event.type === "replacement-abort") {
      const pending = state.replacement; assertCrypto(pending && pending.snapshotId === event.snapshotId);
      if (event.type === "replacement-commit") { assertCrypto(pending.receivedBytes === pending.bytes && pending.count > 0); state.interactions = interactionIdsSchema.parse(event.interactions); }
      state.replacement = null; continue;
    }
    assertCrypto(!state.replacement);
    if (event.type === "terminal") state.terminal = event.terminal;
    else if (event.type !== "content") {
      const key = event.type.startsWith("approval-") ? "approvals" : "inputs";
      state.interactions[key] = event.type.endsWith("requested") ? [...new Set([...state.interactions[key], event.requestId])].slice(-20) : state.interactions[key].filter(id => id !== event.requestId);
    }
  }
  interactionIdsSchema.parse(state.interactions); return state;
}
