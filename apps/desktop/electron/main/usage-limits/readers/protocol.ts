/**
 * [INPUT]: Depends on supervised process streams and finite quota errors.
 * [OUTPUT]: Provides bounded JSON-RPC requests and a no-prompt Claude input guard.
 * [POS]: Reader protocol boundary; only fixed account/control requests reach native CLIs.
 */
import { StringDecoder } from "node:string_decoder";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { SupervisedSession } from "../../backends/supervised-session";
import { QuotaReadError, object } from "./common";

export function jsonRpc(session: SupervisedSession) {
  let sequence = 0;
  let buffer = "";
  const decoder = new StringDecoder("utf8");
  const pending = new Map<number, { resolve(value: unknown): void; reject(cause: Error): void }>();
  session.onOutput((chunk, stream) => {
    if (stream !== "stdout") return;
    buffer += decoder.write(chunk);
    if (buffer.length > 1024 * 1024) throw new Error("Quota frame exceeds limit");
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = object(JSON.parse(line));
      const waiter = pending.get(message.id as number);
      if (!waiter) continue;
      pending.delete(message.id as number);
      if (message.error) {
        const error = object(message.error);
        waiter.reject(new QuotaReadError(error.code === -32601 ? "unsupported" : "unavailable"));
      } else waiter.resolve(message.result);
    }
  });
  const send = (message: unknown) => session.child.stdin.write(JSON.stringify(message) + "\n");
  return {
    request(method: "initialize" | "account/read" | "account/rateLimits/read", params?: unknown) {
      const id = ++sequence;
      return session.race(new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ id, method, ...(params === undefined ? {} : { params }) });
      }));
    },
    initialized() { send({ method: "initialized", params: {} }); },
  };
}

export function guardClaudeControlInput(child: Pick<ChildProcessWithoutNullStreams, "stdin">) {
  const write = child.stdin.write.bind(child.stdin);
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const allowed = new Set(["initialize", "get_usage", "control_cancel_request"]);
  child.stdin.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
    const done = typeof encoding === "function" ? encoding : callback;
    try {
      buffer += typeof chunk === "string" ? chunk : decoder.write(Buffer.from(chunk));
      if (buffer.length > 256 * 1024) throw new Error("Quota input exceeds limit");
      let end: number;
      let accepted = "";
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const message = object(JSON.parse(line));
        if (message.type !== "control_request" || !allowed.has(String(object(message.request).subtype))) {
          throw new Error("Quota transport rejected non-account input");
        }
        accepted += line + "\n";
      }
      if (!accepted) { done?.(); return true; }
      return write(accepted, done);
    } catch {
      const error = new Error("Quota transport rejected non-account input");
      child.stdin.destroy(error);
      done?.(error);
      return false;
    }
  }) as typeof child.stdin.write;
}
