/**
 * [INPUT]: Depends on Node child_process/fs/path and process-group to coordinate the supervised process group with the repair-supervisor entry on the bundled Node (TASK-35 C8), handshake/go/result file
 * [OUTPUT]: Provides runSupervised/harvestProcess; harvestProcess resolves a recovered process's status (missing/mismatch/killed) by PGID, guarding against PID reuse
 * [POS]: install/repair's process-supervision boundary; the supervisor and its command share one process group (PGID) so the command can still be harvested even after the main process crashes
 */

import { execFile, spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { stopProcessGroup, wait } from "../../../agent/process/process-group";
import { bundledEntry } from "../../../runtime";

export type ActiveRepairProcess = {
  intent: string;
  nonce: string;
  pgid: number;
  pid: number;
  processStartedAt: string;
};

export type SupervisedOptions = {
  intent: string;
  nonce: string;
  directory: string;
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  signal?: AbortSignal;
  allowFailure?: boolean;
  onRegistered: (process: ActiveRepairProcess) => Promise<void>;
  onFinished: (nonce: string) => Promise<void>;
};

type RunSupervisedDependencies = {
  /** The supervisor program: the product's is the bundled Node on the repair-supervisor entry (TASK-35 C8). */
  supervisor: () => { command: string; args: readonly string[] };
  stopGroup: (pgid: number) => Promise<void>;
};

export class SupervisedCommandExitError extends Error {
  constructor(
    readonly result: { code: number; stdout: string; stderr: string }
  ) {
    const detail = result.stderr || result.stdout;
    super(`受监督命令退出 code=${result.code}：${detail.slice(-1_000)}`);
    this.name = "SupervisedCommandExitError";
  }
}

export class SupervisedInfrastructureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SupervisedInfrastructureError";
  }
}

/* The supervisor needs only `ps` and the files it is handed; the command's own environment travels in the command file (TASK-35 E2). */
const SUPERVISOR_ENV = { PATH: "/usr/bin:/bin" };
/* `ps lstart` is rendered in the reader's locale and time zone; the entry and recovery both read it in this one, or a main started
   with TZ set never recognises its own supervisor again. */
const PS_ENV = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };

type SupervisorChildState = {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  error: Error | null;
};

async function readPublished<T>(path: string): Promise<T | null> {
  return readFile(path, "utf8")
    .then((value) => JSON.parse(value) as T)
    .catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return null;
      throw cause;
    });
}

async function waitForPublished<T>(input: {
  path: string;
  child: SupervisorChildState;
  signal?: AbortSignal;
  deadline?: number;
}): Promise<T> {
  while (!input.deadline || Date.now() < input.deadline) {
    const published = await readPublished<T>(input.path);
    if (published) return published;
    if (input.signal?.aborted) throw input.signal.reason;
    if (input.child.error) throw input.child.error;
    if (input.child.exitCode !== null || input.child.signalCode !== null) {
      throw new Error("监督进程在发布状态前退出");
    }
    await wait(25);
  }
  throw new Error("监督进程发布状态超时");
}

const defaultRunDependencies: RunSupervisedDependencies = {
  supervisor: () => bundledEntry("repair-supervisor"),
  stopGroup: stopProcessGroup,
};

export async function runSupervised(
  options: SupervisedOptions,
  dependencies: RunSupervisedDependencies = defaultRunDependencies
) {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const base = join(options.directory, options.nonce.replaceAll("/", "_"));
  const paths = {
    command: `${base}.command.json`,
    handshake: `${base}.handshake.json`,
    go: `${base}.go`,
    result: `${base}.result.json`,
    resultTemporary: `${base}.result.json.tmp`,
    handshakeTemporary: `${base}.handshake.json.tmp`,
    stdout: `${base}.stdout`,
    stderr: `${base}.stderr`,
  };
  await writeFile(
    paths.command,
    JSON.stringify({
      executable: options.executable,
      args: options.args,
      cwd: options.cwd,
      env: options.env,
      stdin: options.stdin ?? "",
      stdoutPath: paths.stdout,
      stderrPath: paths.stderr,
    }),
    { mode: 0o600 }
  );
  const supervisor = dependencies.supervisor();
  const child = spawn(
    supervisor.command,
    [
      ...supervisor.args,
      "--nonce",
      options.nonce,
      "--command",
      paths.command,
      "--handshake",
      paths.handshake,
      "--go",
      paths.go,
      "--result",
      paths.result,
    ],
    {
      detached: true,
      stdio: "ignore",
      env: SUPERVISOR_ENV,
    }
  );
  const childState: SupervisorChildState = {
    exitCode: null,
    signalCode: null,
    error: null,
  };
  child.once("error", (error) => { childState.error = error; });
  const childClosed = new Promise<void>((resolve) => {
    child.once("close", (code, signal) => {
      childState.exitCode = code;
      childState.signalCode = signal;
      resolve();
    });
  });
  const cleanup = async () => {
    await Promise.allSettled(Object.values(paths).map((path) => rm(path, { force: true })));
  };
  let groupSettled = false;
  let abortCleanup: Promise<void> | null = null;
  const onAbort = () => {
    if (!child.pid || abortCleanup) return;
    // 立即接管 rejection；后续路径等待本次尝试后再决定是否串行重试。
    abortCleanup = dependencies.stopGroup(child.pid).then(
      () => { groupSettled = true; },
      () => {}
    );
  };
  const settleGroup = async (pgid: number) => {
    await abortCleanup;
    if (groupSettled) return;
    await dependencies.stopGroup(pgid);
    groupSettled = true;
  };
  try {
    const active = await waitForPublished<ActiveRepairProcess>({
      path: paths.handshake,
      child: childState,
      signal: options.signal,
      deadline: Date.now() + 30_000,
    });
    await options.onRegistered({ ...active, intent: options.intent });
    if (options.signal?.aborted) throw options.signal.reason;
    await writeFile(paths.go, "go", { mode: 0o600 });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const outcome = await waitForPublished<{ code: number; signal: string | null }>({
      path: paths.result,
      child: childState,
      signal: options.signal,
    });
    options.signal?.removeEventListener("abort", onAbort);
    // supervisor 已发布命令结果但保持存活；身份与后台后代一并收割。
    await settleGroup(active.pgid);
    await childClosed;
    const [stdout, stderr] = await Promise.all([
      readFile(paths.stdout, "utf8").catch(() => ""),
      readFile(paths.stderr, "utf8").catch(() => ""),
    ]);
    await options.onFinished(options.nonce);
    if (options.signal?.aborted) throw options.signal.reason;
    if (outcome.code !== 0 && !options.allowFailure) {
      throw new SupervisedCommandExitError({ code: outcome.code, stdout, stderr });
    }
    return { code: outcome.code, stdout, stderr };
  } catch (cause) {
    try {
      if (child.pid) await settleGroup(child.pid);
    } catch (cleanupCause) {
      throw new SupervisedInfrastructureError(
        "受监督命令失败且进程组清理状态未知",
        { cause: cleanupCause }
      );
    }
    if (cause instanceof SupervisedCommandExitError) throw cause;
    throw new SupervisedInfrastructureError("受监督命令基础设施失败", { cause });
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    await cleanup();
  }
}

function ps(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile("/bin/ps", args, { encoding: "utf8", env: PS_ENV }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

async function processIdentityMatches(process: ActiveRepairProcess) {
  try {
    const [startedAt, command] = await Promise.all([
      ps(["-o", "lstart=", "-p", String(process.pid)]),
      ps(["-o", "command=", "-p", String(process.pid)]),
    ]);
    return startedAt === process.processStartedAt && command.includes(process.nonce);
  } catch {
    return false;
  }
}

type HarvestDependencies = {
  groupExists: (pgid: number) => boolean;
  identityMatches: (active: ActiveRepairProcess) => Promise<boolean>;
  stopGroup: (pgid: number) => Promise<void>;
};

const defaultHarvestDependencies: HarvestDependencies = {
  groupExists: (pgid) => {
    try {
      globalThis.process.kill(-pgid, 0);
      return true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw cause;
    }
  },
  identityMatches: processIdentityMatches,
  stopGroup: stopProcessGroup,
};

export async function harvestProcess(
  active: ActiveRepairProcess,
  dependencies: HarvestDependencies = defaultHarvestDependencies
) {
  if (!dependencies.groupExists(active.pgid)) return "missing" as const;
  if (!(await dependencies.identityMatches(active))) return "mismatch" as const;
  await dependencies.stopGroup(active.pgid);
  return "killed" as const;
}
