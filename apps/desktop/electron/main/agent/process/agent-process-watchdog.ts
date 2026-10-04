/**
 * [INPUT]: Depends on node:child_process and, by type only, the runtime port: main's composition hands it the launch (the bundled Node and the process-watchdog entry, TASK-35 C10).
 * [OUTPUT]: Provides trackAuxiliaryProcessGroup(pid, birthIdentity) → untrack, configureProcessWatchdog (main's composition names the launch) and watchdogLaunch (the bundled Node on its entry, PATH and the C locale only): one watchdog process per main keeps the list of live auxiliary process groups and, when main's pipe closes (a normal exit, a crash or kill -9 alike), cleans the ones it can prove are ours — leader birth, or surviving members of a group whose leader exited.
 * [POS]: apps/desktop/electron/main/agent/process; Last line of defence for quota readers, catalog and readiness probes (registerAuxiliaryAgentProcess); Agent turns are custody's and deliberately outlive main, so they never come here.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { NodeLaunch, RuntimePort } from "../../runtime";

/* Only what the watchdog needs: `ps` on the C locale, and nothing of main's environment (tokens, proxy credentials; TASK-35 E2). */
const WATCHDOG_ENV = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
/** The watchdog's launch: the bundled Node on the process-watchdog entry (runtime/programs/watchdog.ts has its rules). */
export function watchdogLaunch(port: RuntimePort) {
  return port.plan({ program: { kind: "entry", entry: "process-watchdog" }, args: [], env: WATCHDOG_ENV, cwd: "/" });
}

/* Main's composition names the launch (runtime/app.ts). This module never resolves the port itself: the provider bridge reaches it
   and must not carry the port (__tests__/providers/bridge-graph.test.ts); a process that configures nothing runs no watchdog. */
let launchWatchdog: (() => NodeLaunch) | null = null;
export function configureProcessWatchdog(launch: () => NodeLaunch) { launchWatchdog = launch; }

let watchdog: ChildProcess | null | undefined;
function ensure(): ChildProcess | null {
  if (watchdog !== undefined) return watchdog;
  if (!launchWatchdog) return null;
  /* Only inside Electron: unit tests and tools never start a watchdog. */
  if (!process.versions.electron || process.env.BOTTEGA_DISABLE_PROCESS_WATCHDOG === "1") return watchdog = null;
  try {
    const launch = launchWatchdog();
    const child = spawn(launch.command, launch.args, { detached: true, stdio: ["pipe", "ignore", "ignore"], cwd: launch.cwd, env: launch.env });
    child.once("error", (cause) => { console.warn("[agent-processes] watchdog unavailable", cause.message); watchdog = null; });
    child.unref();
    (child.stdin as unknown as { unref?(): void })?.unref?.();
    return watchdog = child;
  } catch (cause) {
    console.warn("[agent-processes] watchdog unavailable", cause instanceof Error ? cause.message : String(cause));
    return watchdog = null;
  }
}

/** Auxiliary processes are spawned detached, so their pid is their process group; `birthIdentity` guards pid reuse. */
export function trackAuxiliaryProcessGroup(pid: number | undefined, birthIdentity: string | null, required = false) {
  /* Without a recorded birth the group could never be proven ours, so the watchdog is not told about it. */
  const child = pid && birthIdentity ? ensure() : null;
  if (!child?.stdin?.writable || !pid || !birthIdentity) {
    if (required) throw new Error("process-watchdog-unavailable");
    return () => {};
  }
  child.stdin.write(`+${pid} ${birthIdentity}\n`);
  let done = false;
  return () => { if (done) return; done = true; if (child.stdin?.writable) child.stdin.write(`-${pid}\n`); };
}
