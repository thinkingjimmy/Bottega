/**
 * [INPUT]: Depends on Node subprocesses, task cancellation, owned process-group cleanup and the supervised command runner.
 * [OUTPUT]: Runs an installation subprocess with line callbacks and a joined process lifetime; executeAgentCommand runs an Agent CLI command as a supervised auxiliary process.
 * [POS]: Source installation process leaf shared by the installer coordinator.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { asError } from "../../ipc/errors";
import { stopProcessGroup } from "../../agent/process/process-group";
import type { InstallTask } from "../install/task-queue";
import { runSupervisedCommand } from "../../backends/jobs/supervised-command";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
type ExecuteOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  task: InstallTask;
  stdin?: string;
  allowFailure?: boolean;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
};

type ExecuteResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const AGENT_COMMAND_TIMEOUT_MS = 120_000;

/** An Agent CLI command outside a turn (an App extension's plugin commands): a supervised auxiliary process, admitted for
    its Agent and tracked for the crash watchdog, instead of a bare install process (TASK-13 D). */
export async function executeAgentCommand(backend: AgentBackendId, executable: string, args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; allowFailure?: boolean }) {
  const run = runSupervisedCommand({ backend, command: executable, args, cwd: options.cwd, env: options.env, signal: options.signal,
    timeoutMs: AGENT_COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, label: `${args.slice(0, 3).join(" ")}` }).then(result => result.stdout);
  const stdout = options.allowFailure ? await run.catch(() => { options.signal?.throwIfAborted(); return ""; }) : await run;
  return { stdout };
}

export function executeInstallProcess(
    executable: string,
    args: string[],
    options: ExecuteOptions
  ) {
    return new Promise<ExecuteResult>((resolvePromise, reject) => {
      if (options.task.controller.signal.aborted) {
        reject(asError(options.task.controller.signal.reason ?? "操作已取消"));
        return;
      }
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(executable, args, {
          cwd: options.cwd,
          detached: true,
          env: options.env,
        });
      } catch (cause) {
        reject(asError(cause));
        return;
      }
      let stdout = "";
      let stderr = "";
      let spawned = false;
      const onAbort = () => {
        const pid = child.pid;
        if (pid) void stopProcessGroup(pid);
      };
      options.task.controller.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      const stdoutLines = createInterface({ input: child.stdout });
      const stderrLines = createInterface({ input: child.stderr });
      stdoutLines.on("line", (line) => options.onStdout?.(line));
      stderrLines.on("line", (line) => options.onStderr?.(line));
      child.once("spawn", () => {
        spawned = true;
        if (child.pid) options.task.pids.add(child.pid);
        if (options.stdin !== undefined) child.stdin.end(options.stdin);
        else child.stdin.end();
      });
      child.once("error", (error) => {
        options.task.controller.signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.once("close", (code) => {
        options.task.controller.signal.removeEventListener("abort", onAbort);
        const pid = child.pid;
        if (pid) options.task.pids.delete(pid);
        void (async () => {
          if (pid) await stopProcessGroup(pid);
          const result = { code: code ?? 1, stdout, stderr };
          if (options.task.controller.signal.aborted) {
            reject(
              asError(options.task.controller.signal.reason ?? "操作已取消")
            );
          } else if (result.code === 0 || options.allowFailure) {
            resolvePromise(result);
          } else {
            const detail = stderr.trim() || stdout.trim();
            reject(
              new Error(
                `${executable} 退出 code=${result.code}${detail ? `：${detail.slice(-1_000)}` : ""}`
              )
            );
          }
        })().catch(reject);
      });
      if (!spawned && options.task.controller.signal.aborted) onAbort();
    });
  }
