/**
 * [INPUT]: Depends on node:child_process/fs/os/path and wrapInteractiveWithSeatbelt (the fence every Seatbelt-owned turn runs in).
 * [OUTPUT]: Provides readOnlyProbeLaunch (the bundled Node on the seatbelt-measurement entry, PATH / HOME / TMPDIR only, TASK-35 C11) and probeSeatbeltReadOnly: under the exact read-only profile a turn of that Provider gets, a workspace write must fail with EPERM/EACCES while a read succeeds, and the same write under workspace-write must succeed (the control).
 * [POS]: The Codex half of providers/measurements (P9, P10). Model-free; Codex's own sandbox is not involved because Bottega's Seatbelt is the enforcement on the interactive path.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import { wrapInteractiveWithSeatbelt } from "../../backends/sandbox/seatbelt";
import { runtimePort, type RuntimePort } from "../../runtime";

export type SeatbeltReadOnlyResult = { state: "enforced" | "unverified"; readOnly: string; control: string; error: string | null };

/**
 * The measurement's launch: the bundled Node on the seatbelt-measurement entry, reading the workspace file and writing one per filesystem mode.
 * TMPDIR and HOME inside the arena (the real TMPDIR is a kept write root and would make the check vacuous, P10), and nothing else of main's
 * environment (TASK-35 E2).
 */
export function readOnlyProbeLaunch(port: RuntimePort, paths: { workspace: string; temp: string; home: string }, filesystem: "read-only" | "workspace-write") {
  return port.plan({ program: { kind: "entry", entry: "seatbelt-measurement" },
    args: [join(paths.workspace, "source.txt"), join(paths.workspace, `written-${filesystem}.txt`)],
    env: { PATH: "/usr/bin:/bin", HOME: paths.home, TMPDIR: paths.temp }, cwd: paths.workspace });
}

export function probeSeatbeltReadOnly(backend: AgentBackendId): SeatbeltReadOnlyResult {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bottega-probe-read-only-")));
  const paths = { workspace: join(root, "workspace"), control: join(root, "control"), temp: join(root, "tmp"), home: join(root, "home") };
  try {
    for (const path of Object.values(paths)) mkdirSync(path, { recursive: true });
    writeFileSync(join(paths.workspace, "source.txt"), "original\n");
    const run = (filesystem: "read-only" | "workspace-write") => {
      const launch = readOnlyProbeLaunch(runtimePort(), paths, filesystem);
      const wrapped = wrapInteractiveWithSeatbelt({ command: launch.command, args: launch.args, env: launch.env, backend, permissionMode: "ask-for-approval",
        workspace: paths.workspace, readOnlyRoots: [], controlRoot: paths.control, network: false, filesystem });
      const result = spawnSync(wrapped.command, wrapped.args, { cwd: paths.workspace, env: launch.env, encoding: "utf8", timeout: 20_000 });
      return `${result.stdout ?? ""}`.trim().replace(/\s+/g, " ");
    };
    const readOnly = run("read-only"), control = run("workspace-write");
    const enforced = /read:OK/.test(readOnly) && /write:(EPERM|EACCES)/.test(readOnly) && /write:OK/.test(control);
    return { state: enforced ? "enforced" : "unverified", readOnly, control, error: null };
  } catch (cause) {
    return { state: "unverified", readOnly: "", control: "", error: cause instanceof Error ? cause.message.slice(0, 300) : String(cause) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
