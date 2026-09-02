/**
 * [INPUT]: Depends on a single base64url compiler/probe request, a supervisor-owned live loopback control port, Node crypto/process primitives, the trusted GUI transform kernel, and OS sandbox authority supplied by the parent supervisor
 * [OUTPUT]: Emits one bounded JSON compiler outcome or errno-classified authority/resource probe report, including detached-session escape attempts, on stdout
 * [POS]: Explicit Electron main utility entry for compiled App GUI work; it never runs App-authored code or chooses filesystem/network authority
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import type { AppGuiBuildFinding } from "../../shared/apps-ipc";
import type { SealedCompilerInput } from "./apps/gui-build/contracts";
import { compilePreparedAppGui } from "./apps/gui-build/pipeline/compiler";

type Request =
  | Readonly<{
      mode: "probe";
      forbiddenRead: string;
      forbiddenWrite: string;
      loopbackPort: number;
      spawnExecutable: string;
    }>
  | Readonly<{ mode: "custody-probe"; processCount: number }>
  | Readonly<{ mode: "resource-probe"; kind: "rss" | "cpu" | "timeout" }>
  | Readonly<{ mode: "compile"; input: SealedCompilerInput }>;

async function main() {
  const encoded = process.argv[2];
  if (!encoded || encoded.length > 128 * 1024) throw new Error("compiler request is missing or oversized");
  const request = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Request;
  if (request.mode === "probe") {
    const probes = await runProbe(request);
    process.stdout.write(JSON.stringify({ probes }));
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

async function runCustodyProbe(processCount: number) {
  const children = [];
  for (let index = 0; index < processCount + 2; index += 1) {
    try {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
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
  await new Promise(() => undefined);
}

/* 沙箱形状的拒绝码。macOS Seatbelt 对 read/write/connect/exec 一律给 EPERM，
   Linux bubblewrap 则因为路径根本不在挂载命名空间里而给 ENOENT，网络命名空间
   为空时给 ENETUNREACH。DNS 被拒时 getaddrinfo 只会说 ENOTFOUND/EAI_AGAIN。 */
const SANDBOX_DENIALS = new Set(["EPERM", "EACCES", "ENOENT", "ENETUNREACH", "EHOSTUNREACH", "EAFNOSUPPORT"]);
const UNREACHABLE_DENIALS = new Set([...SANDBOX_DENIALS, "ENETDOWN", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"]);
/* 正对照下 ECONNREFUSED 也是证据：监听器确实活着，能被拒绝说明子进程看到的
   回环栈不是宿主那一个。没有正对照时它什么都不证明，这正是旧实现的漏洞。 */
const LOOPBACK_DENIALS = new Set([...SANDBOX_DENIALS, "ECONNREFUSED"]);

async function runProbe(request: Extract<Request, { mode: "probe" }>) {
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
