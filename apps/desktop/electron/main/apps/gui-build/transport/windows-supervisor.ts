/**
 * [INPUT]: Depends on a verified wrapper launch, operation-bound control frames and release result validation
 * [OUTPUT]: Provides bounded running, cancel-requested and release-wait supervision without killing the evidence producer early
 * [POS]: Windows compiler Host transport; native Job ownership remains the wrapper's responsibility
 */

import { spawn } from "node:child_process";
import { APP_GUI_BUILD_BUDGET } from "../contracts";
import {
  encodeWindowsCompilerControl, verifyWindowsCompilerResult, WINDOWS_POLICY_BYTES, WINDOWS_RELEASE_TIMEOUT_MS,
  type createWindowsCompilerPolicy, type WindowsCompilerStop,
} from "./windows-policy";

type Launch = Readonly<{
  command: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>>;
  windowsPolicy: ReturnType<typeof createWindowsCompilerPolicy>;
}>;
type Result = {
  exitCode: number; stdout: string; stderr: string; mechanism?: string;
  limit: WindowsCompilerStop | "rss" | "cpu" | "process" | "custody" | null;
};

export function superviseWindowsCompiler(launch: Launch, signal?: AbortSignal, releaseTimeoutMs = WINDOWS_RELEASE_TIMEOUT_MS): Promise<Result> {
  if (signal?.aborted) return Promise.resolve({ exitCode: 1, stdout: "", stderr: "", limit: "aborted" });
  const expected = launch.windowsPolicy;
  return new Promise((resolve) => {
    const child = spawn(launch.command, [...launch.args], {
      cwd: launch.cwd, env: { ...launch.env }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let requested: WindowsCompilerStop | undefined;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const finish = (result: Result) => {
      if (finished) return;
      finished = true;
      clearTimeout(wallTimer);
      clearTimeout(releaseTimer);
      signal?.removeEventListener("abort", abort);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(result);
    };
    const failRelease = () => {
      child.kill("SIGKILL");
      finish({ exitCode: 1, stdout: "", stderr: stderr.toString("utf8"), limit: "custody" });
    };
    const requestStop = (reason: WindowsCompilerStop) => {
      if (finished || requested) return;
      requested = reason;
      child.stdin.end(encodeWindowsCompilerControl(expected, reason));
      releaseTimer = setTimeout(failRelease, releaseTimeoutMs);
    };
    const collect = (current: Buffer, chunk: Buffer, maximum: number, name: "stdout" | "stderr") => {
      if (current.length + chunk.length > maximum) requestStop(name);
      return Buffer.concat([current, chunk.subarray(0, Math.max(0, maximum - current.length))]);
    };
    const abort = () => requestStop("aborted");
    const wallTimer = setTimeout(() => requestStop("wall"), expected.policy.budgets.wallTimeMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk, WINDOWS_POLICY_BYTES, "stdout"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk, APP_GUI_BUILD_BUDGET.stderrBytes, "stderr"); });
    // Initial policy is a frame, not an EOF-delimited stream. Keep stdin for one optional control frame.
    child.stdin.on("error", () => undefined);
    child.stdin.write(expected.frame);
    child.once("error", failRelease);
    child.once("close", (code) => {
      if (finished) return;
      try {
        const report = verifyWindowsCompilerResult(JSON.parse(stdout.toString("utf8")), expected, requested);
        if (code !== 0) throw new Error("Wrapper failed before completing its protocol");
        finish({ exitCode: report.exitCode, stdout: report.stdout, stderr: stderr.toString("utf8"),
          limit: requested ?? report.limit, mechanism: report.mechanism });
      } catch { failRelease(); }
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}
