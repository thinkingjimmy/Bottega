/**
 * [INPUT]: Depends on a fixed OS probe executable and a supervisor-owned read-only input root
 * [OUTPUT]: Creates and positively verifies a readable executable for sandbox EXECUTE denial probes
 * [POS]: Shared native probe control; absence or a broken executable cannot count as isolation
 */

import { spawn } from "node:child_process";
import { chmod, copyFile } from "node:fs/promises";
import { join } from "node:path";

export async function prepareExecutableControl(executable: string, inputRoot: string) {
  const target = join(inputRoot, process.platform === "win32" ? "executable-control.exe" : "executable-control");
  await copyFile(executable, target);
  await chmod(target, 0o755);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(target, [], { stdio: "ignore", env: {} });
    const timer = setTimeout(() => { child.kill(); reject(new Error("Executable probe control timed out")); }, 2000);
    child.once("error", (cause) => { clearTimeout(timer); reject(cause); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Executable probe control exited ${code}`));
    });
  });
  return target;
}
