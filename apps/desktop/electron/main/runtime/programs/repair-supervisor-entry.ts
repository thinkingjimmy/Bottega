/**
 * [INPUT]: Depends on node:fs and node:child_process; argv carries --nonce, --command, --handshake, --go and --result paths.
 * [OUTPUT]: The repair-supervisor entry: publishes its handshake (pid, pgid, `ps lstart`, nonce), waits for the go file, runs the command described in the command file inside its own process group, and publishes the exit.
 * [POS]: Built self-contained to out/main/repair-supervisor-entry.js and started on the bundled Node by apps/install/repair/supervisor.ts (TASK-35 C8, formerly a `-e` string); recovery recognises it by `ps lstart` plus the nonce in its argv.
 */
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const value = (name: string) => args[args.indexOf(name) + 1]!;
const nonce = value("--nonce"), handshake = value("--handshake"), go = value("--go"), result = value("--result");
/* The command's own environment travels in this file; the supervisor itself runs with PATH alone. */
const command = JSON.parse(readFileSync(value("--command"), "utf8")) as { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  stdin?: string; stdoutPath: string; stderrPath: string };
const publish = (path: string, data: unknown) => {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(data));
  renameSync(temporary, path);
};
let startedAt = "";
/* Recovery reads lstart with the same fixed locale and zone (supervisor.ts PS_ENV); the launcher's environment must not shift it. */
try { startedAt = execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" } }).trim(); }
catch { /* recorded empty: harvest then refuses it */ }
publish(handshake, { pid: process.pid, pgid: process.pid, processStartedAt: startedAt, nonce });
const deadline = Date.now() + 30_000;
while (!existsSync(go) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
if (!existsSync(go)) process.exit(124);
setInterval(() => {}, 60_000);
const stdoutFd = openSync(command.stdoutPath, "a", 0o600), stderrFd = openSync(command.stderrPath, "a", 0o600);
const child = spawn(command.executable, command.args, { cwd: command.cwd, env: command.env, detached: false, stdio: ["pipe", stdoutFd, stderrFd] });
closeSync(stdoutFd); closeSync(stderrFd);
child.stdin!.end(command.stdin || "");
let settled = false;
const finish = (code: number | null, signal: NodeJS.Signals | null) => {
  if (settled) return;
  settled = true;
  publish(result, { code: code == null ? 1 : code, signal });
};
child.on("error", error => { appendFileSync(command.stderrPath, String(error)); finish(127, null); });
child.on("exit", (code, signal) => finish(code, signal));
