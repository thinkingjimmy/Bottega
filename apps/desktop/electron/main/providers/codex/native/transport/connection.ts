/**
 * [INPUT]: Uses the actual desktop package version; Uses an AgentProcessHost supplied by main and its relayed child streams.
 * [OUTPUT]: Exports NativeConnection and NativeMessage for bounded native RPC.
 * [POS]: Native transport only; launch, permissions and execution authority stay in main.
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentProcessHost } from "../../../../backends/contracts/types";

export type NativeMessage = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } };
import desktopPackage from "../../../../../../package.json";
import { NativeRpcError, NativeTransportError } from "./errors";
type Pending = { resolve(value: unknown): void; reject(cause: Error): void; timer: ReturnType<typeof setTimeout>; write?: WriteObserver };
type WriteObserver = { pending(id: string): void; accepted(id: string): void; rejected(id: string): void };

export class NativeConnection {
  readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private buffer: Buffer = Buffer.alloc(0);
  private totalBytes = 0;
  private totalEvents = 0;
  private windowStart = Date.now();
  private windowEvents = 0;
  private closed = false;
  private stderr = "";
  private failure: Error | null = null;
  readonly exited: Promise<void>;

  constructor(private readonly host: AgentProcessHost, private readonly handlers: {
    message?(message: NativeMessage): void;
    failed?(error: Error): void;
    trace?(direction: "in" | "out", summary: string): void;
  } = {}) {
    this.child = host.launch({ command: "sealed-plan", args: [], cwd: "/", env: {} });
    this.exited = new Promise(resolve => this.child.once("close", () => resolve()));
    this.child.stdout.on("data", (bytes: Buffer) => { try { this.receive(bytes); } catch (cause) { this.fail(new NativeTransportError("protocol", cause instanceof Error ? cause.message : String(cause))); } });
    this.child.stderr.on("data", (bytes: Buffer) => { this.stderr = (this.stderr + bytes.toString("utf8")).slice(-16_384); });
    this.child.stdin.on("error", cause => this.fail(cause));
    this.child.on("error", cause => this.fail(cause));
    this.child.once("close", (code, signal) => {
      if (!this.closed) this.fail(new NativeTransportError("exit", this.buffer.length ? "Native CLI closed with a truncated JSONL frame" : `Native CLI exited before completion (${code ?? signal ?? "unknown"})`));
    });
    void host.delivered.catch(cause => this.fail(cause));
  }

  get pid() { return this.child.pid; }
  get diagnosticTail() { return this.stderr; }

  async initialize() {
    await this.host.delivered;
    const result = await this.request("initialize", { clientInfo: { name: "bottega", title: "Bottega", version: desktopPackage.version }, capabilities: { experimentalApi: true } }, { timeoutMs: 15_000 });
    this.notify("initialized");
    return result;
  }

  request<T = unknown>(method: string, params: unknown = {}, options: { timeoutMs?: number; write?: WriteObserver } = {}): Promise<T> {
    if (this.closed || this.failure) return Promise.reject(this.failure ?? new Error("Native connection closed"));
    const id = ++this.sequence;
    const result = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new NativeTransportError("timeout", `${method} timed out; delivery is not retried`)); }, options.timeoutMs ?? 30_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer, write: options.write });
    });
    void this.host.delivered.then(() => {
      if (!this.pending.has(id)) return;
      options.write?.pending(String(id));
      this.send({ id, method, params }, cause => {
        if (cause) { options.write?.rejected(String(id)); this.fail(cause); }
        // Relay acknowledgement cannot prove native delivery; only the matching server reply can.
      });
    }, cause => this.fail(cause));
    return result;
  }

  notify(method: string, params?: unknown) { this.send({ method, ...(params === undefined ? {} : { params }) }); }
  respond(id: string | number, result: unknown) { this.send({ id, result }); }
  reject(id: string | number, message: string) { this.send({ id, error: { code: -32601, message } }); }

  /** Background output gets a fresh bounded window after model execution has ended. */
  resetBudget() { this.totalBytes = 0; this.totalEvents = 0; }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error("Native connection closed")); }
    this.pending.clear();
    this.child.stdin.end();
  }

  private send(message: NativeMessage, callback?: (cause?: Error | null) => void) {
    if (this.closed || this.failure) { callback?.(this.failure ?? new Error("Native connection closed")); return; }
    const frame = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(frame) > 32 * 1024 * 1024) { const cause = new Error("Native outbound input exceeds 32 MiB"); callback?.(cause); this.fail(cause); return; }
    // Trace method/association only: prompts, MCP credentials and error echoes never cross this diagnostic boundary.
    this.handlers.trace?.("out", JSON.stringify({ id: message.id, method: message.method, response: !message.method }));
    try { this.child.stdin.write(frame, callback ?? (cause => { if (cause) this.fail(cause); })); }
    catch (cause) { callback?.(cause as Error); this.fail(cause); }
  }

  private receive(bytes: Buffer) {
    if (this.closed || this.failure) return;
    this.totalBytes += bytes.length;
    if (this.totalBytes > 32 * 1024 * 1024) throw new Error("Native inbound turn exceeds 32 MiB");
    this.buffer = Buffer.concat([this.buffer, bytes]);
    let index: number;
    while ((index = this.buffer.indexOf(10)) >= 0) {
      if (index > 1024 * 1024) throw new Error("Native JSONL frame exceeds 1 MiB");
      const frame = this.buffer.subarray(0, index); this.buffer = this.buffer.subarray(index + 1);
      if (!frame.length) continue;
      if (++this.totalEvents > 50_000) throw new Error("Native event count exceeds 50000");
      if (Date.now() - this.windowStart >= 1000) { this.windowStart = Date.now(); this.windowEvents = 0; }
      if (++this.windowEvents > 1000) throw new Error("Native event rate exceeds 1000/s");
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native RPC envelope");
      const message = value as NativeMessage;
      if (message.method !== undefined && typeof message.method !== "string") throw new Error("Invalid native RPC method");
      if (message.id !== undefined && typeof message.id !== "number" && typeof message.id !== "string") throw new Error("Invalid native RPC id");
      if ((typeof message.id === "number" && !Number.isSafeInteger(message.id)) || (typeof message.id === "string" && (!message.id || message.id.length > 4096))) throw new Error("Invalid native RPC id range");
      const hasResult = Object.hasOwn(message, "result"), hasError = Object.hasOwn(message, "error");
      if (message.method !== undefined ? !message.method || hasResult || hasError : message.id === undefined || hasResult === hasError) throw new Error("Invalid native RPC envelope fields");
      if (hasError && (!message.error || typeof message.error !== "object" || !Number.isSafeInteger(message.error.code) || typeof message.error.message !== "string")) throw new Error("Invalid native RPC error");
      this.handlers.trace?.("in", JSON.stringify({ id: message.id, method: message.method, errorCode: message.error?.code }));
      if (message.method) this.handlers.message?.(message);
      else if (typeof message.id === "number") {
        const item = this.pending.get(message.id);
        if (!item) continue;
        this.pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(new NativeRpcError(message.error.code, message.error.message, message.error.data));
        else { item.write?.accepted(String(message.id)); item.resolve(message.result); }
      } else throw new Error("Native RPC envelope has neither a method nor a request id");
    }
    if (this.buffer.length > 1024 * 1024) throw new Error("Native unterminated frame exceeds 1 MiB");
  }

  private fail(cause: unknown) {
    if (this.closed || this.failure) return;
    this.failure = cause instanceof Error ? cause : new Error(String(cause));
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(this.failure); }
    this.pending.clear(); this.handlers.failed?.(this.failure);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
  }
}
