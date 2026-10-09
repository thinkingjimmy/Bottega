/**
 * [INPUT]: Depends on native child-process lifecycle events, a fixed OS probe executable, and a supervisor-owned read-only input root
 * [OUTPUT]: Creates and positively verifies a readable executable with bounded readiness and confirmed child closure
 * [POS]: Shared native probe control; readiness is separate from sandbox authority/resource limits, and failed execution cannot count as isolation
 */

import { spawn } from "node:child_process";
import { chmod, copyFile } from "node:fs/promises";
import { join } from "node:path";

const EXECUTABLE_CONTROL_READINESS_TIMEOUT_MS = 15_000;

export async function prepareExecutableControl(executable: string, inputRoot: string) {
  const target = join(inputRoot, process.platform === "win32" ? "executable-control.exe" : "executable-control");
  await copyFile(executable, target);
  await chmod(target, 0o755);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(target, [], { stdio: "ignore", env: {} });
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure ??= new Error("Executable probe control timed out");
      child.kill("SIGKILL");
    }, EXECUTABLE_CONTROL_READINESS_TIMEOUT_MS);
    child.once("error", (cause) => { failure ??= cause; });
    child.once("exit", () => { clearTimeout(timer); });
    // Staging cleanup must not run while the owned executable is still alive.
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code === 0 && signal === null) resolve();
      else reject(new Error(`Executable probe control exited ${signal ?? code}`));
    });
  });
  return target;
}
