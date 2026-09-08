/**
 * [INPUT]: Depends on node:child_process execFile, the sanitized process environment, and manifest-declared requirement ids
 * [OUTPUT]: Provides detectCliRequirements over a fixed detector table; External id never executed
 * [POS]: apps/share manifest→local-executable probe boundary; only allowlisted commands from CLI_DETECTORS run, never an arbitrary manifest-supplied executable
 */

import { execFile } from "node:child_process";
import type { AppRequirement } from "../../../../shared/apps-ipc";
import { sanitizedProcessEnvironment } from "../../backends/runtime-probe";

const CLI_DETECTORS = {
  gh: { command: "gh", args: ["--version"] },
  git: { command: "git", args: ["--version"] },
  node: { command: "node", args: ["--version"] },
  python3: { command: "python3", args: ["--version"] },
  ffmpeg: { command: "ffmpeg", args: ["-version"] },
} as const;

type CliRequirementStatus = {
  id: string;
  detectable: boolean;
  installed: boolean;
};

export async function detectCliRequirements(
  requirements: readonly AppRequirement[],
  run: typeof runDetector = runDetector
): Promise<CliRequirementStatus[]> {
  return Promise.all(
    requirements
      .filter((requirement) => requirement.kind === "cli")
      .map(async ({ id }) => {
        /* Object.hasOwn：manifest 提供的 id 不得经原型链命中 constructor/toString 等继承属性 */
        const detector = Object.hasOwn(CLI_DETECTORS, id)
          ? CLI_DETECTORS[id as keyof typeof CLI_DETECTORS]
          : undefined;
        if (!detector) return { id, detectable: false, installed: false };
        return {
          id,
          detectable: true,
          installed: await run(detector.command, detector.args),
        };
      })
  );
}

function runDetector(command: string, args: readonly string[]) {
  return new Promise<boolean>((resolve) => {
    execFile(
      command,
      [...args],
      {
        env: sanitizedProcessEnvironment(),
        encoding: "utf8",
        timeout: 10_000,
        shell: false,
      },
      (error) => resolve(!error)
    );
  });
}
