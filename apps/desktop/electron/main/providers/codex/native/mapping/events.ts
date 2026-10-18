/**
 * [INPUT]: Uses CLI-generated ThreadItem, scoped item ownership, shared UTF-8/tool budgets and product callbacks.
 * [OUTPUT]: Exports NativeEvents for bounded public summary details and metadata-preserving native item projections.
 * [POS]: Native event mapping only; session binding and terminal ownership belong to the turn.
 */
import { truncateUtf8 } from "@ai-chat/cloud-protocol/turns/text/truncate-utf8";
import { NATIVE_BACKGROUND_PENDING_DETAIL } from "../../../../../../shared/ipc/agent/background-ipc";
import { TOOL_DETAIL_BYTE_LIMIT } from "../../../../../../shared/ipc/agent/agent-ipc";
import type { AgentTurnItem, AgentTurnItemKind } from "../../../../../../shared/ipc/agent/agent-ipc";
import type { BackendTurnOptions } from "../../../../backends/contracts/types";
import type { ThreadItem } from "../schema";

import { nativeRecord } from "../transport/record";
import { nativeCommandItemId } from "./identity";
type ItemMetadata = { locations?: string[]; title?: string; exitCode?: number };
const scopeKey = (itemId: string, child?: string) => `${child ?? ""}\0${itemId}`;
const summaryProjection = (text: string) => ({
  title: truncateUtf8(text.split(/\r?\n/, 1)[0] || "Reasoning", 240, "…").value,
  detail: truncateUtf8(text, TOOL_DETAIL_BYTE_LIMIT, "…").value,
});
const bounded = (value: string) => value.length > 65_536 ? value.slice(0, 65_536) + "\n[Output truncated]" : value;

export class NativeEvents {
  private readonly text = new Map<string, string>();
  private readonly active = new Map<string, { item: AgentTurnItem; child?: string; metadata?: ItemMetadata }>();
  private readonly completed = new Set<string>();
  private readonly summaries = new Map<string, Map<number, string>>();
  private readonly children = new Set<string>();
  private readonly plans = new Map<string, string>();
  private readonly fileChanges = new Map<string, string>();
  private readonly commandItems = new Map<string, { item: AgentTurnItem; metadata?: ItemMetadata }>();
  private readonly retained = new Set<string>();
  fileChange(itemId: string) { return this.fileChanges.get(itemId); }
  constructor(private readonly options: BackendTurnOptions, private readonly redact: (text: string) => string) {}

  child(threadId: string) { return this.children.has(threadId); }
  private item(item: AgentTurnItem, child?: string, metadata?: ItemMetadata) {
    const key = scopeKey(item.itemId, child);
    if (["command", "reasoning", "agent-message", "plan"].includes(item.kind)) {
      if (item.status === "running") this.active.set(key, { item, child, metadata });
      else this.active.delete(key);
    }
    if (item.kind === "command") this.commandItems.set(key, { item, metadata });
    const safe = { ...item, ...(item.kind === "command" ? { itemId: nativeCommandItemId(this.options.payload.requestId, item.itemId, child) } : {}), title: this.redact(item.title), ...(item.text === undefined ? {} : { text: this.redact(item.text) }), ...(item.detail === undefined ? {} : { detail: this.redact(item.detail) }) };
    this.options.trace?.recordMapped({ type: "item", item: safe });
    if (child) this.options.callbacks.onSubagentItem?.(child, safe);
    else this.options.callbacks.onItem(safe, metadata);
  }

  backgroundCommand(terminal: { itemId: string; command: string; cwd: string }) {
    const key = scopeKey(terminal.itemId), previous = this.commandItems.get(key);
    this.retained.add(key);
    this.item({ itemId: terminal.itemId, kind: "command", title: previous?.item.title ?? bounded(terminal.command), status: "running",
      detail: bounded([NATIVE_BACKGROUND_PENDING_DETAIL, previous?.item.detail].filter(Boolean).join("\n")) }, undefined, previous?.metadata ?? { locations: [terminal.cwd] });
  }

  delta(itemId: string, text: string, kind: AgentTurnItemKind, child?: string, summaryIndex = 0) {
    if (Buffer.byteLength(text) > 64 * 1024) throw new Error("Native delta exceeds 64 KiB");
    const key = scopeKey(itemId, child);
    if (this.completed.has(key)) return;
    const value = this.redact(text);
    const previous = this.active.get(key);
    if (kind === "reasoning") {
      if (!Number.isSafeInteger(summaryIndex) || summaryIndex < 0 || summaryIndex >= 1024) throw new Error("Invalid native summary index");
      const parts = this.summaries.get(key) ?? new Map<number, string>();
      const otherBytes = [...parts].reduce((size, [index, part]) => size + (index === summaryIndex ? 0 : Buffer.byteLength(part)), 0);
      parts.set(summaryIndex, truncateUtf8((parts.get(summaryIndex) ?? "") + value, Math.max(0, TOOL_DETAIL_BYTE_LIMIT - otherBytes), "…").value);
      this.summaries.set(key, parts);
      this.item({ itemId, kind, ...summaryProjection([...parts].sort(([a], [b]) => a - b).map(([, part]) => part).join("\n")), status: "running" }, child);
      return;
    }
    this.text.set(key, kind === "command" ? bounded((this.text.get(key) ?? previous?.item.detail ?? "") + value) : (this.text.get(key) ?? "") + value);
    if (kind === "agent-message" || kind === "plan") {
      // Keep a full snapshot for interruption without sending tool summaries through reply deltas.
      this.active.set(key, { item: { itemId, kind, title: previous?.item.title ?? (kind === "plan" ? "Plan" : "Message"), text: this.text.get(key), status: "running" }, child });
      if (child) this.options.callbacks.onSubagentItemDelta?.(child, itemId, value);
      else this.options.callbacks.onItemDelta(itemId, value);
    } else this.item({ ...previous?.item, itemId, kind, title: previous?.item.title ?? (kind === "command" ? "Command" : kind), status: "running", detail: this.text.get(key) }, child, previous?.metadata);
  }

  update(item: ThreadItem, completed: boolean, child?: string) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 4096) throw new Error("Invalid native item identity");
    const itemId = item.id;
    const key = scopeKey(itemId, child);
    const status = completed ? "completed" as const : "running" as const;
    switch (item.type) {
      case "userMessage": case "hookPrompt": return;
      case "agentMessage": case "plan": {
        const kind = item.type === "plan" ? "plan" : "agent-message";
        if (!this.text.has(key)) this.text.set(key, item.text);
        this.item({ itemId, kind, title: kind === "plan" ? "Plan" : "Message", status,
          text: completed ? item.text : this.text.get(key) ?? item.text }, child); break;
      }
      case "reasoning": {
        const summary = item.summary.join("\n") || this.active.get(key)?.item.detail || "";
        if (!completed && !this.summaries.has(key) && item.summary.length) this.summaries.set(key, new Map(item.summary.map((part, index) => [index, truncateUtf8(part, TOOL_DETAIL_BYTE_LIMIT, "…").value])));
        this.item({ itemId, kind: "reasoning", ...summaryProjection(summary), status }, child); break;
      }
      case "commandExecution":
        this.item({ itemId, kind: "command", title: bounded(item.command), detail: bounded(item.aggregatedOutput ?? this.text.get(key) ?? ""),
          status: ["failed", "declined"].includes(item.status) || (completed && item.exitCode !== null && item.exitCode !== 0) ? "failed" : status }, child,
        { locations: [item.cwd], ...(item.exitCode === null ? {} : { exitCode: item.exitCode }) }); break;
      case "fileChange": this.fileChanges.set(itemId, bounded(item.changes.map(change => `${change.path}\n${change.diff}`).join("\n"))); this.item({ itemId, kind: "file-change", title: item.changes.map(change => change.path).join(", "),
        detail: bounded(item.changes.map(change => `${change.path}\n${change.diff}`).join("\n")), status: item.status === "failed" || item.status === "declined" ? "failed" : status }, child,
      { locations: item.changes.map(change => change.path) }); break;
      case "mcpToolCall": {
        if (completed) {
          const server = this.options.thirdPartyMcpPlan?.entries.find(entry => entry.backendAlias === item.server);
          if (server) this.options.callbacks.onThirdPartyMcpProtocol?.({ outcome: item.status === "failed" ? "failure" : "success", subject: server.healthSubject,
            evidence: ["native-mcp-tool-call", this.options.runtime.version, server.identity, server.configDigest, item.id, item.status].join("\0") });
        }
        this.item({ itemId, kind: "other", title: `${item.server} · ${item.tool}`, status: item.status === "failed" ? "failed" : status,
        detail: bounded(JSON.stringify(item.error ?? item.result ?? {})) }, child); break;
      }
      case "webSearch": this.item({ itemId, kind: "web-search", title: "Web search", detail: bounded(JSON.stringify(item)), status }, child); break;
      case "imageGeneration": this.item({ itemId, kind: "image", title: "Image generation", status: item.failure || item.status === "failed" ? "failed" : status,
        ...(item.savedPath ? { detail: item.savedPath } : {}) }, child, item.savedPath ? { locations: [item.savedPath] } : undefined); break;
      case "subAgentActivity": {
        const threadId = item.agentThreadId; this.children.add(threadId);
        const current = this.options.subagents.get(threadId);
        const meta = this.options.subagents.upsertMeta({ agentThreadId: threadId, name: current?.name ?? item.agentPath,
          status: item.kind === "completed" ? "completed" : item.kind === "interrupted" ? "interrupted" : "running",
          spawnedAt: current?.spawnedAt ?? Date.now(), lastActivityAt: Date.now() }).meta;
        this.options.callbacks.onSubagentUpdate?.(meta); break;
      }
      case "imageView": this.item({ itemId, kind: "image", title: item.path, status }, child, { locations: [item.path] }); break;
      case "collabAgentToolCall": {
        for (const threadId of item.receiverThreadIds) {
          this.children.add(threadId);
          const state = item.agentsStates[threadId];
          const current = this.options.subagents.get(threadId);
          const agent = this.options.subagents.upsertMeta({ agentThreadId: threadId, name: current?.name ?? `Agent ${threadId.slice(0, 8)}`,
            status: state?.status ?? (completed ? "completed" : "running"), spawnedAt: current?.spawnedAt ?? Date.now(), lastActivityAt: Date.now() }).meta;
          this.options.callbacks.onSubagentUpdate?.(agent);
        }
        this.item({ itemId, kind: "other", title: item.tool, status }, child); break;
      }
      default: this.item({ itemId, kind: "other", title: item.type, detail: bounded(JSON.stringify(item)), status }, child);
    }
    if (completed) { this.text.delete(key); this.summaries.delete(key); this.active.delete(key); this.completed.add(key); }
  }

  plan(turnId: string, plan: unknown) {
    const rows = Array.isArray(plan) ? plan : [];
    this.plans.set(turnId, bounded(rows.map(row => { const r = nativeRecord(row); return `${r.status === "completed" ? "[x]" : "[ ]"} ${String(r.step ?? "")}`; }).join("\n")));
    this.item({ itemId: `native-plan-${turnId}`, kind: "other", title: "Plan", status: "running",
      detail: bounded(rows.map(row => { const r = nativeRecord(row); return `${r.status === "completed" ? "[x]" : "[ ]"} ${String(r.step ?? "")}`; }).join("\n")) });
  }

  finish(failed = false) {
    for (const [turnId, detail] of this.plans) this.item({ itemId: `native-plan-${turnId}`, kind: "other", title: "Plan", detail, status: failed ? "failed" : "completed" });
    this.plans.clear(); this.fileChanges.clear();
    for (const { item, child, metadata } of this.active.values()) if (!this.retained.has(scopeKey(item.itemId, child))) this.item({ ...item, status: failed ? "failed" : "completed" }, child, metadata);
    this.text.clear(); this.active.clear(); this.summaries.clear(); this.completed.clear(); this.commandItems.clear(); this.retained.clear();
  }
}
