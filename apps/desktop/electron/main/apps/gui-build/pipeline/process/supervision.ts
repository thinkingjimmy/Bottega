/**
 * [INPUT]: Node child processes, compiler resource budgets and Windows Job supervision.
 * [OUTPUT]: Launch, SupervisionLimit, SupervisionResult, SAMPLE_INTERVAL_MS, supervise, terminateTree, killGroup, processTreeUsage, liveDescendants, processTree, ensureProcessTreeExit, parseCpuTime, unavailable.
 * [POS]: Compiler process supervision and resource accounting; native authority construction stays in sandbox.ts.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { APP_GUI_BUILD_BUDGET } from "../../contracts";
import { createWindowsCompilerPolicy } from "../../transport/windows-policy";
import { superviseWindowsCompiler } from "../../transport/windows-supervisor";

export type Launch = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  stdin: Buffer;
  windowsPolicy?: ReturnType<typeof createWindowsCompilerPolicy>;
}>;

export type SupervisionLimit =
  | "wall" | "cpu" | "rss" | "process" | "custody"
  | "stdout" | "stderr" | "aborted" | null;

export type SupervisionResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  limit: SupervisionLimit;
  mechanism?: string;
  /** The most processes the supervisor saw in the tree at once (evidence for a custody verdict). */
  peakProcesses?: number;
}>;

export const SAMPLE_INTERVAL_MS = 500;

export async function supervise(
  launch: Launch,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  limits: Readonly<{ rssBytes?: number; cpuTimeMs?: number; processCount?: number }> = {}
): Promise<SupervisionResult> {
  /* Windows 永远不进下面的 POSIX 监督：launch() 给它的是 wrapper policy，
     进程树归属由 wrapper 的 Job 负责，Host 只校验它的释放报告。 */
  if (launch.windowsPolicy) return superviseWindowsCompiler({ ...launch, windowsPolicy: launch.windowsPolicy }, signal);
  const child = spawn(launch.command, [...launch.args], {
    cwd: launch.cwd,
    env: { ...launch.env },
    detached: true,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(launch.stdin);
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let limit: SupervisionLimit = null, peakProcesses = 0;
  let sampling: Promise<void> | null = null;
  const knownPids = new Set<number>(child.pid ? [child.pid] : []);
  const collect = (current: Buffer, chunk: Buffer, maximum: number, name: "stdout" | "stderr") => {
    const next = Buffer.concat([current, chunk]);
    if (next.byteLength > maximum && !limit) {
      limit = name;
      void terminateTree(child, knownPids);
    }
    return next.subarray(0, maximum);
  };
  child.stdout.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk, APP_GUI_BUILD_BUDGET.stdoutBytes, "stdout"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk, APP_GUI_BUILD_BUDGET.stderrBytes, "stderr"); });
  const abort = () => { if (!limit) limit = "aborted"; void terminateTree(child, knownPids); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const wallTimer = setTimeout(() => { if (!limit) limit = "wall"; void terminateTree(child, knownPids); }, timeoutMs);
  const resourceTimer = setInterval(async () => {
    if (child.exitCode !== null || sampling) return;
    sampling = (async () => {
      try {
        const usage = await processTreeUsage(child.pid, knownPids);
        peakProcesses = Math.max(peakProcesses, usage.processes);
        if (limit) return;
        if (usage.processes > (limits.processCount ?? APP_GUI_BUILD_BUDGET.processCount)) limit = "process";
        else if (usage.cpuMs > (limits.cpuTimeMs ?? APP_GUI_BUILD_BUDGET.cpuTimeMs)) limit = "cpu";
        else if (usage.rss > (limits.rssBytes ?? APP_GUI_BUILD_BUDGET.rssBytes)) limit = "rss";
      } catch {
        if (!limit && child.exitCode === null) limit = "custody";
      }
      if (limit) await terminateTree(child, knownPids);
    })().finally(() => { sampling = null; });
    await sampling;
  }, SAMPLE_INTERVAL_MS);
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  }).finally(() => {
    clearTimeout(wallTimer);
    clearInterval(resourceTimer);
    signal?.removeEventListener("abort", abort);
  });
  if (sampling) await sampling;
  await ensureProcessTreeExit(child.pid, knownPids);
  return { exitCode, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), limit, peakProcesses };
}

export async function terminateTree(child: ChildProcess, knownPids: Set<number>) {
  if (!child.pid) return;
  killGroup(child);
  const survivors = await liveDescendants(child.pid, knownPids).catch(() => new Set<number>());
  for (const pid of survivors) {
    if (pid === child.pid) continue;
    try { process.kill(pid, "SIGKILL"); } catch { /* Already exited. */ }
  }
}

export function killGroup(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export async function processTreeUsage(pid: number | undefined, knownPids = new Set<number>()) {
  const tree = await processTree(pid, knownPids);
  return {
    /* 每个进程的 RSS 都把共享页算了一遍，求和于是把 fork 出来的 esbuild/tsc
       重复计费。预算问的是「有没有一个进程失控」，答案是单进程最大值。 */
    rss: tree.reduce((peak, row) => Math.max(peak, row.rss), 0),
    cpuMs: tree.reduce((sum, row) => sum + row.cpuMs, 0),
    processes: tree.length,
  };
}

export async function liveDescendants(pid: number, knownPids: Set<number>) {
  return new Set((await processTree(pid, knownPids)).map((row) => row.pid));
}

export async function processTree(pid: number | undefined, knownPids: Set<number>) {
  if (!pid) throw unavailable("compiler process identity is unavailable");
  const result = await new Promise<string>((resolveOutput, reject) => {
    const ps = spawn("/bin/ps", ["-a", "-x", "-o", "pid=", "-o", "ppid=", "-o", "pgid=", "-o", "rss=", "-o", "time="], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let error = "";
    ps.stdout.on("data", (chunk) => { output += chunk.toString(); });
    ps.stderr.on("data", (chunk) => { error += chunk.toString(); });
    ps.once("exit", (code) => code === 0 ? resolveOutput(output) : reject(new Error(error || `ps exited ${code}`)));
    ps.once("error", reject);
  });
  const rows = result.trim().split("\n").filter(Boolean).map((line) => {
    const columns = line.trim().split(/\s+/);
    return {
      pid: Number(columns[0]),
      ppid: Number(columns[1]),
      pgid: Number(columns[2]),
      rss: (Number(columns[3]) || 0) * 1024,
      cpuMs: parseCpuTime(columns.at(-1) ?? "0"),
    };
  });
  const owned = new Set<number>([pid, ...knownPids]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if ((row.pgid === pid || owned.has(row.ppid)) && !owned.has(row.pid)) {
        owned.add(row.pid);
        changed = true;
      }
    }
  }
  const tree = rows.filter((row) => owned.has(row.pid));
  tree.forEach((row) => knownPids.add(row.pid));
  return tree;
}

export async function ensureProcessTreeExit(pid: number | undefined, knownPids: ReadonlySet<number>) {
  if (!pid) return;
  try { process.kill(-pid, "SIGKILL"); } catch { /* The group already exited. */ }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const survivors = await liveDescendants(pid, new Set(knownPids));
    if (survivors.size === 0) return;
    for (const processId of survivors) {
      try { process.kill(processId, "SIGKILL"); } catch { /* Already exited. */ }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw unavailable("compiler process tree did not terminate as one custody unit");
}

export function parseCpuTime(value: string) {
  const dayParts = value.split("-");
  const clock = dayParts.at(-1)!.split(":").map(Number);
  const seconds = clock.reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0);
  return ((dayParts.length > 1 ? Number(dayParts[0]) * 86_400 : 0) + seconds) * 1_000;
}

export function unavailable(message: string) {
  return Object.assign(new Error(message), { code: "GUI_COMPILER_SANDBOX_UNAVAILABLE" });
}
