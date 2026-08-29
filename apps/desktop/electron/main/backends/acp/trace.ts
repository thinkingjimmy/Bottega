/**
 * [INPUT]: Depends on Node files/flows/crypto originals, ACP mapped event, shared turn draft, canonical chat parts and caller literal secret set
 * [OUTPUT]: Provides default shutdown attempt-unique AcpTraceWriter, wire line tee, key+literal sharing diagnosis of dementia, five-layer skeleton recording, terminal self-certification and scroll cleaning
 * [POS]: local diagnostic recorder of ACP transport; BridgeEntry owns writer, AcpTurn only uses narrow trace sink
 */

import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Transform, type TransformCallback } from "node:stream";
import type {
  AgentBackendId,
  AgentTurnItem,
} from "../../../../shared/agent-ipc";
import type {
  ChatMessage,
  ChatPart,
} from "../../../../shared/chats-ipc";
import type {
  DraftPart,
  TurnDraft,
} from "../../../../shared/chat-turn-reducer";
import type { AcpMappedEvent } from "./map-events";

export const ACP_TRACE_SCHEMA_VERSION = 1;
const ACP_TRACE_MAX_BYTES = 10 * 1024 * 1024;
const ACP_TRACE_MAX_FILES = 20;
const ACP_TRACE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const acpTraceEnabled = () => process.env.ACP_TRACE === "1";

const REDACTED = "[REDACTED]";
const SECRET_KEY = /(?:token|secret|key|authorization|password|credential)/i;
const DATA_URL = /^data:([^;,]+)?(?:;[^,]*)?,([\s\S]*)$/i;
const BARE_CREDENTIAL =
  /\b(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{11,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|glpat-[A-Za-z0-9_-]{12,}|hf_[A-Za-z0-9]{12,}|npm_[A-Za-z0-9]{12,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|ya29\.[A-Za-z0-9._-]{10,}|eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,})\b/g;
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/?#]+@/gi;

export type AcpDiagnosticRedactionOptions = {
  home?: string;
  homes?: readonly string[];
  secrets?: readonly string[];
  credentialPaths?: readonly string[];
};

type TracePart = {
  itemId: string;
  type: ChatPart["type"];
  toolKind?: string;
  status?: string;
};

export type AcpTraceRecord = {
  schemaVersion: number;
  seq: number;
  traceId: string;
  generation: number;
  t: number;
  layer:
    | "wire"
    | "mapped"
    | "draft"
    | "settled"
    | "persist"
    | "generation-start"
    | "terminal";
  backend: AgentBackendId;
  [key: string]: unknown;
};

export type AcpTraceSink = {
  recordWire(dir: "in" | "out", line: string): void;
  recordMapped(event: AcpMappedEvent): void;
};

function dataUrlSummary(value: string) {
  const match = DATA_URL.exec(value);
  if (!match) return value;
  const payload = match[2] ?? "";
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return `[DATA_URL type=${match[1] ?? "unknown"} chars=${payload.length} sha256=${digest}]`;
}

export const isAcpSecretName = (name: string) => SECRET_KEY.test(name);

export function acpDiagnosticRedactionOptions(
  env: NodeJS.ProcessEnv
): AcpDiagnosticRedactionOptions {
  const hostHome = homedir();
  const processHome = env.HOME?.trim();
  const homes = [...new Set([hostHome, processHome].filter(Boolean))] as string[];
  const secrets = Object.entries(env).flatMap(([name, value]) =>
    value && isAcpSecretName(name) ? [value] : []
  );
  return { home: hostHome, homes, secrets };
}

function replaceLiteral(value: string, literal: string, replacement: string) {
  return literal ? value.split(literal).join(replacement) : value;
}

/**
 * wire 与 process diagnostic 共用这一道出口。结构化 classifier 先吃 raw
 * evidence，只有即将写日志、回调或持久化时才调用它。
 */
export function redactAcpDiagnostic(
  text: string,
  options: AcpDiagnosticRedactionOptions = {}
) {
  let redacted = text
    .replace(
      /("(?:[^"\\]*(?:\\.[^"\\]*)*)?(?:token|secret|key|authorization|password|credential)(?:[^"\\]*(?:\\.[^"\\]*)*)?"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      `$1"${REDACTED}"`
    )
    .replace(
      /("name"\s*:\s*"[^"]*(?:token|secret|key|authorization|password|credential)[^"]*"\s*,\s*"value"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      `$1"${REDACTED}"`
    )
    .replace(
      /\b((?:[A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL)|AUTHORIZATION)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,}\]]+)/gi,
      `$1${REDACTED}`
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(BARE_CREDENTIAL, REDACTED)
    .replace(
      /data:([^;,\s]+)?(?:;[^,\s]*)?,[A-Za-z0-9+/=_-]+/gi,
      "data:$1,[REDACTED]"
    );
  for (const secret of options.secrets ?? []) {
    redacted = replaceLiteral(redacted, secret, REDACTED);
  }
  for (const path of options.credentialPaths ?? []) {
    redacted = replaceLiteral(redacted, path, "[CREDENTIAL_PATH]");
  }
  redacted = redacted.replace(
    /(?:~|\/)[^\s"'`]*?(?:auth\.json|credentials?(?:\.json)?|\.netrc|\.git-credentials|id_(?:rsa|ed25519))(?![\w.-])/gi,
    "[CREDENTIAL_PATH]"
  );
  const homes = [...new Set([...(options.homes ?? []), options.home])]
    .filter((home): home is string => Boolean(home) && home !== "/")
    .sort((left, right) => right.length - left.length);
  for (const home of homes) redacted = replaceLiteral(redacted, home, "~");
  return redacted;
}

function redactStructured(
  value: unknown,
  options: AcpDiagnosticRedactionOptions = {}
): unknown {
  if (typeof value === "string") {
    return redactAcpDiagnostic(dataUrlSummary(value), options);
  }
  if (Array.isArray(value)) return value.map((entry) => redactStructured(entry, options));
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const namedSecret =
    typeof source.name === "string" && SECRET_KEY.test(source.name);
  return Object.fromEntries(
    Object.entries(source).map(([key, entry]) => [
      key,
      SECRET_KEY.test(key) || (namedSecret && key === "value")
        ? REDACTED
        : redactStructured(entry, options),
    ])
  );
}

export function sanitizeAcpWireLine(
  line: string,
  options: AcpDiagnosticRedactionOptions = {}
) {
  try {
    return JSON.stringify(redactStructured(JSON.parse(line), options));
  } catch {
    return redactAcpDiagnostic(line, options);
  }
}

export class AcpTraceLineSplitter {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";

  constructor(private readonly onLine: (line: string) => void) {}

  write(chunk: Buffer | Uint8Array) {
    this.consume(this.decoder.write(Buffer.from(chunk)));
  }

  end() {
    this.consume(this.decoder.end());
    if (this.pending) this.emit(this.pending);
    this.pending = "";
  }

  private consume(text: string) {
    this.pending += text;
    let boundary = this.pending.indexOf("\n");
    while (boundary >= 0) {
      this.emit(this.pending.slice(0, boundary));
      this.pending = this.pending.slice(boundary + 1);
      boundary = this.pending.indexOf("\n");
    }
  }

  private emit(line: string) {
    this.onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  }
}

export class AcpTraceTee extends Transform {
  private readonly splitter: AcpTraceLineSplitter;

  constructor(onLine: (line: string) => void) {
    super();
    this.splitter = new AcpTraceLineSplitter(onLine);
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    this.splitter.write(chunk);
    callback(null, chunk);
  }

  override _flush(callback: TransformCallback) {
    this.splitter.end();
    callback();
  }
}

const openWriters = new Set<AcpTraceWriter>();
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", closeOpenAcpTraces);
}

export function closeOpenAcpTraces() {
  for (const writer of openWriters) writer.close("truncated");
}

function safeTraceName(chatId: string, turnSeq: number, attemptId: string) {
  const safeChatId = basename(chatId).replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safeChatId}-${turnSeq}-${attemptId}.jsonl`;
}

export function rotateAcpTraces(
  directory: string,
  now = Date.now(),
  maxFiles = ACP_TRACE_MAX_FILES,
  maxAgeMs = ACP_TRACE_MAX_AGE_MS
) {
  try {
    if (!statSync(directory).isDirectory()) {
      throw new Error(`ACP trace 路径不是目录：${directory}`);
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  chmodSync(directory, 0o700);
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => {
      const path = join(directory, name);
      try {
        const stat = statSync(path);
        return stat.isFile() ? [{ path, mtimeMs: stat.mtimeMs }] : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const [index, file] of files.entries()) {
    if (index >= maxFiles || now - file.mtimeMs > maxAgeMs) {
      try {
        unlinkSync(file.path);
      } catch {
        // Debug 清理失败不允许影响聊天。
      }
    }
  }
}

function traceParts(parts: readonly (DraftPart | ChatPart)[]): TracePart[] {
  return parts.map((part) => ({
    itemId: part.itemId,
    type: part.type,
    ...(part.type === "tool" ? { toolKind: part.tool } : {}),
    ...("status" in part ? { status: part.status } : {}),
  }));
}

export class AcpTraceWriter {
  readonly traceId: string;
  readonly path: string;
  private readonly fd: number;
  private seq = 0;
  private currentGeneration = 1;
  private bytesWritten = 0;
  private droppedRecords = 0;
  private closed = false;

  constructor(
    directory: string,
    chatId: string,
    turnSeq: number,
    private readonly backend: AgentBackendId,
    private readonly maxBytes = ACP_TRACE_MAX_BYTES
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    rotateAcpTraces(
      directory,
      Date.now(),
      Math.max(0, ACP_TRACE_MAX_FILES - 1)
    );
    const attemptId = randomUUID();
    this.traceId = `${chatId}:${turnSeq}:${attemptId}`;
    this.path = join(
      directory,
      safeTraceName(chatId, turnSeq, attemptId)
    );
    this.fd = openSync(
      this.path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600
    );
    chmodSync(this.path, 0o600);
    openWriters.add(this);
    installExitHook();
    this.recordGenerationStart(1);
  }

  sink(
    generation: number,
    redaction: AcpDiagnosticRedactionOptions = {}
  ): AcpTraceSink {
    return {
      recordWire: (dir, line) => this.recordWire(generation, dir, line, redaction),
      recordMapped: (event) => this.recordMapped(generation, event),
    };
  }

  recordGenerationStart(generation: number) {
    this.currentGeneration = generation;
    this.append("generation-start", { event: "generation-start" }, generation);
  }

  recordWire(
    generation: number,
    dir: "in" | "out",
    line: string,
    redaction: AcpDiagnosticRedactionOptions = {}
  ) {
    this.append(
      "wire",
      { dir, line: sanitizeAcpWireLine(line, redaction) },
      generation
    );
  }

  recordMapped(generation: number, event: AcpMappedEvent) {
    this.append(
      "mapped",
      event.type === "delta"
        ? {
            event: {
              type: "delta",
              itemId: event.itemId,
              bytes: Buffer.byteLength(event.text, "utf8"),
            },
          }
        : { event },
      generation
    );
  }

  recordDraft(
    generation: number,
    input:
      | { type: "item"; item: AgentTurnItem; draft: TurnDraft }
      | { type: "delta"; itemId: string; draft: TurnDraft }
      | { type: "item-removed"; itemId: string; draft: TurnDraft }
  ) {
    this.append(
      "draft",
      {
        event:
          input.type === "item"
            ? { type: "item", itemId: input.item.itemId }
            : input.type === "delta"
              ? {
                  type: "delta",
                  itemId: input.itemId,
                  streamingBytes: Buffer.byteLength(
                    input.draft.streaming.get(input.itemId) ?? "",
                    "utf8"
                  ),
                }
              : { type: "item-removed", itemId: input.itemId },
        parts: traceParts(input.draft.parts),
      },
      generation
    );
  }

  recordSettled(
    generation: number,
    message: ChatMessage | undefined,
    terminal: "done" | "cancelled" | "error"
  ) {
    this.append(
      "settled",
      {
        terminal,
        isError: message?.isError === true,
        parts: traceParts(message?.parts ?? []),
      },
      generation
    );
  }

  recordPersist(
    generation: number,
    outcome: "stored" | "empty" | "missing" | "retryable" | "fatal"
  ) {
    this.append("persist", { outcome }, generation);
  }

  flush() {
    if (this.closed) return;
    try {
      fsyncSync(this.fd);
    } catch {
      this.droppedRecords += 1;
    }
  }

  close(completeness: "complete" | "truncated") {
    if (this.closed) return;
    this.writeLine(
      {
        schemaVersion: ACP_TRACE_SCHEMA_VERSION,
        seq: ++this.seq,
        traceId: this.traceId,
        generation: this.currentGeneration,
        t: Date.now(),
        layer: "terminal",
        backend: this.backend,
        completeness,
        droppedRecords: this.droppedRecords,
      },
      true
    );
    this.closed = true;
    openWriters.delete(this);
    try {
      fsyncSync(this.fd);
    } catch {
      // terminal 已携带此前的 droppedRecords；close 失败只能静默降级。
    }
    try {
      closeSync(this.fd);
    } catch {
      // Debug recorder 永远不能阻断聊天终态。
    }
  }

  private append(
    layer: AcpTraceRecord["layer"],
    payload: Record<string, unknown>,
    generation: number
  ) {
    if (this.closed) return;
    this.currentGeneration = generation;
    this.writeLine({
      schemaVersion: ACP_TRACE_SCHEMA_VERSION,
      seq: ++this.seq,
      traceId: this.traceId,
      generation,
      t: Date.now(),
      layer,
      backend: this.backend,
      ...payload,
    });
  }

  private writeLine(record: AcpTraceRecord, terminal = false) {
    const line = `${JSON.stringify(redactStructured(record))}\n`;
    const bytes = Buffer.byteLength(line);
    if (!terminal && this.bytesWritten + bytes + 512 > this.maxBytes) {
      this.droppedRecords += 1;
      return;
    }
    try {
      writeSync(this.fd, line);
      this.bytesWritten += bytes;
    } catch {
      this.droppedRecords += 1;
    }
  }
}
