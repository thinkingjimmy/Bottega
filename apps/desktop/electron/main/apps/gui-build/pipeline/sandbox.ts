/**
 * [INPUT]: Depends on an exact hashed Node/Electron-as-Node runtime, packaged compiler child, explicit release-metadata root, OS-native sandbox executables, fixed build budgets, and private source/output/temp roots
 * [OUTPUT]: Provides fail-closed macOS Seatbelt, Linux bubblewrap, and Windows native-wrapper compiler adapters with executable authority, a live out-of-sandbox loopback control, RSS, CPU, timeout, and process-tree probes, plus payload-identity-cached evidence
 * [POS]: apps/gui-build/pipeline OS authority boundary; no compiled App transform may invoke the compiler child without this supervisor
 */

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import type { ChildProcess } from "node:child_process";
import type { CompilerOutcome, CompilerSandboxEvidence, CompilerSandboxPort, SealedCompilerInput } from "../contracts";
import { APP_GUI_BUILD_BUDGET } from "../contracts";
import { canonicalDigest } from "../metadata";

type SandboxPlatform = CompilerSandboxPort["platform"];

export type CompilerSandboxOptions = Readonly<{
  compilerEntry: string;
  dependencyRoots: readonly string[];
  esbuildExecutable?: string;
  metadataRoot?: string;
  linuxBubblewrap?: string;
  windowsWrapper?: string;
  nodeExecutable?: string;
  platform?: SandboxPlatform;
}>;

type Launch = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
}>;

type ChildEnvelope =
  | Readonly<{ ok: true; outcome: CompilerOutcome }>
  | Readonly<{ ok: false; findings?: CompilerOutcome extends never ? never : readonly unknown[]; error: string }>;

type SupervisionLimit =
  | "wall" | "cpu" | "rss" | "process" | "custody"
  | "stdout" | "stderr" | "aborted" | null;
type SupervisionResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  limit: SupervisionLimit;
}>;

const NEGATIVE_PROBES = [
  "read-outside",
  "write-outside",
  "network-internet",
  "network-loopback",
  "network-dns",
  "environment-secret",
  "process-spawn",
] as const;
const REQUIRED_PROBES = [...NEGATIVE_PROBES, "process-tree-custody", "rss-budget", "cpu-budget", "timeout-budget"] as const;

export class NativeCompilerSandbox implements CompilerSandboxPort {
  readonly platform: SandboxPlatform;
  private evidence: CompilerSandboxEvidence | null = null;
  private evidenceIdentity: string | null = null;
  private readonly options: Required<Pick<CompilerSandboxOptions, "compilerEntry" | "dependencyRoots">> & CompilerSandboxOptions;

  constructor(options: CompilerSandboxOptions) {
    const platform = options.platform ?? normalizePlatform(process.platform);
    this.platform = platform;
    this.options = {
      ...options,
      platform,
      compilerEntry: resolve(options.compilerEntry),
      dependencyRoots: options.dependencyRoots.map((path) => resolve(path)),
      nodeExecutable: resolve(options.nodeExecutable ?? process.execPath),
      linuxBubblewrap: resolve(options.linuxBubblewrap ?? "/usr/bin/bwrap"),
      windowsWrapper: resolve(options.windowsWrapper ?? join(dirname(process.execPath), "bottega-compiler-sandbox.exe")),
    };
  }

  /* 探针要跑满五类否定证据，成本 2-5 秒。载荷身份（路径 + size + mtimeMs）不变
     即字节不变，证据也不变；每次 prepare 重跑一遍只是在给每次构建加税。 */
  async probe(): Promise<CompilerSandboxEvidence> {
    const identity = await this.payloadIdentity();
    if (this.evidence && this.evidenceIdentity === identity) return this.evidence;
    this.evidence = null;
    const evidence = await this.runProbes();
    this.evidence = evidence;
    this.evidenceIdentity = identity;
    return evidence;
  }

  private async payloadIdentity() {
    const paths = dedupe([
      this.options.nodeExecutable!,
      this.options.compilerEntry,
      ...this.options.dependencyRoots,
      ...(this.options.esbuildExecutable ? [this.options.esbuildExecutable] : []),
    ]);
    const stamps = await Promise.all(paths.map(async (path) => {
      const info = await stat(path).catch(() => null);
      return info ? `${path}:${info.size}:${info.mtimeMs}` : `${path}:missing`;
    }));
    return stamps.join("\n");
  }

  private async runProbes(): Promise<CompilerSandboxEvidence> {
    await this.assertPayload();
    const requestedProbeRoot = join(tmpdir(), `bottega-gui-probe-${randomUUID()}`);
    const requestedInputRoot = join(requestedProbeRoot, "input");
    const requestedOutputRoot = join(requestedProbeRoot, "output");
    const requestedTempRoot = join(requestedProbeRoot, "temp");
    const requestedForbiddenRoot = join(requestedProbeRoot, "forbidden");
    await Promise.all([
      mkdir(requestedInputRoot, { recursive: true, mode: 0o700 }),
      mkdir(requestedOutputRoot, { recursive: true, mode: 0o700 }),
      mkdir(requestedTempRoot, { recursive: true, mode: 0o700 }),
      mkdir(requestedForbiddenRoot, { recursive: true, mode: 0o700 }),
    ]);
    const [probeRoot, inputRoot, outputRoot, tempRoot, forbiddenRoot] = await Promise.all([
      realpath(requestedProbeRoot),
      realpath(requestedInputRoot),
      realpath(requestedOutputRoot),
      realpath(requestedTempRoot),
      realpath(requestedForbiddenRoot),
    ]);
    const forbiddenRead = join(forbiddenRoot, "secret.txt");
    const forbiddenWrite = join(forbiddenRoot, "write.txt");
    await writeFile(forbiddenRead, "sandbox-secret", { mode: 0o600 });
    /* 回环探针必须有正对照：连一个没人监听的端口，ECONNREFUSED 什么也证明不了。
       监听器活在沙箱外，子进程连上即证明围栏漏了，连不上才是真的隔离证据。 */
    const loopback = await openLoopbackControl();
    try {
      const request = Buffer.from(JSON.stringify({
        mode: "probe",
        forbiddenRead,
        forbiddenWrite,
        loopbackPort: loopback.port,
        spawnExecutable: platformProbeExecutable(this.platform),
      })).toString("base64url");
      const launched = await this.launch({
        mode: "probe",
        request,
        snapshotRoot: inputRoot,
        outputRoot,
        tempRoot,
      });
      const result = await supervise(launched, undefined, APP_GUI_BUILD_BUDGET.wallTimeMs);
      if (result.exitCode !== 0) throw unavailable(`compiler sandbox probe exited ${result.exitCode}: ${result.stderr}`);
      const parsed = parseJson<{ probes: readonly { id: string; denied: boolean }[] }>(result.stdout, "sandbox probe");
      const byId = new Map(parsed.probes.map((probe) => [probe.id, probe.denied]));
      if (!NEGATIVE_PROBES.every((id) => byId.get(id) === true)) {
        throw unavailable("compiler sandbox negative probe did not deny every required authority");
      }
      const custodyRequest = Buffer.from(JSON.stringify({
        mode: "custody-probe",
        processCount: APP_GUI_BUILD_BUDGET.processCount,
      })).toString("base64url");
      const custodyLaunch = await this.launch({
        mode: "probe",
        request: custodyRequest,
        snapshotRoot: inputRoot,
        outputRoot,
        tempRoot,
      });
      const custody = await supervise(custodyLaunch, undefined, 2_000);
      const wrapperContained = custody.exitCode === 0 &&
        parseJson<{ contained?: boolean }>(custody.stdout, "process custody probe").contained === true;
      if (custody.limit !== "process" && !wrapperContained) {
        throw unavailable("compiler sandbox did not contain its recursive process tree");
      }
      for (const probe of [
        { kind: "rss", expected: "rss", wallTimeMs: 3_000, limits: { rssBytes: 256 * 1024 * 1024, cpuTimeMs: 5_000 } },
        { kind: "cpu", expected: "cpu", wallTimeMs: 3_000, limits: { rssBytes: APP_GUI_BUILD_BUDGET.rssBytes, cpuTimeMs: 500 } },
        { kind: "timeout", expected: "wall", wallTimeMs: 250, limits: {} },
      ] as const) {
        const resourceRequest = Buffer.from(JSON.stringify({
          mode: "resource-probe",
          kind: probe.kind,
        })).toString("base64url");
        const resourceLaunch = await this.launch({
          mode: "probe",
          request: resourceRequest,
          snapshotRoot: inputRoot,
          outputRoot,
          tempRoot,
        });
        const resource = await supervise(resourceLaunch, undefined, probe.wallTimeMs, probe.limits);
        if (resource.limit !== probe.expected) {
          throw unavailable(
            `compiler sandbox ${probe.kind} probe expected ${probe.expected} but observed ${resource.limit ?? `exit-${resource.exitCode}`}: ${bounded(resource.stderr)}`
          );
        }
      }
      const probes = REQUIRED_PROBES.map((id) => ({ id, denied: true as const }));
      return {
        supported: true,
        platform: this.platform,
        evidenceDigest: canonicalDigest({
          schema: "bottega.compiler-sandbox-evidence/v1",
          platform: this.platform,
          compilerEntryDigest: await fileDigest(this.options.compilerEntry),
          adapter: adapterIdentity(this.options),
          probes,
        }),
        probes,
      };
    } finally {
      await loopback.close();
      await rm(probeRoot, { recursive: true, force: true });
    }
  }

  async compile(input: SealedCompilerInput, signal: AbortSignal): Promise<CompilerOutcome> {
    if (!this.evidence) await this.probe();
    const snapshotRoot = await realpath(input.snapshotRoot);
    const outputRoot = await prepareEmptyRoot(input.outputRoot);
    const tempRoot = await prepareEmptyRoot(input.tempRoot);
    assertSeparated(snapshotRoot, outputRoot, tempRoot);
    const request = Buffer.from(JSON.stringify({ mode: "compile", input: { ...input, snapshotRoot, outputRoot, tempRoot } })).toString("base64url");
    const launched = await this.launch({ mode: "compile", request, snapshotRoot, outputRoot, tempRoot });
    try {
      const result = await supervise(launched, signal, APP_GUI_BUILD_BUDGET.wallTimeMs);
      if (result.limit === "aborted") return failed("GUI_BUILD_ABORTED", "App GUI compilation was aborted");
      if (result.limit === "wall") return failed("GUI_BUILD_TIMEOUT", "App GUI compilation exceeded the wall-time budget");
      if (result.limit === "cpu") return failed("GUI_BUILD_TIMEOUT", "App GUI compilation exceeded the CPU-time budget");
      if (result.limit === "rss") return failed("GUI_BUILD_MEMORY_LIMIT", "App GUI compilation exceeded the RSS budget");
      if (result.limit === "process") return failed("GUI_COMPILER_SANDBOX_VIOLATION", "App GUI compilation exceeded the process-tree budget");
      if (result.limit === "custody") return failed("GUI_COMPILER_SANDBOX_VIOLATION", "App GUI compiler resource custody could not be verified");
      if (result.limit === "stdout" || result.limit === "stderr") return failed("GUI_BUILD_OUTPUT_LIMIT", "App GUI compiler diagnostics exceeded a fixed budget");
      if (result.exitCode !== 0) return failed("GUI_BUILD_COMPILER_CRASH", bounded(result.stderr || `compiler exited ${result.exitCode}`));
      const envelope = parseJson<ChildEnvelope>(result.stdout, "compiler child");
      if (!envelope.ok) return failed("GUI_BUILD_COMPILER_CRASH", bounded(envelope.error));
      return envelope.outcome;
    } catch (cause) {
      if ((cause as { code?: string })?.code === "GUI_COMPILER_SANDBOX_UNAVAILABLE") {
        return failed("GUI_COMPILER_SANDBOX_VIOLATION", "App GUI compiler custody could not be verified");
      }
      return failed("GUI_BUILD_COMPILER_CRASH", bounded(cause instanceof Error ? cause.message : String(cause)));
    }
  }

  private async assertPayload() {
    /* 平台围栏可执行文件与 payload 走同一个 typed catch：缺 bwrap/wrapper 必须是
       GUI_COMPILER_SANDBOX_UNAVAILABLE——probe() 在 compile() 的 try 之外，
       裸 ENOENT 会未经分类直接逃逸，击穿 composition 层的 fail-closed 合同。 */
    const platformAdapter = this.platform === "darwin"
      ? "/usr/bin/sandbox-exec"
      : this.platform === "linux"
        ? this.options.linuxBubblewrap!
        : this.options.windowsWrapper!;
    await Promise.all([
      assertExecutable(this.options.nodeExecutable!),
      assertExecutable(platformAdapter),
      access(this.options.compilerEntry, constants.R_OK),
      ...this.options.dependencyRoots.map((root) => access(root, constants.R_OK)),
    ]).catch((cause) => {
      throw unavailable(`compiler payload is incomplete: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  }

  private async launch(input: Readonly<{
    mode: "probe" | "compile";
    request: string;
    snapshotRoot: string;
    outputRoot: string;
    tempRoot: string;
  }>): Promise<Launch> {
    const env = {
      ...explicitEnvironment(input.tempRoot),
      ...(this.options.esbuildExecutable
        ? { ESBUILD_BINARY_PATH: this.options.esbuildExecutable }
        : {}),
      ...(this.options.metadataRoot
        ? { BOTTEGA_APP_GUI_METADATA_ROOT: this.options.metadataRoot }
        : {}),
    };
    const childArgs = [this.options.compilerEntry, input.request];
    if (this.platform === "darwin") {
      const profile = await darwinProfile({
        nodeExecutable: this.options.nodeExecutable!,
        compilerEntry: this.options.compilerEntry,
        dependencyRoots: this.options.dependencyRoots,
        esbuildExecutable: this.options.esbuildExecutable,
        snapshotRoot: input.snapshotRoot,
        outputRoot: input.outputRoot,
        tempRoot: input.tempRoot,
      });
      return { command: "/usr/bin/sandbox-exec", args: ["-p", profile, this.options.nodeExecutable!, ...childArgs], cwd: input.tempRoot, env };
    }
    if (this.platform === "linux") {
      const readRoots = [this.options.nodeExecutable!, this.options.compilerEntry, ...this.options.dependencyRoots, ...(this.options.esbuildExecutable ? [this.options.esbuildExecutable] : [])];
      const args = ["--die-with-parent", "--new-session", "--unshare-all", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"];
      for (const path of dedupe(readRoots)) args.push("--ro-bind", path, path);
      for (const path of ["/usr/lib", "/usr/lib64", "/lib", "/lib64"]) {
        if (await exists(path)) args.push("--ro-bind", path, path);
      }
      args.push("--ro-bind", input.snapshotRoot, input.snapshotRoot, "--bind", input.outputRoot, input.outputRoot, "--bind", input.tempRoot, input.tempRoot, "--chdir", input.tempRoot, "--", this.options.nodeExecutable!, ...childArgs);
      return { command: this.options.linuxBubblewrap!, args, cwd: input.tempRoot, env };
    }
    const policy = Buffer.from(JSON.stringify({
      schema: "bottega.compiler-windows-policy/v1",
      readOnly: [input.snapshotRoot, this.options.compilerEntry, ...this.options.dependencyRoots],
      writable: [input.outputRoot, input.tempRoot],
      executable: [this.options.nodeExecutable, this.options.esbuildExecutable].filter(Boolean),
      network: "deny",
      job: { childProcesses: APP_GUI_BUILD_BUDGET.processCount, memoryBytes: APP_GUI_BUILD_BUDGET.rssBytes, cpuTimeMs: APP_GUI_BUILD_BUDGET.cpuTimeMs },
      limitExitCodes: { rss: 197, cpu: 198, process: 199 },
      command: [this.options.nodeExecutable, ...childArgs],
    })).toString("base64url");
    return { command: this.options.windowsWrapper!, args: [policy], cwd: input.tempRoot, env };
  }
}

export function createCompilerSandbox(options: CompilerSandboxOptions): CompilerSandboxPort {
  return new NativeCompilerSandbox(options);
}

async function darwinProfile(input: Readonly<{
  nodeExecutable: string;
  compilerEntry: string;
  dependencyRoots: readonly string[];
  esbuildExecutable?: string;
  snapshotRoot: string;
  outputRoot: string;
  tempRoot: string;
}>) {
  const readRoots = dedupe([
    input.nodeExecutable,
    input.compilerEntry,
    ...input.dependencyRoots,
    ...(input.esbuildExecutable ? [input.esbuildExecutable] : []),
    "/Library",
    "/System",
    "/bin",
    "/private/etc",
    "/usr/lib",
    "/private/var/db/dyld",
    "/private/var/run",
    "/sbin",
    "/usr",
    input.snapshotRoot,
    input.outputRoot,
    input.tempRoot,
  ]);
  const executable = dedupe([
    input.nodeExecutable,
    ...(input.esbuildExecutable ? [input.esbuildExecutable] : []),
  ]);
  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(deny network*)",
    "(deny process-exec)",
    "(deny process-info*)",
    "(allow process-info* (target self))",
    "(allow signal (target self))",
    "(allow file-read-metadata)",
    ...readRoots.map((path) => `(allow file-read* (subpath ${sbpl(path)}))`),
    ...readRoots.map((path) => `(allow file-map-executable (subpath ${sbpl(path)}))`),
    ...["/", "/dev/null", "/dev/random", "/dev/urandom", "/dev/zero"].map((path) => `(allow file-read* (literal ${sbpl(path)}))`),
    ...ancestors([...readRoots, input.outputRoot, input.tempRoot]).map((path) => `(allow file-read-metadata (literal ${sbpl(path)}))`),
    `(allow file-write* (subpath ${sbpl(input.outputRoot)}) (subpath ${sbpl(input.tempRoot)}) (literal ${sbpl("/dev/null")}))`,
    "(allow process-fork)",
    ...executable.map((path) => `(allow process-exec (literal ${sbpl(path)}))`),
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix*)",
  ].join("\n");
}

async function supervise(
  launch: Launch,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  limits: Readonly<{ rssBytes?: number; cpuTimeMs?: number; processCount?: number }> = {}
): Promise<SupervisionResult> {
  const child = spawn(launch.command, [...launch.args], {
    cwd: launch.cwd,
    env: { ...launch.env },
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let limit: SupervisionLimit = null;
  let sampling: Promise<void> | null = null;
  const knownPids = new Set<number>(child.pid ? [child.pid] : []);
  const collect = (current: Buffer, chunk: Buffer, maximum: number, name: "stdout" | "stderr") => {
    const next = Buffer.concat([current, chunk]);
    if (next.byteLength > maximum && !limit) {
      limit = name;
      terminateTree(child, knownPids);
    }
    return next.subarray(0, maximum);
  };
  child.stdout.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk, APP_GUI_BUILD_BUDGET.stdoutBytes, "stdout"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk, APP_GUI_BUILD_BUDGET.stderrBytes, "stderr"); });
  const abort = () => { if (!limit) limit = "aborted"; terminateTree(child, knownPids); };
  signal?.addEventListener("abort", abort, { once: true });
  const wallTimer = setTimeout(() => { if (!limit) limit = "wall"; terminateTree(child, knownPids); }, timeoutMs);
  const resourceTimer = setInterval(async () => {
    if (process.platform === "win32" || child.exitCode !== null || sampling) return;
    sampling = (async () => {
      try {
        const usage = await processTreeUsage(child.pid, knownPids);
        if (limit) return;
        if (usage.processes > (limits.processCount ?? APP_GUI_BUILD_BUDGET.processCount)) limit = "process";
        else if (usage.cpuMs > (limits.cpuTimeMs ?? APP_GUI_BUILD_BUDGET.cpuTimeMs)) limit = "cpu";
        else if (usage.rss > (limits.rssBytes ?? APP_GUI_BUILD_BUDGET.rssBytes)) limit = "rss";
      } catch {
        if (!limit && child.exitCode === null) limit = "custody";
      }
      if (limit) terminateTree(child, knownPids);
    })().finally(() => { sampling = null; });
    await sampling;
  }, 100);
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  }).finally(() => {
    clearTimeout(wallTimer);
    clearInterval(resourceTimer);
    signal?.removeEventListener("abort", abort);
  });
  if (sampling) await sampling;
  if (process.platform === "win32" && !limit) {
    if (exitCode === 197) limit = "rss";
    else if (exitCode === 198) limit = "cpu";
    else if (exitCode === 199) limit = "process";
  }
  await ensureProcessTreeExit(child.pid, knownPids);
  return { exitCode, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), limit };
}

function terminateTree(child: ChildProcess, knownPids: ReadonlySet<number>) {
  if (!child.pid) return;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  for (const pid of knownPids) {
    if (pid === child.pid) continue;
    try { process.kill(pid, "SIGKILL"); } catch { /* Already exited. */ }
  }
}

async function processTreeUsage(pid: number | undefined, knownPids = new Set<number>()) {
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
  return {
    rss: tree.reduce((sum, row) => sum + row.rss, 0),
    cpuMs: tree.reduce((sum, row) => sum + row.cpuMs, 0),
    processes: tree.length,
  };
}

async function ensureProcessTreeExit(pid: number | undefined, knownPids: ReadonlySet<number>) {
  if (!pid || process.platform === "win32") return;
  try { process.kill(-pid, "SIGKILL"); } catch { /* The group already exited. */ }
  for (const processId of knownPids) {
    try { process.kill(processId, "SIGKILL"); } catch { /* Already exited. */ }
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await processTreeUsage(pid, new Set(knownPids))).processes === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw unavailable("compiler process tree did not terminate as one custody unit");
}

function parseCpuTime(value: string) {
  const dayParts = value.split("-");
  const clock = dayParts.at(-1)!.split(":").map(Number);
  const seconds = clock.reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0);
  return ((dayParts.length > 1 ? Number(dayParts[0]) * 86_400 : 0) + seconds) * 1_000;
}

function explicitEnvironment(tempRoot: string): Record<string, string> {
  return {
    PATH: "",
    HOME: tempRoot,
    TMPDIR: tempRoot,
    TEMP: tempRoot,
    TMP: tempRoot,
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    NODE_ENV: "production",
    NO_COLOR: "1",
    UV_THREADPOOL_SIZE: "2",
    ELECTRON_RUN_AS_NODE: "1",
  };
}

async function prepareEmptyRoot(path: string) {
  const absolute = resolve(path);
  await rm(absolute, { recursive: true, force: true });
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  return realpath(absolute);
}

function assertSeparated(...paths: string[]) {
  const canonical = paths.map((path) => path.endsWith(sep) ? path : `${path}${sep}`);
  for (let index = 0; index < canonical.length; index += 1) {
    for (let other = index + 1; other < canonical.length; other += 1) {
      if (canonical[index]!.startsWith(canonical[other]!) || canonical[other]!.startsWith(canonical[index]!)) {
        throw unavailable("compiler source, output, and temp roots must not contain one another");
      }
    }
  }
}

function failed(code: "GUI_BUILD_ABORTED" | "GUI_BUILD_TIMEOUT" | "GUI_BUILD_MEMORY_LIMIT" | "GUI_BUILD_OUTPUT_LIMIT" | "GUI_BUILD_COMPILER_CRASH" | "GUI_COMPILER_SANDBOX_VIOLATION", message: string): CompilerOutcome {
  return { status: "failed", findings: [{ code, file: "gui/", message }] };
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw unavailable(`${label} returned invalid JSON`);
  }
}

function unavailable(message: string) {
  return Object.assign(new Error(message), { code: "GUI_COMPILER_SANDBOX_UNAVAILABLE" });
}

function normalizePlatform(platform: NodeJS.Platform): SandboxPlatform {
  if (platform === "darwin" || platform === "linux" || platform === "win32") return platform;
  throw unavailable(`compiled App GUI is unsupported on ${platform}`);
}

function adapterIdentity(options: CompilerSandboxOptions) {
  if (options.platform === "darwin") return "seatbelt-v1";
  if (options.platform === "linux") return "bubblewrap-v1";
  return "windows-job-appcontainer-v1";
}

function platformProbeExecutable(platform: SandboxPlatform) {
  if (platform === "win32") return "C:\\Windows\\System32\\cmd.exe";
  return "/usr/bin/true";
}

async function fileDigest(path: string) {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}` as const;
}

async function openLoopbackControl() {
  const server = createServer((connection) => connection.destroy());
  server.unref();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (typeof address === "string" || !address) throw unavailable("loopback probe control could not listen");
  return {
    port: address.port,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

async function assertExecutable(path: string) {
  await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
}

async function exists(path: string) {
  return access(path).then(() => true, () => false);
}

function dedupe(values: readonly string[]) {
  return [...new Set(values.map((path) => resolve(path)))];
}

function ancestors(paths: readonly string[]) {
  const values = new Set<string>();
  for (const input of paths) {
    let current = resolve(input);
    while (current !== dirname(current)) {
      current = dirname(current);
      values.add(current);
    }
  }
  return [...values].sort((left, right) => left.length - right.length);
}

function sbpl(value: string) {
  return JSON.stringify(value);
}

function bounded(value: string) {
  return value.trim().slice(0, APP_GUI_BUILD_BUDGET.findingMessageBytes) || "App GUI compiler failed";
}
