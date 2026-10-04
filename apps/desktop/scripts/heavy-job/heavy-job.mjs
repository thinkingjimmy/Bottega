/**
 * [INPUT]: Depends on node:child_process/fs/os, macOS /usr/bin/lockf (kernel flock) and /usr/sbin/taskpolicy, util-linux flock on Linux
 * [OUTPUT]: Provides runAsHeavyJob(label, { phases, background }), which re-executes the calling script under one machine-wide lock at nice 15 with idle-aware background QoS (a phased job holds the lock once and runs `@timing-sensitive` items in a second run under it that never gets background QoS), heavyJobCommand for its command line, lockHolder (the recorded or lock-file-holding process, and whether it encloses the caller; a waiter prints it, an enclosed job refuses instead of deadlocking), backgroundQosFor/readIdleMs/demoteTree for the idle decision, and timingSensitive/timingSensitiveFile/inTimingPhase/timingPhase/underBackgroundQos for runners
 * [TEST HOOKS]: BOTTEGA_HEAVY_JOB_IDLE_FILE replaces the HID idle source with a file holding idle milliseconds, re-read on every poll; BOTTEGA_HEAVY_JOB_IDLE_POLL_MS shortens the 15 s poll.
 * [POS]: The single gate every heavy entry point passes (build:e2e, hermetic-suite, dist packaging, budget:production, verify-public-export), so only one heavy job runs on the machine at a time and the person's own apps keep priority
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import process from "node:process";

/* A fixed path shared by every worktree and session on the machine; tests point it elsewhere. */
export const DEFAULT_HEAVY_JOB_LOCK = "/tmp/bottega-heavy-job.lock";
const HELD_ENV = "BOTTEGA_HEAVY_JOB_HELD";
const LABEL_ENV = "BOTTEGA_HEAVY_JOB_LABEL";
const lockPath = () => process.env.BOTTEGA_HEAVY_JOB_LOCK || DEFAULT_HEAVY_JOB_LOCK;
const holderPath = (lock) => `${lock}.holder.json`;
const EX_TEMPFAIL = 75;

/* A timing-sensitive test or probe carries a wall-clock budget that background QoS would break, not the code under test. */
const PHASE_ENV = "BOTTEGA_TIMING_PHASE";
const HEADER_LINES = 30;
const TIMING_MARK = /^\s*(?:\/\/|\/?\*+)\s*@timing-sensitive\b/;

/** True when a file's header (its first 30 lines) carries a `@timing-sensitive <why>` comment. */
export function timingSensitive(source) {
  return source.split("\n", HEADER_LINES).some((line) => TIMING_MARK.test(line));
}
export function timingSensitiveFile(path) {
  try { return timingSensitive(readFileSync(path, "utf8").slice(0, 8192)); } catch { return false; }
}
/** Whether an item runs in the current phase of a phased heavy job; outside one, everything runs. */
export function inTimingPhase(marked) {
  const phase = process.env[PHASE_ENV];
  if (phase === "background") return !marked;
  if (phase === "timing") return marked;
  return true;
}
export const timingPhase = () => process.env[PHASE_ENV] || null;
/** macOS reports background QoS as scheduler priority 4; there it cannot be lifted from inside, so a runner can only say so. */
export function underBackgroundQos(platform = process.platform) {
  if (platform !== "darwin") return false;
  const pri = spawnSync("/bin/ps", ["-o", "pri=", "-p", String(process.pid)], { encoding: "utf8" }).stdout?.trim();
  return Number(pri) <= 4;
}

/* Idle-aware QoS (darwin): someone at the machine keeps a heavy job under background QoS; after 5 idle minutes, measured when the
   job actually starts under the lock, it may use every core, and it is demoted from outside the moment input returns. A process
   cannot lift background QoS from inside, and demotion is per pid, so the wrapper demotes the tree top-down (a later fork
   inherits from its parent). A demoted job is never promoted again; the next promotion needs 5 more quiet minutes. */
export const IDLE_THRESHOLD_MS = 5 * 60_000;
const GATE_ENV = "BOTTEGA_HEAVY_JOB_GATE";
const idlePollMs = () => Number(process.env.BOTTEGA_HEAVY_JOB_IDLE_POLL_MS) || 15_000;

/** "full" only after 5 idle minutes; an unreadable idle source counts as someone at the machine. */
export function backgroundQosFor(idleMs) {
  return idleMs !== null && idleMs >= IDLE_THRESHOLD_MS ? "full" : "background";
}
/** Milliseconds since the last keyboard/mouse input (IOHIDSystem HIDIdleTime, about 10 ms a read), or null. */
export function readIdleMs(env = process.env) {
  if (env.BOTTEGA_HEAVY_JOB_IDLE_FILE) {
    try { const value = Number(readFileSync(env.BOTTEGA_HEAVY_JOB_IDLE_FILE, "utf8").trim()); return Number.isFinite(value) ? value : null; } catch { return null; }
  }
  if (process.platform !== "darwin") return null;
  const out = spawnSync("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-d", "4", "-r", "-k", "HIDIdleTime"], { encoding: "utf8" }).stdout ?? "";
  const match = /"HIDIdleTime" = (\d+)/.exec(out);
  return match ? Math.floor(Number(match[1]) / 1e6) : null;
}
/** Demotes a running process tree to background QoS, parents first, twice to catch forks made during the first walk. */
export function demoteTree(rootPid) {
  const demoted = new Set();
  for (let pass = 0; pass < 2; pass++) {
    const children = new Map();
    for (const line of (spawnSync("/bin/ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" }).stdout ?? "").split("\n")) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (pid) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    }
    for (const queue = [rootPid]; queue.length;) {
      const pid = queue.shift();
      if (!demoted.has(pid) && spawnSync("/usr/sbin/taskpolicy", ["-b", "-p", String(pid)], { stdio: "ignore" }).status === 0) demoted.add(pid);
      queue.push(...(children.get(pid) ?? []));
    }
  }
  return demoted.size;
}

const lockPrefix = (lock, platform) => platform === "darwin" ? ["/usr/bin/lockf", "-k", lock]
  : platform === "linux" && existsSync("/usr/bin/flock") ? ["/usr/bin/flock", lock] : null;
const niceCommand = (argv, platform, background) => platform === "darwin"
  ? ["/usr/bin/nice", "-n", "15", ...(background ? ["/usr/sbin/taskpolicy", "-b"] : []), ...argv] : ["nice", "-n", "15", ...argv];
/** The wrapper command: the kernel lock is held by lockf/flock for exactly the job's lifetime, so exit or a crash releases it. */
export function heavyJobCommand(lock, argv, platform = process.platform, { background = true } = {}) {
  const prefix = lockPrefix(lock, platform);
  if (!prefix) return null;
  const [tool, ...args] = [...prefix, ...niceCommand(argv, platform, background)];
  return [tool, args];
}

function probeCommand(lock, platform) {
  if (platform === "darwin") return ["/usr/bin/lockf", ["-k", "-t", "0", lock, "/usr/bin/true"]];
  return ["/usr/bin/flock", ["-n", lock, "true"]];
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
const clock = (at) => new Date(at).toTimeString().slice(0, 8);
/* The job's record names a holder the wrapper started; lockf/flock keep the lock file open, so the processes holding it also name
   a raw wrapper nobody recorded. A record whose pid is gone is never shown as the holder. */
export function lockHolder(lock) {
  let record = null;
  try { record = JSON.parse(readFileSync(holderPath(lock), "utf8")); } catch { /* A missing lock record or an already exited process needs no cleanup. */ }
  if (record && !alive(record.pid)) record = null;
  const listed = spawnSync("lsof", ["-t", "--", lock], { encoding: "utf8", timeout: 3_000 });
  const openers = String(listed.stdout ?? "").split("\n").map(Number).filter((pid) => pid > 0 && pid !== process.pid);
  const table = new Map();
  const ps = spawnSync("ps", ["-Ao", "pid=,ppid=,args="], { encoding: "utf8", timeout: 3_000, maxBuffer: 16 * 1024 * 1024 });
  for (const line of String(ps.stdout ?? "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (match) table.set(Number(match[1]), { ppid: Number(match[2]), args: match[3] });
  }
  const ancestors = new Set();
  for (let pid = process.ppid; pid > 1 && !ancestors.has(pid); pid = table.get(pid)?.ppid ?? 0) ancestors.add(pid);
  const describe = (pid) => record?.pid === pid ? `${pid} (${record.label}), started ${clock(record.startedAt)}, ${Math.round((Date.now() - record.startedAt) / 60_000)} min ago`
    : `${pid} (${(table.get(pid)?.args ?? "unknown command").slice(0, 120)})`;
  const holders = [...(record ? [record.pid] : []), ...openers.filter((pid) => pid !== record?.pid)];
  const enclosing = holders.find((pid) => ancestors.has(pid));
  return { text: holders.length ? describe(enclosing ?? holders[0]) : "another process", enclosing: enclosing !== undefined };
}

const SIGNAL_CODES = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1, SIGKILL: 9 };
/* One locked run of this same script; a signal to the wrapper is forwarded and reported, so a phased job stops there. */
/* Before queueing: name the holder, or refuse when an ancestor holds the lock without handing it down (a raw lockf wrapper, or an
   environment that dropped the held marker), which would deadlock every heavy job queued behind it. */
function announceWait(lock, label) {
  const [probe, probeArgs] = probeCommand(lock, process.platform);
  const status = spawnSync(probe, probeArgs, { stdio: "ignore" }).status;
  if (process.platform === "darwin" ? status !== EX_TEMPFAIL : status === 0) return true;
  const holder = lockHolder(lock);
  if (holder.enclosing) {
    process.stderr.write(`[heavy-job] ${label}: already inside a heavy job held by ${holder.text}; run heavy entry points directly, never wrapped in the lock\n`);
    return false;
  }
  process.stderr.write(`[heavy-job] ${label}: waiting for heavy-job lock held by ${holder.text}\n`);
  return true;
}

/* A phased job holds the lock once for all its phases, so no other heavy job runs in the gap between them: a sidecar lockf/flock
   runs `cat` on a pipe, which proves the lock is held (the echo). The wrapper and each phase job hold the pipe's write end, so
   the lock is released only once both are gone: a wrapper killed with -9 leaves its running phase job locked. */
async function holdLock(lock) {
  const [tool, ...args] = [...lockPrefix(lock, process.platform), "/bin/cat"];
  const sidecar = spawn(tool, args, { stdio: ["pipe", "pipe", "ignore"] });
  const held = new Promise((resolve) => {
    sidecar.stdout.once("data", () => resolve(true));
    sidecar.once("exit", () => resolve(false));
  });
  sidecar.stdin.write("held\n");
  if (!await held) throw new Error("heavy-job: the lock sidecar exited before holding the lock");
  const release = () => new Promise((resolve) => { if (sidecar.exitCode !== null) return resolve(); sidecar.once("exit", resolve); sidecar.stdin.end(); });
  return { release, pipe: sidecar.stdin };
}

async function runLocked(lock, label, command, env, gate = null, pipe = null) {
  const child = spawn(command[0], command[1], { stdio: ["inherit", "inherit", "inherit", ...(pipe ? [pipe] : [])], env: { ...process.env, ...env, [HELD_ENV]: lock, [LABEL_ENV]: label } });
  let interrupted = null;
  const forwarders = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => {
    const forward = () => { interrupted = signal; if (child.exitCode === null) child.kill(signal); };
    process.on(signal, forward);
    return () => process.off(signal, forward);
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  if (gate) void governQos(label, child, gate, exited);
  const { code, signal } = await exited;
  for (const remove of forwarders) remove();
  if (gate) for (const path of [`${gate}.ready`, `${gate}.go`]) rmSync(path, { force: true });
  /* lockf can exit 0 after forwarding an interrupt; an interrupted job is never a success. */
  const received = signal ?? interrupted;
  return { interrupted: Boolean(interrupted), status: code || (received ? 128 + (SIGNAL_CODES[received] ?? 1) : code ?? 1) };
}

/* The job signals `<gate>.ready` once it holds the lock; the wrapper decides from the idle time right then, demotes if someone is
   at the machine, releases it with `<gate>.go`, and while the job runs promoted, demotes it as soon as input returns. */
async function governQos(label, child, gate, exited) {
  let done = false;
  void exited.then(() => { done = true; });
  while (!done && !existsSync(`${gate}.ready`)) await sleep(50);
  if (done) return;
  let promoted = backgroundQosFor(readIdleMs()) === "full";
  if (!promoted) demoteTree(child.pid);
  else process.stderr.write(`[heavy-job] ${label}: machine idle, running without background QoS\n`);
  writeFileSync(`${gate}.go`, "");
  while (promoted && !done) {
    await Promise.race([sleep(idlePollMs()), exited]);
    if (done || backgroundQosFor(readIdleMs()) === "full") continue;
    demoteTree(child.pid); promoted = false;
    process.stderr.write(`[heavy-job] ${label}: back at the machine, demoted to background\n`);
  }
}
/* Inside the lock, a gated job waits for the wrapper's QoS decision before its first line of work. */
async function awaitGate() {
  const gate = process.env[GATE_ENV];
  if (!gate) return;
  delete process.env[GATE_ENV];
  writeFileSync(`${gate}.ready`, String(process.pid));
  const deadline = Date.now() + 30_000;
  while (!existsSync(`${gate}.go`) && Date.now() < deadline) await sleep(20);
}

/**
 * Call first thing in a heavy entry point. Outside the lock it re-runs this same script under the lock and exits with its
 * status; inside (or on a platform without a lock tool) it records the holder and returns so the job proceeds.
 * The run (or a phased job's first run) gets idle-aware background QoS on macOS; elsewhere nice 15 only.
 * `phases: true` runs the job twice under the lock: unmarked items first, then `@timing-sensitive` items at nice 15 never under
 * background QoS (the job filters with inTimingPhase); a red first phase still runs the second, an interrupt does not.
 * `background: false` runs a wholly timing-sensitive job without background QoS.
 */
export async function runAsHeavyJob(label, { phases = false, background = true } = {}) {
  const lock = lockPath();
  if (process.env[HELD_ENV] === lock) {
    /* Nested heavy steps (dist → electron-vite, test:e2e → build:e2e) inherit the outer lock instead of deadlocking on it. */
    await awaitGate();
    if (process.env[LABEL_ENV] === label && !process.env.BOTTEGA_HEAVY_JOB_RECORDED) {
      process.env.BOTTEGA_HEAVY_JOB_RECORDED = "1";
      writeFileSync(holderPath(lock), JSON.stringify({ pid: process.pid, label, startedAt: Date.now() }));
      process.once("exit", () => { try { if (JSON.parse(readFileSync(holderPath(lock), "utf8")).pid === process.pid) rmSync(holderPath(lock)); } catch { /* A missing lock record or an already exited process needs no cleanup. */ } });
    }
    return;
  }
  const argv = [process.execPath, ...process.execArgv, ...process.argv.slice(1)];
  const runs = phases ? [["background", true], ["timing", false]] : [[null, background]];
  if (!heavyJobCommand(lock, argv)) return;
  if (!announceWait(lock, label)) process.exit(2);
  const held = phases ? await holdLock(lock) : null;
  let failed = 0;
  for (const [phase, backgroundQos] of runs) {
    /* Background QoS is applied from outside once the job holds the lock, so the command never carries taskpolicy -b there. */
    const gate = backgroundQos && process.platform === "darwin" ? `${lock}.gate-${process.pid}-${phase ?? "job"}` : null;
    const env = { ...(phase ? { [PHASE_ENV]: phase } : {}), ...(gate ? { [GATE_ENV]: gate } : {}) };
    const qos = { background: backgroundQos && !gate };
    /* Under the sidecar each phase runs as a nested job of this wrapper (the held marker), not as a second lock holder. */
    const [tool, ...args] = held ? niceCommand(argv, process.platform, qos.background) : [heavyJobCommand(lock, argv, process.platform, qos)].flatMap(([t, a]) => [t, ...a]);
    const { interrupted, status } = await runLocked(lock, label, [tool, args], env, gate, held?.pipe);
    failed ||= status;
    if (interrupted) break;
  }
  await held?.release();
  process.exit(failed);
}
