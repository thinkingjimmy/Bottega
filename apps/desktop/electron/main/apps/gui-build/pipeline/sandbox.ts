/**
 * [INPUT]: Depends on immutable compiler roots, the apps/support digest primitives, framed requests, actual probe budgets, admitted Linux component identities, kernel profile validation and native platform executables
 * [OUTPUT]: Provides fail-closed native compiler adapters, the loaded adapter module path for custody hashing, fresh system AppArmor probes, stable component leases, resource supervision and verified Windows v2 result binding TASK-35 C6: nodeExecutable is resolved on first use and reported as the compiler-node-runtime payload.; custodyVerdict and CUSTODY_PROBE_WALL_MS (a 10 s wall that bounds a slow start, not containment), with the supervisor reporting its peak process count
 * [POS]: apps/gui-build/pipeline OS authority boundary; no compiled App transform may invoke the compiler child without this supervisor
 */
import { type Launch, type SupervisionResult, supervise, unavailable } from "./process/supervision";


import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import type { CompilerOutcome, CompilerSandboxEvidence, CompilerSandboxPort, SealedCompilerInput } from "../contracts";
import { APP_GUI_BUILD_BUDGET } from "../contracts";
import { canonicalDigest, sha256 } from "../../support";
import { COMPILER_REQUEST_SCHEMA, encodeCompilerRequest, type CompilerRequest } from "../transport/request";
import { createWindowsCompilerPolicy, type CompilerLimits } from "../transport/windows-policy";

import type { LinuxSandboxIdentity } from "../native/linux/locator";
import { acquireLinuxComponentLease } from "../native/linux/lease";
import { linuxCompilerLaunch } from "../native/linux/launch";
import { admittedLinuxProfile } from "../native/linux/profile";
import { prepareExecutableControl } from "../native/probe-control";

type SandboxPlatform = CompilerSandboxPort["platform"];

/** Rollup binds this URL to the chunk containing the adapter, including inside an ASAR. */
export function sandboxAdapterEntryPath(): string {
  return fileURLToPath(import.meta.url);
}

type CompilerSandboxOptions = Readonly<{
  compilerEntry: string;
  dependencyRoots: readonly string[];
  esbuildExecutable?: string;
  metadataRoot?: string;
  linuxResolver?: (stableOnly?: boolean) => Promise<LinuxSandboxIdentity>;
  windowsWrapper?: string;
  /** The Node the compiler runs on; a resolver is called on first use (the bundled Node's verification is not a startup cost). */
  nodeExecutable: string | (() => string);
  platform?: SandboxPlatform;
}>;

type ChildEnvelope =
  | Readonly<{ ok: true; outcome: CompilerOutcome }>
  | Readonly<{ ok: false; error: string }>;

/**
 * The custody probe's wall. It bounds a slow start, not containment: a tree the sandbox fails to count never trips the process limit,
 * so it still ends on `wall` and still fails, only later. At 2 s a loaded machine (background QoS, several lanes) could not start the
 * probe's Node children before the wall, and a contained tree read as uncontained (09-29, packaged smoke and the loaded unit run).
 */
export const CUSTODY_PROBE_WALL_MS = 10_000;

/** Whether the custody probe's tree was contained, with the facts that decided it for the error the smoke reads. */
export function custodyVerdict(result: SupervisionResult, elapsedMs: number) {
  const wrapperContained = result.exitCode === 0 &&
    parseJson<{ contained?: boolean }>(result.stdout, "process custody probe").contained === true;
  return { contained: result.limit === "process" || wrapperContained,
    detail: `limit=${result.limit ?? "none"} children=${result.peakProcesses ?? 0} elapsed=${Math.round(elapsedMs)}ms` };
}

const NEGATIVE_PROBES = [
  "read-outside",
  "write-outside",
  "network-internet",
  "network-loopback",
  "network-dns",
  "environment-secret",
  "process-spawn",
  "process-spawn-readable",
] as const;
const PROBE_SECRET = "BOTTEGA_COMPILER_PROBE_SECRET";

export class NativeCompilerSandbox implements CompilerSandboxPort {
  readonly platform: SandboxPlatform;
  private evidence: CompilerSandboxEvidence | null = null;
  private evidenceIdentity: string | null = null;
  private preferStableLinux = false;
  private readonly options: Required<Pick<CompilerSandboxOptions, "compilerEntry" | "dependencyRoots">> & CompilerSandboxOptions;

  constructor(options: CompilerSandboxOptions) {
    const platform = options.platform ?? normalizePlatform(process.platform);
    this.platform = platform;
    this.options = {
      ...options,
      platform,
      compilerEntry: resolve(options.compilerEntry),
      dependencyRoots: options.dependencyRoots.map((path) => resolve(path)),
      windowsWrapper: resolve(options.windowsWrapper ?? join(dirname(process.execPath), "bottega-compiler-sandbox.exe")),
    };
  }
  private resolvedRuntime: { node: string; roots: string[] } | null = null;
  /** The Node and the read roots it needs, resolved once on first use (TASK-35: never at composition). */
  private get runtime() {
    if (!this.resolvedRuntime) {
      const option = this.options.nodeExecutable;
      const node = resolve(typeof option === "function" ? option() : option);
      this.resolvedRuntime = { node, roots: dedupe([...this.options.dependencyRoots, runtimeReadRoot(node)]) };
    }
    return this.resolvedRuntime;
  }


  /* 探针要跑满五类否定证据，成本 2-5 秒。载荷身份是每条 payload 路径自己的
     (size, mtimeMs)——依赖根取的是目录项的时间戳而不是子树内容，所以它是「有没有
     被换过」的身份检查，不是内容哈希；编译器入口的真实字节另有 fileDigest 进
     evidenceDigest。发布载荷在运行期不可变，身份不变即重跑探针只是加税。 */
  async probe(): Promise<CompilerSandboxEvidence> {
    try {
      const linux = await this.selectLinux();
      try { return await this.probeComponent(linux); }
      catch (cause) {
        if (linux?.source !== "system") throw cause;
        this.preferStableLinux = true;
        return await this.probeComponent(await this.selectLinux());
      }
    } catch (cause) {
      if ((cause as { code?: string })?.code === "GUI_COMPILER_SANDBOX_UNAVAILABLE") throw cause;
      throw unavailable(`Compiler authority probe failed: ${bounded(cause instanceof Error ? cause.message : String(cause))}`);
    }
  }

  private async probeComponent(linux?: LinuxSandboxIdentity): Promise<CompilerSandboxEvidence> {
    const lease = linux?.leasePath ? await acquireLinuxComponentLease(linux.leasePath) : undefined;
    try {
      await this.assertLinuxIdentity(linux);
      const identity = `${await this.payloadIdentity(linux)}\n${linux?.digest ?? ""}`;
      lease?.assertHeld();
      // System policy has no release-pinned file identity; recheck its actual kernel behavior.
      if (linux?.source !== "system" && this.evidence && this.evidenceIdentity === identity) return this.evidence;
      this.evidence = null;
      const evidence = await this.runProbes(linux);
      lease?.assertHeld();
      await this.assertLinuxIdentity(linux);
      this.evidence = evidence;
      this.evidenceIdentity = identity;
      return evidence;
    } finally { await lease?.release(); }
  }

  private async selectLinux() {
    if (this.platform !== "linux") return undefined;
    if (!this.options.linuxResolver) throw unavailable("compiler payload is incomplete: trusted Linux component locator is unavailable");
    return this.options.linuxResolver(this.preferStableLinux);
  }

  private async assertLinuxIdentity(expected?: LinuxSandboxIdentity) {
    if (expected && (await this.selectLinux())?.digest !== expected.digest) {
      throw unavailable("Linux compiler component changed during the operation");
    }
  }

  private async payloadIdentity(linux?: LinuxSandboxIdentity) {
    const paths = dedupe([
      this.runtime.node,
      this.options.compilerEntry,
      ...(linux ? [linux.executable, linux.execPolicy, ...(linux.profilePath ? [linux.profilePath] : [])] : []),
      ...(this.platform === "win32" ? [this.options.windowsWrapper!] : []),
      ...this.runtime.roots,
      ...(this.options.esbuildExecutable ? [this.options.esbuildExecutable] : []),
    ]);
    const stamps = await Promise.all(paths.map(async (path) => {
      const info = await stat(path).catch(() => null);
      return info ? `${path}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}` : `${path}:missing`;
    }));
    return stamps.join("\n");
  }

  private async runProbes(linux?: LinuxSandboxIdentity): Promise<CompilerSandboxEvidence> {
    await this.assertPayload(linux);
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
    /* 环境探针必须可证伪：supervisor 自己不持有秘密时，「子进程看不见它」
       是恒真句。探针期间把秘密种进本进程环境，explicitEnvironment 一旦退化成
       `...process.env`，子进程立刻看得见，探针随之翻红。 */
    const previousSecret = process.env[PROBE_SECRET];
    process.env[PROBE_SECRET] = randomUUID();
    try {
      const request: CompilerRequest = {
        schema: COMPILER_REQUEST_SCHEMA,
        mode: "probe",
        forbiddenRead,
        forbiddenWrite,
        loopbackPort: loopback.port,
        spawnExecutable: platformProbeExecutable(this.platform),
        readableExecutable: await prepareExecutableControl(platformProbeExecutable(this.platform), inputRoot),
      };
      const launched = await this.launch({
        mode: "probe",
        request,
        snapshotRoot: inputRoot,
        outputRoot,
        tempRoot,
      }, linux);
      const result = await supervise(launched, undefined, APP_GUI_BUILD_BUDGET.wallTimeMs);
      if (result.exitCode !== 0) throw unavailable(`compiler sandbox probe exited ${result.exitCode}: ${result.stderr}`);
      const parsed = parseJson<{ probes: readonly { id: string; denied: boolean }[]; linuxProfile?: string }>(result.stdout, "sandbox probe");
      const byId = new Map(parsed.probes.map((probe) => [probe.id, probe.denied]));
      const observed: Array<{ id: string; denied: boolean }> =
        NEGATIVE_PROBES.map((id) => ({ id: id as string, denied: byId.get(id) === true }));
      if (!observed.every((probe) => probe.denied)) {
        throw unavailable("compiler sandbox negative probe did not deny every required authority");
      }
      if (linux) {
        if (!admittedLinuxProfile(linux, parsed.linuxProfile)) {
          throw unavailable("Linux compiler did not enter its admitted AppArmor profile");
        }
        observed.push({ id: "linux-apparmor-profile", denied: true });
      }
      const custodyRequest: CompilerRequest = {
        schema: COMPILER_REQUEST_SCHEMA,
        mode: "custody-probe",
        processCount: APP_GUI_BUILD_BUDGET.processCount,
      };
      const custodyLaunch = await this.launch({
        mode: "probe",
        request: custodyRequest,
        limits: { wallTimeMs: CUSTODY_PROBE_WALL_MS },
        snapshotRoot: inputRoot,
        outputRoot,
        tempRoot,
      }, linux);
      const custodyStarted = performance.now();
      const custody = custodyVerdict(await supervise(custodyLaunch, undefined, CUSTODY_PROBE_WALL_MS), performance.now() - custodyStarted);
      if (!custody.contained) {
        throw unavailable(`compiler sandbox did not contain its recursive process tree (${custody.detail})`);
      }
      observed.push({ id: "process-tree-custody", denied: true });
      for (const probe of [
        { kind: "rss", expected: "rss", wallTimeMs: 3_000, limits: { rssBytes: 256 * 1024 * 1024, cpuTimeMs: 5_000 } },
        { kind: "cpu", expected: "cpu", wallTimeMs: 3_000, limits: { rssBytes: APP_GUI_BUILD_BUDGET.rssBytes, cpuTimeMs: 500 } },
        { kind: "timeout", expected: "wall", wallTimeMs: 250, limits: {} },
      ] as const) {
        const resourceRequest: CompilerRequest = {
          schema: COMPILER_REQUEST_SCHEMA,
          mode: "resource-probe",
          kind: probe.kind,
        };
        const resourceLaunch = await this.launch({
          mode: "probe",
          request: resourceRequest,
          limits: { ...probe.limits, wallTimeMs: probe.wallTimeMs },
          snapshotRoot: inputRoot,
          outputRoot,
          tempRoot,
        }, linux);
        const resource = await supervise(resourceLaunch, undefined, probe.wallTimeMs, probe.limits);
        if (resource.limit !== probe.expected) {
          throw unavailable(
            `compiler sandbox ${probe.kind} probe expected ${probe.expected} but observed ${resource.limit ?? `exit-${resource.exitCode}`}: ${bounded(resource.stderr)}`
          );
        }
        observed.push({ id: `${probe.kind}-budget`, denied: resource.limit === probe.expected });
      }
      /* 证据摘要必须覆盖真的看见了什么。从常量表生成一串 denied:true，等于把
         「我跑过探针」写成「探针通过了」。 */
      const probes = observed.map((probe) => Object.freeze({ ...probe }));
      return {
        supported: true,
        platform: this.platform,
        evidenceDigest: canonicalDigest({
          schema: "bottega.compiler-sandbox-evidence/v1",
          platform: this.platform,
          compilerEntryDigest: await fileDigest(this.options.compilerEntry),
          adapter: linux ?? await adapterIdentity(this.options, result.mechanism),
          probes,
          ...(linux ? { linuxAppArmorProfile: parsed.linuxProfile } : {}),
        }),
        probes,
        /* The Node the compiler runs on is part of the custody digest; it is resolved here, not when the service is composed. */
        nativePayloads: [{ id: "compiler-node-runtime", path: this.runtime.node }, ...(linux ? linux.nativePayloads : [])],
        ...(linux ? { componentDigest: linux.digest, linuxAppArmorProfile: parsed.linuxProfile } : {}),
      };
    } finally {
      if (previousSecret === undefined) delete process.env[PROBE_SECRET];
      else process.env[PROBE_SECRET] = previousSecret;
      await loopback.close();
      await rm(probeRoot, { recursive: true, force: true });
    }
  }

  async compile(input: SealedCompilerInput, signal: AbortSignal, expectedEvidenceDigest?: string): Promise<CompilerOutcome> {
    if (signal.aborted) return failed("GUI_BUILD_ABORTED", "App GUI compilation was aborted");
    const evidence = await this.probe();
    if (expectedEvidenceDigest && expectedEvidenceDigest !== evidence.evidenceDigest) {
      return failed("GUI_COMPILER_SANDBOX_VIOLATION", "Compiler authority changed after receipt preparation");
    }
    const snapshotRoot = await realpath(input.snapshotRoot);
    const outputRoot = await prepareEmptyRoot(input.outputRoot);
    const tempRoot = await prepareEmptyRoot(input.tempRoot);
    assertSeparated(snapshotRoot, outputRoot, tempRoot);
    const request: CompilerRequest = { schema: COMPILER_REQUEST_SCHEMA, mode: "compile", input: { ...input, snapshotRoot, outputRoot, tempRoot } };
    const linux = await this.selectLinux();
    if (linux && evidence.componentDigest !== linux.digest) throw unavailable("Linux compiler component changed after probing");
    const lease = linux?.leasePath ? await acquireLinuxComponentLease(linux.leasePath) : undefined;
    try {
      await this.assertLinuxIdentity(linux);
      lease?.assertHeld();
      const launched = await this.launch({ mode: "compile", request, snapshotRoot, outputRoot, tempRoot }, linux);
      const result = await supervise(launched, signal, APP_GUI_BUILD_BUDGET.wallTimeMs);
      lease?.assertHeld();
      await this.assertLinuxIdentity(linux);
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
    } finally { await lease?.release(); }
  }

  private async assertPayload(linux?: LinuxSandboxIdentity) {
    /* 平台围栏可执行文件与 payload 走同一个 typed catch：缺 bwrap/wrapper 必须是
       GUI_COMPILER_SANDBOX_UNAVAILABLE——probe() 在 compile() 的 try 之外，
       裸 ENOENT 会未经分类直接逃逸，击穿 composition 层的 fail-closed 合同。 */
    const platformAdapter = this.platform === "darwin"
      ? "/usr/bin/sandbox-exec"
      : this.platform === "linux"
        ? linux!.executable
        : this.options.windowsWrapper!;
    await Promise.all([
      assertExecutable(this.runtime.node),
      assertExecutable(platformAdapter),
      access(this.options.compilerEntry, constants.R_OK),
      /* 依赖根之一是 asar 内的 out/main。Electron 的 asar fs 对目录不支持 access
         （getFileInfo 只认文件，直接 ENOENT），stat 才认目录；打包态编译此前
         正是死在这里——首个打包态编译 smoke（2026-09-04）暴露的。 */
      ...this.runtime.roots.map((root) => assertDirectory(root)),
    ]).catch((cause) => {
      throw unavailable(`compiler payload is incomplete: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  }

  private async launch(input: Readonly<{
    mode: "probe" | "compile";
    request: CompilerRequest;
    limits?: CompilerLimits;
    snapshotRoot: string;
    outputRoot: string;
    tempRoot: string;
  }>, linux?: LinuxSandboxIdentity): Promise<Launch> {
    const env = {
      ...explicitEnvironment(input.tempRoot),
      ...(this.options.esbuildExecutable
        ? { ESBUILD_BINARY_PATH: this.options.esbuildExecutable }
        : {}),
      ...(this.options.metadataRoot
        ? { BOTTEGA_APP_GUI_METADATA_ROOT: this.options.metadataRoot }
        : {}),
    };
    const childArgs = compilerNodeArgs(this.options.compilerEntry);
    const stdin = encodeCompilerRequest(input.request);
    if (this.platform === "darwin") {
      const profile = await darwinProfile({
        nodeExecutable: this.runtime.node,
        compilerEntry: this.options.compilerEntry,
        dependencyRoots: this.runtime.roots,
        esbuildExecutable: this.options.esbuildExecutable,
        snapshotRoot: input.snapshotRoot,
        outputRoot: input.outputRoot,
        tempRoot: input.tempRoot,
      });
      return { command: "/usr/bin/sandbox-exec", args: ["-p", profile, this.runtime.node, ...childArgs], cwd: input.tempRoot, env, stdin };
    }
    if (this.platform === "linux") {
      if (!linux) throw unavailable("Linux compiler component was not admitted");
      const launch = await linuxCompilerLaunch(linux, { ...input, ...this.options, dependencyRoots: this.runtime.roots, nodeExecutable: this.runtime.node, stdin });
      return { ...launch, cwd: input.tempRoot, env };
    }
    const windowsPolicy = createWindowsCompilerPolicy({
      readOnly: [input.snapshotRoot, this.options.compilerEntry, ...this.runtime.roots],
      writable: [input.outputRoot, input.tempRoot],
      executable: [this.runtime.node, ...(this.options.esbuildExecutable ? [this.options.esbuildExecutable] : [])],
      nodeExecutable: this.runtime.node, compilerEntry: this.options.compilerEntry,
      request: input.request, limits: input.limits,
    });
    return { command: this.options.windowsWrapper!, args: ["--stdio-v2"], cwd: input.tempRoot, env, stdin: windowsPolicy.frame, windowsPolicy };
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

/**
 * The compiler's Node arguments on macOS: --disable-proto=throw like every runtime-port launch (TASK-35 §2.2), and most of all here,
 * where untrusted App sources are loaded. Linux's exec-policy helper and the Windows policy build their argv in their own slices.
 */
export function compilerNodeArgs(entry: string) {
  return ["--disable-proto=throw", entry];
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

function normalizePlatform(platform: NodeJS.Platform): SandboxPlatform {
  if (platform === "darwin" || platform === "linux" || platform === "win32") return platform;
  throw unavailable(`compiled App GUI is unsupported on ${platform}`);
}

async function adapterIdentity(options: CompilerSandboxOptions, mechanism?: string) {
  if (options.platform === "linux") throw unavailable("Linux compiler identity must come from its admitted component");
  const path = options.platform === "darwin" ? "/usr/bin/sandbox-exec"
    : options.windowsWrapper!;
  if (options.platform === "win32" && !mechanism) throw unavailable("Windows compiler mechanism was not verified");
  return { mechanism: options.platform === "darwin" ? "seatbelt-v1" : mechanism,
    componentDigest: await fileDigest(path), requestSchema: COMPILER_REQUEST_SCHEMA };
}

function platformProbeExecutable(platform: SandboxPlatform) {
  if (platform === "win32") return "C:\\Windows\\System32\\cmd.exe";
  return "/usr/bin/true";
}

async function fileDigest(path: string) {
  return sha256(await readFile(path));
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

/* 编译子进程就是 Electron-as-Node 自己：dyld 要从 .app 的 Contents/Frameworks 装载
   Electron Framework，Linux/Windows 则从可执行文件同目录装载共享库。开发树里它恰好
   落在 node_modules 根之下，打包后不在任何依赖根里——首个打包态编译 smoke
   （2026-09-04）暴露的第二个死点。 */
function runtimeReadRoot(nodeExecutable: string) {
  if (process.platform === "darwin") {
    let current = dirname(nodeExecutable);
    while (current !== dirname(current)) {
      if (current.endsWith(".app")) return current;
      current = dirname(current);
    }
  }
  return dirname(nodeExecutable);
}

async function assertDirectory(path: string) {
  if (!(await stat(path)).isDirectory()) {
    throw new Error(`dependency root is not a directory: ${path}`);
  }
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
