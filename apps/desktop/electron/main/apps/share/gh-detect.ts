/**
 * [INPUT]: Depends on node: child_process' execFile and the process environment
 * [OUTPUT]: Provides detect GhStatus tri-mode detection; 10 seconds overdue, shell = false, exit code is the only way to tell
 * [POS]: The GitHub CLI trust probe for apps/share; Product only detects and instructs, not replaces user installation or login
 */

import { execFile } from "node:child_process";
import type { GhStatus } from "../../../../shared/apps-ipc";
import { sanitizedProcessEnvironment } from "../../codex-runtime";

export async function detectGhStatus(
  run: typeof runCommand = runCommand
): Promise<GhStatus> {
  const version = await run("gh", ["--version"]);
  if (version.code !== 0) {
    return { state: "missing", message: "未检测到 GitHub CLI" };
  }
  const auth = await run("gh", ["auth", "status"]);
  return auth.code === 0
    ? { state: "ready", message: firstLine(version.stdout) || "GitHub CLI 已就绪" }
    : { state: "unauthenticated", message: "GitHub CLI 尚未登录" };
}

function runCommand(command: string, args: readonly string[]) {
  return new Promise<{ code: number; stdout: string }>((resolve) => {
    execFile(
      command,
      [...args],
      {
        env: sanitizedProcessEnvironment(),
        encoding: "utf8",
        timeout: 10_000,
        shell: false,
      },
      (error, stdout) => {
        const code =
          typeof (error as NodeJS.ErrnoException & { code?: number })?.code ===
          "number"
            ? (error as unknown as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ code, stdout });
      }
    );
  });
}

function firstLine(value: string) {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? "";
}
