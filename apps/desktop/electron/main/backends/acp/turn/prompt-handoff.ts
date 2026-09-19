/**
 * [INPUT]: Depends on Node Writable and ACP JSON-RPC session/prompt wire
 * [OUTPUT]: Provides PromptHandoffTracker, projecting pending/accepted/rejected prompt state from child-stdin write completion, PromptHandoffSink, the write-side face a connection routes to the attached turn, and AcpOutboundSink, the observing wrapper around the outbound JSON-RPC stream
 * [POS]: Shared write-acknowledgement substrate for backends/acp/turn; prompt pending/accepted/rejected state is derived by observing outbound stdin writes, not from a separate ack channel
 */

import { Writable } from "node:stream";
import type { PromptHandoff } from "../../../../../shared/agent-ipc";

type HandoffWaiter = (value: PromptHandoff) => void;

/**
 * 写入侧只需要这三格。常驻连接的 sink 在构造时还不知道哪一轮会用它，
 * 所以它持有的是这张面，由连接把调用转给**当前**附着的 tracker。
 */
export type PromptHandoffSink = Pick<
  PromptHandoffTracker,
  "pending" | "accepted" | "rejected"
>;

export class PromptHandoffTracker {
  private value: PromptHandoff = Object.freeze({ kind: "not-created" });
  private readonly waiters = new Set<HandoffWaiter>();

  snapshot() {
    return this.value;
  }

  pending(requestId?: string) {
    if (this.value.kind !== "not-created") return;
    this.publish(
      Object.freeze({
        kind: "pending" as const,
        ...(requestId ? { transportRequestId: requestId } : {}),
      })
    );
  }

  accepted(requestId: string) {
    if (this.value.kind === "accepted" || this.value.kind === "rejected") return;
    this.publish(
      Object.freeze({ kind: "accepted", transportRequestId: requestId })
    );
  }

  rejected(requestId?: string) {
    /* 只有已创建/排队的 prompt 才能被拒绝。initialize/session 阶段关闭时
       没有任何 Agent request，终态必须保留 not-created。 */
    if (this.value.kind !== "pending") return;
    this.publish(
      Object.freeze({
        kind: "rejected" as const,
        ...(requestId ? { transportRequestId: requestId } : {}),
      })
    );
  }

  waitForTerminal() {
    if (this.value.kind !== "pending") return Promise.resolve(this.value);
    return new Promise<PromptHandoff>((resolve) => this.waiters.add(resolve));
  }

  private publish(value: PromptHandoff) {
    this.value = value;
    if (value.kind === "pending") return;
    for (const resolve of this.waiters) resolve(value);
    this.waiters.clear();
  }
}

export class AcpOutboundSink extends Writable {
  private buffered = "";

  constructor(
    private readonly destination: Writable,
    private readonly tracker: PromptHandoffSink,
    private readonly observe?: (line: string) => void
  ) {
    super();
    destination.once("error", () => tracker.rejected());
    destination.once("close", () => tracker.rejected());
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.buffered += payload.toString("utf8");
    const lines = this.buffered.split("\n");
    this.buffered = lines.pop() ?? "";
    let promptRequestId: string | null = null;
    for (const line of lines) {
      if (!line) continue;
      const parsed = parseLine(line);
      if (parsed.method === "session/prompt") {
        promptRequestId = parsed.id;
        this.tracker.pending(parsed.id);
        this.observe?.(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            method: parsed.method,
            params: { prompt: "[sensitive-contribution count/bytes redacted]" },
          })
        );
      } else {
        this.observe?.(line);
      }
    }
    try {
      this.destination.write(payload, (cause) => {
        if (cause) {
          this.tracker.rejected(promptRequestId ?? undefined);
          callback(cause);
          return;
        }
        if (promptRequestId) this.tracker.accepted(promptRequestId);
        callback();
      });
    } catch (cause) {
      this.tracker.rejected(promptRequestId ?? undefined);
      callback(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }
}

function parseLine(line: string) {
  try {
    const value = JSON.parse(line) as { id?: unknown; method?: unknown };
    return {
      id:
        typeof value.id === "string" || typeof value.id === "number"
          ? String(value.id)
          : "unknown",
      method: typeof value.method === "string" ? value.method : "",
    };
  } catch {
    return { id: "unknown", method: "" };
  }
}
