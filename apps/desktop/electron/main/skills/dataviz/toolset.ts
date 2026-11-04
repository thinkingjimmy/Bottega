/**
 * [INPUT]: Issued strict palette inputs, cancellation, verified runtime port and fixed validator provenance.
 * [OUTPUT]: Independent read-only validate_palette handler with bounded process/result validation.
 * [POS]: Skills-domain adapter; grants no editor, workspace, file or network authority.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { paletteInputSchema, paletteReportSchema } from "../../../../shared/builtin-tools/agent/dataviz";
import provenance from "../../../../resources/skills/dataviz/provenance.json";
import { runtimePort } from "../../runtime";
import type { BuiltinToolset } from "../../tools/registry";
const execute = promisify(execFile);
const source = provenance.files.find(file => file.target === "scripts/validate_palette.js")!;

export function createDatavizToolset(): BuiltinToolset {
  return { validate_palette: async (args, context) => {
    context.signal.throwIfAborted();
    const input = paletteInputSchema.parse(args);
    const expected = { palette: input.palette, surface: input.surface ?? (input.mode === "light" ? "#fcfcfb" : "#1a1a19"),
      mode: input.mode, pairs: input.pairs, ordinal: input.ordinal };
    const launch = runtimePort().plan({ program: { kind: "entry", entry: "palette-validator" },
      args: [input.palette.join(","), "--mode", input.mode, "--surface", expected.surface, "--pairs", input.pairs, ...(input.ordinal ? ["--ordinal"] : [])], env: {}, cwd: "/" });
    let stdout: string, exitStatus = 0;
    try {
      const result = await execute(launch.command, launch.args, { cwd: launch.cwd, env: launch.env,
        signal: context.signal, timeout: 5_000, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 32_768 });
      stdout = result.stdout;
    } catch (cause) {
      context.signal.throwIfAborted();
      const failed = cause as { code?: unknown; stdout?: unknown; killed?: boolean };
      if (failed.code !== 1 || failed.killed || typeof failed.stdout !== "string") throw cause;
      exitStatus = failed.code; stdout = failed.stdout;
    }
    context.signal.throwIfAborted();
    const report = paletteReportSchema.parse(JSON.parse(stdout));
    const digest = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
    const statuses = report.rules.map(rule => rule.status);
    const status = statuses.includes("FAIL") ? "FAIL" : statuses.includes("WARN") ? "WARN" : "PASS";
    if (report.inputDigest !== digest || report.script.gitBlob !== source.gitBlob || report.script.sha256 !== source.sha256 ||
      report.exitStatus !== exitStatus || report.status !== status || (exitStatus === 1) !== (status === "FAIL") ||
      JSON.stringify({ palette: report.palette, surface: report.surface, mode: report.mode, pairs: report.pairs, ordinal: report.ordinal }) !== JSON.stringify(expected)) {
      throw new Error("Palette process result does not match its inputs, script or exit status");
    }
    return report;
  } };
}
