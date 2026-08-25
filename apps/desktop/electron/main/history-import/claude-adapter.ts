/**
 * [INPUT]: Depends on Node fs/path, user home and history-import adapter
 * [OUTPUT]: Provides ClaudeHistoryAdapter; The first reading is filter + identity/full. Two read-only scans, complete reading/line-by-line analysis, cwd, precision, assistant, split and tool result merging
 * [POS]: The Claude Code format adapter for history-import; slug is only rough, true attribution is only recognized by the record cwd
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  ForeignHistoryBlock,
  ForeignHistoryMessage,
  ForeignToolEvent,
} from "../../../shared/history-import-ipc";
import {
  HISTORY_FILE_BYTES,
  HISTORY_PARSER_VERSION,
  digest,
  escapedUnsupported,
  fingerprint,
  fingerprintRevision,
  humanTitle,
  historyParseCheckpoint,
  initialSourceIncarnation,
  isWithin,
  normalizedAliases,
  opaqueSessionId,
  readHeadLines,
  readStableJsonl,
  timestamp,
  type AdapterEntry,
  type AdapterScan,
  type HistoryAdapter,
  type ParsedHistory,
  type ScanDepth,
} from "./adapter";

type Json = Record<string, unknown>;

export class ClaudeHistoryAdapter implements HistoryAdapter {
  readonly sourceKind = "claude" as const;
  readonly parserVersion = HISTORY_PARSER_VERSION;
  private readonly sourceRoot: string;

  constructor(home: string) {
    this.sourceRoot = join(home, ".claude", "projects");
  }

  async scanProject(canonicalRoot: string, depth: ScanDepth = "full"): Promise<AdapterScan> {
    const storage = await storageFingerprint(this.sourceRoot);
    if (!storage) return emptyScan(this.sourceKind);
    const entries: AdapterEntry[] = [];
    const prefix = encodeClaudePath(canonicalRoot);
    for (const directory of await safeDirectories(this.sourceRoot)) {
      if (!directory.name.startsWith(prefix)) continue;
      const root = join(this.sourceRoot, directory.name);
      for (const file of await safeFiles(root)) {
        if (!file.name.endsWith(".jsonl")) continue;
        const path = join(root, file.name);
        try {
          const meta = await sessionMeta(path, canonicalRoot, depth);
          if (!meta) continue;
          const value = await fingerprint(path, this.parserVersion);
          const canonicalNativeId = meta.sessionId || basename(file.name, ".jsonl");
          const aliases = normalizedAliases([
            canonicalNativeId,
            basename(file.name, ".jsonl"),
          ]);
          const key = {
            sourceKind: this.sourceKind,
            storageFingerprint: storage,
            canonicalNativeId,
            aliases,
            resumeAlias: canonicalNativeId,
          } as const;
          entries.push({
            opaqueId: opaqueSessionId(key),
            projectId: "",
            sourceKind: this.sourceKind,
            key,
            title: meta.title,
            cwd: meta.cwd,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
            historyRevision: fingerprintRevision(value),
            canResume: true,
            archived: false,
            incompleteTail: meta.incompleteTail,
            divergence: false,
            sourceIncarnation: initialSourceIncarnation(key, value),
            sourcePath: path,
            fingerprint: value,
          });
        } catch {
          /* 逐文件 fail-soft：EACCES、活跃写入与损坏文件一律跳过整条来源不受累 */
        }
      }
    }
    entries.sort(byCreatedAt);
    return {
      sourceKind: this.sourceKind,
      installed: true,
      entries,
      sourceRevision: digest(entries.map((entry) => entry.historyRevision).join("\0")),
    };
  }

  async parse(entry: AdapterEntry, signal?: AbortSignal): Promise<ParsedHistory> {
    const source = await readStableJsonl(entry.sourcePath, entry.fingerprint, signal);
    const blocks: ForeignHistoryBlock[] = [];
    const assistant = new Map<string, ForeignHistoryMessage>();
    const tools = new Map<string, ForeignToolEvent>();
    let deliverySeq = 0;
    for (const [index, line] of source.lines.entries()) {
      await historyParseCheckpoint(signal, index);
      deliverySeq += 1;
      let raw: Json;
      try {
        raw = JSON.parse(line) as Json;
      } catch {
        blocks.push(unsupported(line, deliverySeq, "invalid-json"));
        continue;
      }
      if (ignoredClaudeRecord(raw)) continue;
      const role = raw.type === "assistant" || raw.type === "user" ? raw.type : null;
      if (!role) {
        if (isKnownClaudeMetadata(raw)) continue;
        blocks.push(unsupported(line, deliverySeq, "unsupported-record"));
        continue;
      }
      const message = object(raw.message);
      const id = string(message?.id) ?? string(raw.uuid) ?? `${role}-${deliverySeq}`;
      const at = timestamp(raw.timestamp, entry.createdAt);
      const extracted = claudeContent(message?.content, tools);
      if (role === "user" && extracted.onlyToolResults) continue;
      if (!extracted.text.trim() && !extracted.tools.length) continue;
      if (role === "assistant") {
        const current = assistant.get(id);
        if (current) {
          const merged = {
            ...current,
            content: [current.content, extracted.text].filter(Boolean).join("\n"),
            tools: mergeTools(current.tools ?? [], extracted.tools),
          };
          assistant.set(id, merged);
          const index = blocks.findIndex((block) => block.kind === "message" && block.id === id);
          if (index >= 0) blocks[index] = merged;
          continue;
        }
      }
      const block: ForeignHistoryMessage = {
        kind: "message",
        id,
        nativeTurnId: id,
        deliverySeq,
        role,
        content: extracted.text.trim() || "已调用工具",
        createdAt: at,
        ...(extracted.tools.length ? { tools: extracted.tools } : {}),
      };
      blocks.push(block);
      if (role === "assistant") assistant.set(id, block);
    }
    return { blocks: refreshToolOutputs(blocks, tools), incompleteTail: source.incompleteTail };
  }
}

export function encodeClaudePath(path: string) {
  return path.replaceAll(/[^A-Za-z0-9]/g, "-");
}

/** 归属判据唯一出处：cwd 落在 Project 根内且不落在其 .claude/**（worktree agent）下。 */
function ownedCwd(cwd: string, projectRoot: string) {
  return isWithin(projectRoot, cwd) && !isWithin(join(projectRoot, ".claude"), cwd);
}

/**
 * 两档会话元数据。头读只为归属过滤：cwd/sessionId 在头部命中即可裁决归属，
 * 不属于本 Project 的文件（slug 前缀假阳性、worktree 会话）零全文成本跳过；
 * identity 档命中后以 stat 兜底呈现字段，full 档回到全文（后置 custom-title
 * 决定了 title 不可头读，PRD §F1）。头部未见身份的异形文件退回全文，不猜。
 * 64 MiB 上限在此统一裁决，两档对超大文件的收录结论必须一致。
 */
async function sessionMeta(path: string, projectRoot: string, depth: ScanDepth) {
  const fallback = await stat(path);
  if (fallback.size > HISTORY_FILE_BYTES) return null;
  const head = await readHeadLines(path);
  let cwd = "", sessionId = "";
  for (const line of head.lines) {
    let raw: Json;
    try { raw = JSON.parse(line) as Json; } catch { continue; }
    cwd ||= string(raw.cwd) ?? "";
    sessionId ||= string(raw.sessionId) ?? "";
    if (cwd && sessionId) break;
  }
  if (cwd && !ownedCwd(cwd, projectRoot)) return null;
  if (depth === "identity" && cwd && sessionId) {
    return {
      cwd,
      sessionId,
      title: "Claude Code 会话",
      createdAt: timestamp(undefined, fallback.birthtimeMs),
      updatedAt: timestamp(undefined, fallback.mtimeMs),
      incompleteTail: false,
    };
  }
  return fullMeta(path, projectRoot);
}

async function fullMeta(path: string, projectRoot: string) {
  const source = await readStableJsonl(path);
  let cwd = "", sessionId = "", title = "";
  let createdAt = Number.POSITIVE_INFINITY, updatedAt = 0;
  for (const line of source.lines) {
    let raw: Json;
    try { raw = JSON.parse(line) as Json; } catch { continue; }
    cwd ||= string(raw.cwd) ?? "";
    sessionId ||= string(raw.sessionId) ?? "";
    const at = timestamp(raw.timestamp, 0);
    if (at) {
      createdAt = Math.min(createdAt, at);
      updatedAt = Math.max(updatedAt, at);
    }
    const custom = string(raw.customTitle) ?? string(raw.title);
    if (raw.type === "custom-title" && custom) title = custom;
    if (!title && raw.type === "user" && !raw.isMeta) {
      title = claudeContent(object(raw.message)?.content, new Map()).text.trim();
    }
  }
  if (!cwd || !ownedCwd(cwd, projectRoot)) return null;
  const fallback = await stat(path);
  return {
    cwd,
    sessionId,
    title: humanTitle(title || "Claude Code 会话"),
    createdAt: Number.isFinite(createdAt) ? createdAt : timestamp(undefined, fallback.birthtimeMs),
    updatedAt: updatedAt || timestamp(undefined, fallback.mtimeMs),
    incompleteTail: source.incompleteTail,
  };
}

function claudeContent(value: unknown, results: Map<string, ForeignToolEvent>) {
  if (typeof value === "string") return { text: value, tools: [], onlyToolResults: false };
  if (!Array.isArray(value)) return { text: "", tools: [], onlyToolResults: false };
  const text: string[] = [], tools: ForeignToolEvent[] = [];
  let toolResults = 0;
  for (const item of value) {
    const block = object(item);
    if (!block) continue;
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
    if (block.type === "tool_use") {
      const event = {
        id: string(block.id) ?? `tool-${tools.length}`,
        name: string(block.name) ?? "tool",
        ...(block.input === undefined ? {} : { input: safeJson(block.input) }),
      };
      tools.push(event);
      results.set(event.id, event);
    }
    if (block.type === "tool_result") {
      toolResults += 1;
      const id = string(block.tool_use_id);
      const current = id ? results.get(id) : undefined;
      if (current) results.set(id!, { ...current, output: contentText(block.content) });
    }
  }
  return { text: text.join("\n"), tools, onlyToolResults: toolResults > 0 && !text.length && !tools.length };
}

function refreshToolOutputs(blocks: ForeignHistoryBlock[], results: Map<string, ForeignToolEvent>) {
  return blocks.map((block) => block.kind !== "message" || !block.tools ? block : {
    ...block,
    tools: block.tools.map((tool) => results.get(tool.id) ?? tool),
  });
}

function mergeTools(left: ForeignToolEvent[], right: ForeignToolEvent[]) {
  return [...new Map([...left, ...right].map((tool) => [tool.id, tool])).values()];
}

function ignoredClaudeRecord(raw: Json) {
  return raw.isSidechain === true || raw.isMeta === true || raw.type === "system" || raw.type === "progress";
}

function isKnownClaudeMetadata(raw: Json) {
  return ["custom-title", "file-history-snapshot", "queue-operation", "summary"].includes(String(raw.type));
}

function unsupported(line: string, seq: number, reason: string) {
  return {
    kind: "unsupported" as const,
    id: `unsupported-${seq}`,
    deliverySeq: seq,
    createdAt: 0,
    reason,
    escapedPreview: escapedUnsupported(line),
  };
}

const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const string = (value: unknown) => typeof value === "string" && value ? value : null;
const safeJson = (value: unknown) => { try { return JSON.stringify(value); } catch { return "[unserializable]"; } };
const contentText = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : string(object(item)?.text) ?? "").filter(Boolean).join("\n") : "";
const byCreatedAt = (left: AdapterEntry, right: AdapterEntry) => right.createdAt - left.createdAt || left.opaqueId.localeCompare(right.opaqueId);
const emptyScan = (sourceKind: "claude"): AdapterScan => ({ sourceKind, installed: false, entries: [], sourceRevision: "missing" });
async function storageFingerprint(root: string) { try { const value = await fingerprint(root); return digest(`${value.device}:${value.inode}`); } catch { return null; } }
async function safeDirectories(root: string) { try { return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()); } catch { return []; } }
async function safeFiles(root: string) { try { return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile()); } catch { return []; } }
