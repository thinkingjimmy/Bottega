/**
 * [INPUT]: Depends on node:child_process and the versioned system-dock bridge protocol schemas.
 * [OUTPUT]: Provides DockNativeBridge: a single-flight lazily started helper child with id-correlated bounded requests, validated results, pushed events, crash fencing, and cleanup; plus the NativePort interface consumers depend on.
 * [POS]: system-dock/native transport; every AppKit/CFPreferences/Apple Event/AX call leaves the Electron main thread through this pipe (INV-13).
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { BRIDGE_LIMITS, bridgeEventSchema, bridgeResponseSchema, bridgeResults, type BridgeEvent, type BridgeRequest, type BridgeResult } from "./protocol";

export class NativeBridgeError extends Error {
  constructor(readonly code: string) { super(`SYSTEM_DOCK_NATIVE_${code}`); this.name = "NativeBridgeError"; }
}
export type NativePort = {
  request<R extends BridgeRequest>(request: R, timeoutMs?: number): Promise<BridgeResult<R["op"]>>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
  close(): void;
};
type Pending = { op: BridgeRequest["op"]; resolve(value: unknown): void; reject(cause: Error): void; timer: ReturnType<typeof setTimeout> };

export class DockNativeBridge implements NativePort {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: BridgeEvent) => void>();
  private closed = false;
  constructor(private readonly path: string, private readonly failed: (code: string) => void = () => undefined, private readonly spawnChild = spawn) {}
  onEvent(listener: (event: BridgeEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  request<R extends BridgeRequest>(request: R, timeoutMs: number = BRIDGE_LIMITS.defaultTimeoutMs): Promise<BridgeResult<R["op"]>> {
    if (this.closed) return Promise.reject(new NativeBridgeError("CLOSED"));
    const child = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      // Timeout is an unknown outcome for side-effecting ops; callers decide, the bridge never retries.
      const timer = setTimeout(() => { this.pending.delete(id); reject(new NativeBridgeError("TIMEOUT")); }, timeoutMs);
      this.pending.set(id, { op: request.op, resolve: resolve as (value: unknown) => void, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, ...request })}\n`, (cause) => { if (cause) this.fail(child, "WRITE"); });
    });
  }
  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = this.spawnChild(this.path, [], { stdio: "pipe" });
    this.child = child;
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    child.on("error", () => this.fail(child, "SPAWN"));
    child.on("exit", () => this.fail(child, "EXIT"));
    child.stdin.on("error", () => this.fail(child, "WRITE"));
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > BRIDGE_LIMITS.lineBytes) { this.fail(child, "OVERSIZED"); return; }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (line.trim()) this.receive(child, line);
      }
    });
    return child;
  }
  private receive(child: ChildProcessWithoutNullStreams, line: string) {
    let message: unknown;
    try { message = JSON.parse(line); } catch { this.fail(child, "MALFORMED"); return; }
    if (message && typeof message === "object" && "event" in message) {
      const event = bridgeEventSchema.safeParse(message);
      if (!event.success) return;
      for (const listener of [...this.listeners]) { try { listener(event.data); } catch (cause) { console.warn("[system-dock] native listener failed", cause); } }
      return;
    }
    const response = bridgeResponseSchema.safeParse(message);
    if (!response.success) { this.fail(child, "MALFORMED"); return; }
    const pending = this.pending.get(response.data.id);
    if (!pending) return;
    this.pending.delete(response.data.id); clearTimeout(pending.timer);
    if (!response.data.ok) { pending.reject(new NativeBridgeError(response.data.error.toUpperCase().replaceAll("-", "_"))); return; }
    const parsed = bridgeResults[pending.op].safeParse(response.data.result);
    if (parsed.success) pending.resolve(parsed.data);
    else pending.reject(new NativeBridgeError("INVALID_RESULT"));
  }
  private fail(child: ChildProcessWithoutNullStreams, code: string) {
    if (this.child !== child) return;
    this.child = null;
    child.kill();
    for (const [id, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new NativeBridgeError(code)); this.pending.delete(id); }
    if (!this.closed) this.failed(code);
  }
  close() {
    this.closed = true;
    const child = this.child; this.child = null;
    for (const [, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new NativeBridgeError("CLOSED")); }
    this.pending.clear();
    child?.stdin.end(); child?.kill();
  }
}
