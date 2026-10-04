/**
 * [INPUT]: Depends on ACP probe lifecycle, process-tree observations and liveness verification.
 * [OUTPUT]: Provides probeTeardown: enforced only after successful startup and verified process-tree cleanup; native initialize-only probes may have one process.
 * [POS]: Cancellation evidence probe shared by adapter-backed and native ACP Providers.
 */
import { execFileSync, spawn } from "node:child_process";
import { inspectAcpSession, type AcpProbeOptions } from "../../backends/acp/probe";

export type TeardownResult = { state: "enforced" | "unsupported" | "unverified"; tree: number[]; survivors: number[]; goneMs: number | null; error: string | null };

function descendants(root: number) {
  const rows = execFileSync("/bin/ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).trim().split("\n")
    .map(line => line.trim().split(/\s+/).map(Number) as [number, number]);
  const tree = [root];
  for (let index = 0; index < tree.length; index++) for (const [pid, ppid] of rows) if (ppid === tree[index] && !tree.includes(pid)) tree.push(pid);
  return tree;
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (cause) { return (cause as NodeJS.ErrnoException).code === "EPERM"; } };

export async function probeTeardown(options: AcpProbeOptions, deadlineMs = 5_000, inspect: typeof inspectAcpSession = inspectAcpSession): Promise<TeardownResult> {
  let root: number | undefined, tree: number[] = [], error: string | null = null;
  try {
    await inspect(options, async () => {
      /* The session is open, so the adapter has spawned its CLI: this is the tree a cancel must end. */
      if (root !== undefined) tree = descendants(root);
    }, { spawnProcess: (command, args, spawnOptions) => { const child = spawn(command, [...args], spawnOptions); root = child.pid; return child; } });
  } catch (cause) {
    error = cause instanceof Error ? cause.message.slice(0, 300) : String(cause);
  }
  const minimumTree = options.initializeOnly ? 1 : 2;
  if (error || tree.length < minimumTree) return { state: "unverified", tree, survivors: tree.filter(alive), goneMs: null,
    error: error ?? "no running CLI was observed" };
  const started = Date.now();
  let survivors = tree.filter(alive);
  while (survivors.length && Date.now() - started < deadlineMs) {
    await new Promise(resolve => setTimeout(resolve, 100));
    survivors = survivors.filter(alive);
  }
  return survivors.length ? { state: "unsupported", tree, survivors, goneMs: null, error }
    : { state: "enforced", tree, survivors, goneMs: Date.now() - started, error };
}
