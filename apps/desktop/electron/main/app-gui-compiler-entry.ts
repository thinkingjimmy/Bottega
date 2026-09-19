/**
 * [INPUT]: Depends on a single versioned, 1 MiB length-prefixed stdin compiler/probe request, a supervisor-owned live loopback control port, Node crypto/process primitives, the trusted GUI transform kernel, and OS sandbox authority supplied by the parent supervisor
 * [OUTPUT]: Emits one bounded compiler outcome or authority/resource probe report, including readable executable denial, observed Linux AppArmor profile and detached-session escape attempts, whose detached children it owns and reaps on every exit path
 * [POS]: Explicit Electron main utility entry for compiled App GUI work; it never runs App-authored code, chooses filesystem/network authority, or outlives the processes its custody probe spawns
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import type { AppGuiBuildFinding } from "../../shared/apps-ipc";
import { readCompilerRequest, type CompilerRequest } from "./apps/gui-build/transport/request";
import { compilePreparedAppGui } from "./apps/gui-build/pipeline/compiler";

async function main() {
  if (process.argv.length !== 2) throw new Error("compiler requests must use stdin");
  const timer = setTimeout(() => process.stdin.destroy(new Error("compiler request timed out")), 5_000);
  const request = await readCompilerRequest(process.stdin).finally(() => clearTimeout(timer));
  if (request.mode === "probe") {
    const probes = await runProbe(request);
    const linuxProfile = process.platform === "linux"
      ? (await readFile("/proc/self/attr/current", "utf8")).trim()
      : undefined;
    process.stdout.write(JSON.stringify({ probes, linuxProfile }));
    return;
  }
  if (request.mode === "custody-probe") {
    await runCustodyProbe(request.processCount);
    return;
  }
  if (request.mode === "resource-probe") {
    await runResourceProbe(request.kind);
    return;
  }
  try {
    const artifact = await compilePreparedAppGui(request.input);
    process.stdout.write(JSON.stringify({ ok: true, outcome: { status: "compiled", artifact, findings: [] } }));
  } catch (cause) {
    const findings = findingsFrom(cause);
    process.stdout.write(JSON.stringify({
      ok: true,
      outcome: {
        status: "failed",
        findings,
      },
    }));
  }
}

async function runResourceProbe(kind: "rss" | "cpu" | "timeout") {
  if (kind === "cpu") {
    let value = Buffer.alloc(32, 1);
    while (true) value = createHash("sha256").update(value).digest();
  }
  if (kind === "rss") {
    const retained: Buffer[] = [];
    while (true) {
      retained.push(Buffer.alloc(16 * 1024 * 1024, 1));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  setInterval(() => undefined, 1_000);
  await new Promise(() => undefined);
}

/* The custody probe spawns detached children on purpose: escaping the session is
   the very authority the supervisor has to contain. Nothing in the OS ties their
   lifetime to this process, so two independent reapers do it instead - each child
   watches its own parent pid, and the probe kills what it spawned on every exit
   path it can observe. */
const CUSTODY_CHILD_SCRIPT = [
  "setInterval(() => {}, 1000);",
  "const parent = process.ppid;",
  "setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 200);",
].join("");

/* A safety net, not a budget: the parent supervises this probe with a 2 s wall
   clock and a process limit, so a supervised probe is always killed long before
   this fires. It matters only when the entry runs unsupervised, where an
   unbounded park would leave an immortal process-spawning process behind. */
const CUSTODY_PROBE_PARK_MS = 10_000;

async function runCustodyProbe(processCount: number) {
  const children: ChildProcess[] = [];
  const reap = () => {
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* Already gone (ESRCH): reaping is best effort by construction. */
      }
    }
  };
  /* Registered before the first spawn so a signal landing mid-loop still reaps
     whatever already exists. */
  process.on("exit", reap);
  for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]] as const) {
    process.on(signal, () => {
      reap();
      process.exit(code);
    });
  }
  for (let index = 0; index < processCount + 2; index += 1) {
    try {
      const child = spawn(process.execPath, ["-e", CUSTODY_CHILD_SCRIPT], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", () => undefined);
      children.push(child);
    } catch {
      break;
    }
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  const running = children.filter((child) => child.pid && child.exitCode === null);
  if (running.length + 1 <= processCount) {
    running.forEach((child) => child.kill("SIGKILL"));
    process.stdout.write(JSON.stringify({ contained: true }));
    return;
  }
  /* Parking is the measurement, not a bug: an uncontained probe must keep its
     children alive and stay silent so the supervisor can count the tree and
     enforce its process limit. The cap bounds only the unsupervised case. */
  await new Promise((resolveWait) => setTimeout(resolveWait, CUSTODY_PROBE_PARK_MS));
  process.stderr.write(`custody probe parked past ${CUSTODY_PROBE_PARK_MS} ms without a supervisor\n`);
  reap();
  /* Leave through the event loop so the reason survives a piped stderr, and keep
     an unref'd hard exit behind it so a stuck child handle cannot park us again. */
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 250).unref();
}

/* 沙箱形状的拒绝码。macOS Seatbelt 对 read/write/connect/exec 一律给 EPERM，
   Linux bubblewrap 则因为路径根本不在挂载命名空间里而给 ENOENT，网络命名空间
   为空时给 ENETUNREACH。DNS 被拒时 getaddrinfo 只会说 ENOTFOUND/EAI_AGAIN。 */
const SANDBOX_DENIALS = new Set(["EPERM", "EACCES", "ENOENT", "ENETUNREACH", "EHOSTUNREACH", "EAFNOSUPPORT"]);
const UNREACHABLE_DENIALS = new Set([...SANDBOX_DENIALS, "ENETDOWN", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"]);
/* 正对照下 ECONNREFUSED 也是证据：监听器确实活着，能被拒绝说明子进程看到的
   回环栈不是宿主那一个。没有正对照时它什么都不证明，这正是旧实现的漏洞。 */
const LOOPBACK_DENIALS = new Set([...SANDBOX_DENIALS, "ECONNREFUSED"]);

async function runProbe(request: Extract<CompilerRequest, { mode: "probe" }>) {
  // Reading must succeed before EACCES/EPERM can establish executable isolation.
  await readFile(request.readableExecutable);
  const results = await Promise.all([
    denied("read-outside", () => readFile(request.forbiddenRead), SANDBOX_DENIALS),
    denied("write-outside", () => writeFile(request.forbiddenWrite, "forbidden"), SANDBOX_DENIALS),
    /* 离线机器与被围住的机器在公网/DNS 上是同一副面孔，所以这两条只做旁证；
       真正的网络证据是 loopback——那一端有监听器活着，连上就是漏。 */
    denied("network-internet", () => socket("1.1.1.1", 443), UNREACHABLE_DENIALS),
    denied("network-loopback", () => socket("127.0.0.1", request.loopbackPort), LOOPBACK_DENIALS),
    denied("network-dns", () => lookup("example.com"), UNREACHABLE_DENIALS),
    Promise.resolve({ id: "environment-secret", denied: process.env.BOTTEGA_COMPILER_PROBE_SECRET === undefined }),
    denied("process-spawn", () => spawnProbe(request.spawnExecutable), SANDBOX_DENIALS),
    denied("process-spawn-readable", () => spawnProbe(request.readableExecutable), new Set(["EPERM", "EACCES"])),
  ]);
  return results;
}

async function denied(
  id: string,
  operation: () => Promise<unknown>,
  accepted: ReadonlySet<string>
) {
  try {
    await withDeadline(operation(), 750);
    return { id, denied: false };
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    return { id, denied: typeof code === "string" && accepted.has(code) };
  }
}

function socket(host: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const client = connect({ host, port });
    client.once("connect", () => { client.destroy(); resolve(); });
    client.once("error", reject);
  });
}

function spawnProbe(executable: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`probe exited ${code}`)));
  });
}

function withDeadline<T>(operation: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("probe timeout")), timeoutMs);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (cause) => { clearTimeout(timer); reject(cause); }
    );
  });
}

function findingsFrom(cause: unknown): readonly AppGuiBuildFinding[] {
  if (
    cause &&
    typeof cause === "object" &&
    "findings" in cause &&
    Array.isArray(cause.findings)
  ) {
    return cause.findings.slice(0, 100) as readonly AppGuiBuildFinding[];
  }
  return [{
    code: "GUI_BUILD_COMPILER_CRASH",
    file: "gui/",
    message: (cause instanceof Error ? cause.message : String(cause)).slice(0, 1_024),
  }];
}

/* 入口调用必须留在模块末尾：main() 是同步启动的，写在顶部会让它在本模块的
   const 初始化器之前跑起来，探针拿到的将是 undefined 而不是拒绝码集合。 */
void main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 1;
});
