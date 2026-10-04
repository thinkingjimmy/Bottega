/**
 * [INPUT]: Depends on nothing but the ports it is given: a process-table read, a group signal, exit, a timer and main's pipe.
 * [OUTPUT]: Provides createWatchdog: the auxiliary watchdog's rules (B-04) — stdin lines `+pid birth` / `-pid` keep the live groups main registered; when the pipe ends (a normal exit, a crash, kill -9 alike) one process-table read keeps the groups that are ours (the leader still has its recorded birth, or the leader is gone and every member started no earlier), then SIGTERM, then SIGKILL every 500 ms, for at most eight rounds.
 * [POS]: The watchdog's logic (TASK-35 slice 2c, formerly a `-e` string held in main); watchdog-entry.ts runs it on the bundled Node, agent-process-watchdog.ts feeds it.
 */

/** One process-table row: pid, process group, start time as `ps -o lstart=` prints it under LC_ALL=C TZ=UTC. */
export type WatchdogRow = readonly [pid: number, pgid: number, started: string];
export type WatchdogPorts = {
  /** Null when the table cannot be read: then nothing is signalled. */
  ps(): WatchdogRow[] | null;
  kill(pgid: number, signal: "SIGTERM" | "SIGKILL"): void;
  exit(): void;
  schedule(run: () => void, ms: number): void;
  stdin: { setEncoding(encoding: "utf8"): void; on(event: "data", listener: (chunk: string) => void): void; on(event: "end" | "close" | "error", listener: () => void): void };
};

const at = (started: string) => Date.parse(`${started} GMT`);
/* A group is ours by main's own rule: a living leader with the recorded birth, or no leader and only members born after it. */
function own(rows: readonly WatchdogRow[], pid: number, born: string) {
  if (!born) return false;
  const leader = rows.find(row => row[0] === pid);
  if (leader) return leader[2] === born && leader[1] === pid;
  const members = rows.filter(row => row[1] === pid);
  return members.length > 0 && members.every(row => at(row[2]) >= at(born));
}

export function createWatchdog(ports: WatchdogPorts) {
  const live = new Map<number, string>();
  let pending = "", targets: number[] | null = null, round = 0;
  ports.stdin.setEncoding("utf8");
  ports.stdin.on("data", chunk => {
    pending += chunk;
    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      const line = pending.slice(0, end), pid = Number(line.slice(1).split(" ")[0]);
      pending = pending.slice(end + 1);
      if (!(pid > 1)) continue;
      if (line[0] === "+") live.set(pid, line.slice(line.indexOf(" ") + 1).trim()); else live.delete(pid);
    }
  });
  const step = () => {
    const rows = ports.ps();
    if (!rows) return ports.exit();
    targets = targets!.filter(pgid => rows.some(row => row[1] === pgid));
    if (!targets.length || round >= 8) return ports.exit();
    for (const pgid of targets) try { ports.kill(pgid, round ? "SIGKILL" : "SIGTERM"); } catch { /* gone or refused: judged again next round */ }
    round++;
    ports.schedule(step, round === 1 ? 1_500 : 500);
  };
  const reap = () => {
    if (targets) return;
    const rows = ports.ps();
    targets = rows ? [...live].filter(([pid, born]) => own(rows, pid, born)).map(([pid]) => pid) : [];
    if (rows) step(); else ports.exit();
  };
  ports.stdin.on("end", reap); ports.stdin.on("close", reap); ports.stdin.on("error", reap);
}
