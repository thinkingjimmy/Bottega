/**
 * [INPUT]: Depends on saved records, UTF-8 budgets, envelope stripping, shared search guidance, and the production receiver digest
 * [OUTPUT]: Builds bounded original excerpts and saved imported tool evidence with explicit disclosure of omitted bodies and parts
 * [POS]: No model calls or checkpoints; only the injected package and its source cut are frozen
 */

import type { AgentUserInput } from "../../../../shared/agent-ipc";
import type { FrozenHandoff, PreparedHistory, HistoryRecord } from "../../../../shared/chat-agent/history";
import type { HandoffCoverage } from "../../../../shared/chat-agent/contracts";
import { HISTORY_SEARCH_GUIDANCE } from "../../../../shared/chat-agent/history-tool";
import { stripProductEnvelopes } from "../../history-import/turn-folding";
import { HANDOFF_PROMPT_HASH } from "./receiver";
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
export function buildHandoff(history: PreparedHistory, input: readonly { type: string; text?: string }[],
  lookup: HandoffCoverage["lookup"], totalLimit = 32768): FrozenHandoff {
  const currentBytes = input.reduce((total, item) => total + (item.type === "text" ? Buffer.byteLength(item.text ?? "") : 0), 0);
  const coverage: HandoffCoverage = { mode: "none", historyIncluded: false, notInjected: history.records.length > 0 || history.hasMore || history.storageTrimmed,
    storageTrimmed: history.storageTrimmed, lookup, includedMessages: 0, totalMessages: history.totalMessages ?? history.scannedMessages };
  const selected: HistoryRecord[] = [];
  const evidence: HistoryRecord[] = [];
  const budget = Math.max(0, totalLimit - currentBytes);
  const packageOf = () => ({ version: 1, checkpoint: null, sourceCut: history.binding.cut,
    coverage: { ...coverage, historyIncluded: selected.length + evidence.length > 0, mode: coverage.mode === "full" ? "full" : selected.length + evidence.length ? "excerpts" : "none" },
    scanned: { messages: history.scannedMessages, bytes: history.scannedBytes },
    omitted: ["historical image pixels", "live tool execution state", "unsaved details"],
    lookup: { name: lookup === "available" ? "read_chat_history" : null, availability: lookup,
      view: "live; stale pages require explicit recent/search refresh; history boundary is fixed",
      search: HISTORY_SEARCH_GUIDANCE,
      limits: { calls: 8, turnBytes: 98304, responseBytes: 16384, records: 20, searchCandidates: 200, searchBytes: 262144 } },
    excerpts: evidence, recentOriginals: selected });
  const render = () => JSON.stringify({ historical_handoff: packageOf() });
  const base = { binding: history.binding, promptVersion: 3 as const, promptHash: HANDOFF_PROMPT_HASH };
  if (!history.records.length || Buffer.byteLength(render()) > budget) return { ...base, text: "", refs: [], coverage };
  const complete = !history.hasMore && !history.storageTrimmed && history.records.every(record =>
    !record.projectionTruncated && !record.partsTruncated && !record.notSaved && !record.parts?.some(part =>
      (part.value as { projectionTruncated?: boolean } | null)?.projectionTruncated));
  if (complete) {
    selected.push(...history.records.map(record => ({ ...record, text: stripProductEnvelopes(record.text) })).sort((a, b) =>
      (a.ref.segment === b.ref.segment ? 0 : a.ref.segment === "imported" ? -1 : 1) || a.ref.seq - b.ref.seq));
    Object.assign(coverage, { mode: "full", historyIncluded: true, notInjected: false, includedMessages: selected.length });
    const refs = selected.flatMap(record => [record.ref, ...(record.parts ?? []).map(part => ({ ...record.ref, partId: part.partId }))]);
    if (refs.length <= 1000 && Buffer.byteLength(render()) + 1 <= budget) return { ...base, text: render(), refs, coverage };
    selected.length = 0; Object.assign(coverage, { mode: "none", historyIncluded: false, notInjected: true, includedMessages: 0 });
  }
  const seen = new Set<string>();
  const add = (record: HistoryRecord, destination: HistoryRecord[], cap = Infinity) => {
    const key = JSON.stringify(record.ref);
    if (seen.has(key)) return;
    const text = stripProductEnvelopes(record.text);
    const clean: HistoryRecord = { ...record, text, ...(text !== record.text ? { projection: "product-envelopes-removed" } : {}), parts: undefined };
    destination.push(clean);
    if (size(destination) > cap || Buffer.byteLength(render()) + 1 > budget) { destination.pop(); return; }
    seen.add(key);
  };
  const descending = [...history.records].sort((a, b) =>
    (a.ref.segment === b.ref.segment ? 0 : a.ref.segment === "native" ? -1 : 1) || b.ref.seq - a.ref.seq);
  // Recent user corrections own the budget before assistant process or saved evidence.
  for (const record of descending.filter(item => item.role === "user")) add(record, selected);
  const first = [...descending].reverse().find(item => item.role === "user");
  if (first) add(first, evidence, 8192);
  for (const record of descending) {
    for (const part of record.parts ?? []) {
      const value = part.value as Record<string, unknown> | null;
      if (!value || typeof value !== "object" || value.projectionTruncated === true) continue;
      const serialized = JSON.stringify(value);
      const failure = value.status === "error" || value.status === "failed" || value.isError === true;
      const artifact = value.kind === "artifact" || value.path !== undefined || value.filePath !== undefined;
      const importedTool = typeof value.name === "string" && typeof value.output === "string";
      if (failure || artifact || importedTool) add({ ...record, ref: { ...record.ref, partId: part.partId }, text: serialized,
        range: { fromByte: 0, toByte: Buffer.byteLength(serialized), totalBytes: Buffer.byteLength(serialized) }, parts: undefined }, evidence, 8192);
    }
  }
  for (const record of descending.filter(item => item.role === "assistant")) add(record, selected);
  selected.sort((a, b) => (a.ref.segment === b.ref.segment ? 0 : a.ref.segment === "imported" ? -1 : 1) || a.ref.seq - b.ref.seq);
  const refs = [...evidence, ...selected].map(item => item.ref);
  const finalCoverage: HandoffCoverage = { ...coverage, mode: refs.length ? "excerpts" : "none", historyIncluded: refs.length > 0, includedMessages: [...evidence, ...selected].filter(record => !record.ref.partId).length,
    notInjected: history.hasMore || history.records.some(record => !seen.has(JSON.stringify(record.ref)) || record.projectionTruncated || record.partsTruncated ||
      record.parts?.some(part => !seen.has(JSON.stringify({ ...record.ref, partId: part.partId })))) };
  Object.assign(coverage, finalCoverage);
  return { ...base, text: render(), refs, coverage: finalCoverage };
}
export function handoffInput(input: AgentUserInput[], handoff?: FrozenHandoff) {
  return handoff?.text ? [{ type: "text" as const, text: handoff.text }, ...input] : input;
}
