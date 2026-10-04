/**
 * [INPUT]: Depends on a quota session's streams (main's supervised session or the bridge's relayed child), finite quota errors (wire.ts) and web globals only (TextDecoder, crypto.randomUUID): no Node built-in, so a pinned bridge module can carry it.
 * [OUTPUT]: Provides sessionStreams (a quota session's bounded output fan-out, 2 MiB, its failure race and closing mark) with the QuotaStreams type, bounded JSON-RPC requests, the Claude stream-json control client (initialize, get_usage) and a no-prompt Claude input guard.
 * [POS]: Reader protocol boundary, bridge-safe; only fixed account/control requests reach native CLIs. Main's supervised session and the Provider bridge share its streams.
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { QuotaReadError, object } from "./wire";

/* The transport half of main's supervised session (backends/jobs/supervised-session.ts), bridge-safe: no admission, no process group, no
   launch, so the same bytes are read the same way in main and on the Provider bridge (TASK-11 D9). */
const OUTPUT_LIMIT = 2 * 1024 * 1024;

export function sessionStreams(child: ChildProcessWithoutNullStreams) {
  let fail!: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => { fail = reject; });
  // A stream may fail before the reader starts awaiting its first response.
  void failure.catch(() => undefined);
  let closing = false;
  child.once("error", () => fail(new Error("Quota process could not start")));
  child.stdin.on("error", () => fail(new Error("Quota input closed")));
  child.once("close", () => { if (!closing) fail(new Error("Quota process closed before completion")); });
  const output = new Set<(chunk: Buffer, stream: "stdout" | "stderr") => void>();
  let bytes = 0;
  for (const stream of ["stdout", "stderr"] as const) {
    child[stream].on("data", (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT) { fail(new Error("Quota output exceeds limit")); return; }
      try { for (const listener of output) listener(chunk, stream); }
      catch { fail(new Error("Quota response is invalid")); }
    });
  }
  return {
    child,
    fail,
    /** A close the owner asked for: the process ending is no longer a failure, and nothing is read any more. */
    closing() { closing = true; output.clear(); },
    onOutput(listener: (chunk: Buffer, stream: "stdout" | "stderr") => void) {
      output.add(listener);
      return () => output.delete(listener);
    },
    race<T>(promise: Promise<T>): Promise<T> { return Promise.race([promise, failure]); },
  };
}
export type QuotaStreams = Pick<ReturnType<typeof sessionStreams>, "child" | "onOutput" | "race">;

export function jsonRpc(session: QuotaStreams) {
  let sequence = 0;
  let buffer = "";
  const decoder = new TextDecoder("utf-8");
  const pending = new Map<number, { resolve(value: unknown): void; reject(cause: Error): void }>();
  session.onOutput((chunk, stream) => {
    if (stream !== "stdout") return;
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 1024 * 1024) throw new Error("Quota frame exceeds limit");
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = object(JSON.parse(line));
      // A request from the CLI can reuse one of our numeric ids; only a response (no method) answers ours.
      if (typeof message.method === "string") continue;
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

/* Claude's stream-json control protocol, spoken directly (C-13): the SDK that wrapped it kept its 1.3 MB bundle in the
   main heap for the rest of the session after the first quota read. Requests carry a random id; the CLI answers with a
   control_response naming it, `success` with a payload or `error` with a message. */
export function claudeControl(session: QuotaStreams) {
  let buffer = "";
  const decoder = new TextDecoder("utf-8");
  const pending = new Map<string, { resolve(value: unknown): void; reject(cause: Error): void }>();
  session.onOutput((chunk, stream) => {
    if (stream !== "stdout") return;
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 1024 * 1024) throw new Error("Quota frame exceeds limit");
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = object(JSON.parse(line));
      if (message.type !== "control_response") continue;
      const response = object(message.response);
      const waiter = pending.get(String(response.request_id));
      if (!waiter) continue;
      pending.delete(String(response.request_id));
      if (response.subtype === "success") waiter.resolve(response.response ?? null);
      else waiter.reject(new QuotaReadError("unavailable"));
    }
  });
  return {
    request(request: { subtype: "initialize"; systemPrompt: string[] } | { subtype: "get_usage" }) {
      const id = globalThis.crypto.randomUUID();
      return session.race(new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        session.child.stdin.write(JSON.stringify({ request_id: id, type: "control_request", request }) + "\n");
      }));
    },
  };
}

export function guardClaudeControlInput(child: Pick<ChildProcessWithoutNullStreams, "stdin">) {
  const write = child.stdin.write.bind(child.stdin);
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const allowed = new Set(["initialize", "get_usage", "control_cancel_request"]);
  child.stdin.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
    const done = typeof encoding === "function" ? encoding : callback;
    try {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
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
