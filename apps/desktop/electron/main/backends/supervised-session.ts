/**
 * [INPUT]: Depends on detached spawn, the existing process supervisor, process-group cleanup and AbortSignal.
 * [OUTPUT]: Provides a supervised bidirectional session with bounded streams and a cleanup barrier.
 * [POS]: Transport host for zero-prompt quota readers; protocol data never enters diagnostic tail buffers.
 */
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import { assertAgentProcessAdmission, registerAuxiliaryAgentProcess, reportAgentCleanupFailure } from "../agent-process-supervisor";
import { cleanProcessGroup } from "../process-group";

type Options = {
  backend: AgentBackendId;
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
};
type Dependencies = {
  spawn?: (command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
  clean?: typeof cleanProcessGroup;
};
export function createSupervisedSession(options: Options, dependencies: Dependencies = {}) {
  options.signal.throwIfAborted();
  assertAgentProcessAdmission(options.backend);
  const child = (dependencies.spawn ?? spawn)(options.command, options.args, {
    cwd: options.cwd, env: options.env, detached: true, stdio: "pipe",
  });
  let fail!: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => { fail = reject; });
  // A stream may fail before the reader starts awaiting its first response.
  void failure.catch(() => undefined);
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => { finish = resolve; });
  let closing: Promise<void> | undefined;
  const onAbort = () => fail(new Error("Quota session cancelled"));
  child.once("error", () => fail(new Error("Quota process could not start")));
  child.stdin.on("error", () => fail(new Error("Quota input closed")));
  child.once("close", () => { if (!closing) fail(new Error("Quota process closed before completion")); });
  let registration: ReturnType<typeof registerAuxiliaryAgentProcess> | undefined;
  let registrationFailure = false;
  try { registration = registerAuxiliaryAgentProcess(options.backend, child, settled); }
  catch { registrationFailure = true; fail(new Error("Quota process admission changed")); }
  const output = new Set<(chunk: Buffer, stream: "stdout" | "stderr") => void>();
  let bytes = 0;
  for (const stream of ["stdout", "stderr"] as const) {
    child[stream].on("data", (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { fail(new Error("Quota output exceeds limit")); return; }
      try { for (const listener of output) listener(chunk, stream); }
      catch { fail(new Error("Quota response is invalid")); }
    });
  }
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) onAbort();
  const close = () => closing ??= (async () => {
    options.signal.removeEventListener("abort", onAbort);
    output.clear();
    try {
      child.stdin.end();
      const result = child.pid ? await (dependencies.clean ?? cleanProcessGroup)(child.pid) : { ok: true as const };
      if (!result.ok) throw new Error("Quota process cleanup failed");
      registration?.();
    } catch {
      const error = new Error("Quota process cleanup failed");
      reportAgentCleanupFailure(options.backend, error, registration?.owner);
      throw error;
    } finally { finish(); }
  })();
  if (registrationFailure) void close().catch(() => undefined);
  return {
    child, settled,
    onOutput(listener: (chunk: Buffer, stream: "stdout" | "stderr") => void) {
      output.add(listener);
      return () => output.delete(listener);
    },
    race<T>(promise: Promise<T>): Promise<T> { return Promise.race([promise, failure]); },
    close,
  };
}
export type SupervisedSession = ReturnType<typeof createSupervisedSession>;
