/**
 * [INPUT]: Depends on detached spawn, the existing process supervisor, process-group cleanup and AbortSignal.
 * [OUTPUT]: Provides a supervised bidirectional session (its bounded streams from usage-limits/readers/protocol.ts, shared with the Provider bridge) and a cleanup barrier: close() cleans the process group, then waits (bounded, escalating to SIGKILL once) until the child itself is reaped (DM-05).
 * [POS]: Transport host for zero-prompt quota readers; protocol data never enters diagnostic tail buffers.
 */
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import { assertAgentProcessAdmission, registerAuxiliaryAgentProcess, reportAgentCleanupFailure } from "../../agent-process-supervisor";
import { cleanProcessGroup } from "../../agent/process/process-group";
import { sessionStreams } from "../../usage-limits/readers/protocol";

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
/* DM-05 (test audit): the group being gone is not the child being reaped. Until Node collects its exit the leader is a zombie, and on
   macOS kill(-pid) then answers EPERM, so "removed before credential access resumes" would not yet be literally true. */
const REAP_MS = 2_000;
function reaped(child: ChildProcessWithoutNullStreams, ms: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { child.off("exit", onExit); resolve(false); }, ms);
    const onExit = () => { clearTimeout(timer); resolve(true); };
    child.once("exit", onExit);
  });
}

export function createSupervisedSession(options: Options, dependencies: Dependencies = {}) {
  options.signal.throwIfAborted();
  assertAgentProcessAdmission(options.backend);
  const child = (dependencies.spawn ?? spawn)(options.command, options.args, {
    cwd: options.cwd, env: options.env, detached: true, stdio: "pipe",
  });
  const streams = sessionStreams(child);
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => { finish = resolve; });
  let closing: Promise<void> | undefined;
  const onAbort = () => streams.fail(new Error("Quota session cancelled"));
  let registration: ReturnType<typeof registerAuxiliaryAgentProcess> | undefined;
  let registrationFailure = false;
  try { registration = registerAuxiliaryAgentProcess(options.backend, child, settled); }
  catch { registrationFailure = true; streams.fail(new Error("Quota process admission changed")); }
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) onAbort();
  const close = () => closing ??= (async () => {
    options.signal.removeEventListener("abort", onAbort);
    streams.closing();
    try {
      child.stdin.end();
      const result = child.pid ? await (dependencies.clean ?? cleanProcessGroup)(child.pid) : { ok: true as const };
      if (!result.ok) throw new Error("Quota process cleanup failed");
      /* Bounded wait for the reap; a child that has still not exited is killed directly and waited for once more. */
      if (child.pid && !await reaped(child, REAP_MS)) {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        if (!await reaped(child, REAP_MS)) throw new Error("Quota process was not reaped");
      }
      registration?.();
    } catch {
      const error = new Error("Quota process cleanup failed");
      reportAgentCleanupFailure(options.backend, error, registration?.owner);
      throw error;
    } finally { finish(); }
  })();
  if (registrationFailure) void close().catch(() => undefined);
  return { child, settled, onOutput: streams.onOutput, race: streams.race, close };
}
