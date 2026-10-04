/**
 * [INPUT]: Depends on node:child_process (ps) and createWatchdog.
 * [OUTPUT]: The process-watchdog entry: runs createWatchdog against the real process table, group signals and main's pipe on stdin.
 * [POS]: Built self-contained to out/main/process-watchdog-entry.js and started by agent-process-watchdog.ts on the bundled Node (TASK-35 C10).
 */
import { execFileSync } from "node:child_process";
import { createWatchdog, type WatchdogRow } from "./watchdog";

createWatchdog({
  ps() {
    try {
      return execFileSync("ps", ["-axo", "pid=,pgid=,lstart="], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" } }).split("\n")
        .flatMap((line): WatchdogRow[] => { const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/); return match ? [[Number(match[1]), Number(match[2]), match[3]!]] : []; });
    } catch { return null; }
  },
  kill: (pgid, signal) => { process.kill(-pgid, signal); },
  exit: () => process.exit(0),
  schedule: (run, ms) => { setTimeout(run, ms); },
  stdin: process.stdin,
});
