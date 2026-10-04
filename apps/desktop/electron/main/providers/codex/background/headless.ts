/**
 * [INPUT]: Depends on codex environment.ts codexEnvironment, user credential root, authorized processEnv and General HeadlessJob/ExecutionSpec agreement
 * [OUTPUT]: Provides codexHeadlessSpec, translating a HeadlessJob's purpose/processEnv into a `codex exec` JSONL command line, declaring credentialRoots, parsing the terminal agent_message value, and keeping an error item as cause-of-death evidence only when no message text ever arrives;
 *           the prompt is never passed as argv — it is written to stdin and the stream is closed (codex reads instructions from stdin until EOF)
 * [POS]: Unguarded translation layer for the Codex descriptor; the CLI is trusted only for protocol parameters.
 *        readRoots/sandbox/network are enforced by the shared macOS seatbelt in the executor; a job opened with toolPolicy: none is read-only
 */

import { codexEnvironment } from "../environment";
import { codexHeadlessParseLine } from "../turn-config";
import { codexHome } from "../../../backends/sandbox/fences";
import type {
  HeadlessExecutionSpec,
  HeadlessJob,
  ResolvedRuntime,
} from "../../../backends/types";


export function codexHeadlessSpec(
  job: HeadlessJob,
  runtime: ResolvedRuntime
): HeadlessExecutionSpec {
  if (job.env === "isolated-home" && !job.homeDir) {
    throw new Error("Codex isolated-home headless job 缺少 homeDir");
  }
  const args = [
    "exec",
    "--json",
    "--color",
    "never",
    "--skip-git-repo-check",
    "-C",
    job.cwd,
    "-s",
    job.sandbox,
    "-c",
    'approval_policy="never"',
    ...(job.ephemeral ? ["--ephemeral"] : []),
    ...(job.ignoreUserConfig
      ? ["--ignore-user-config", "--ignore-rules"]
      : []),
    ...(job.model ? ["--model", job.model] : []),
    ...(job.outputSchema ? ["--output-schema", job.outputSchema] : []),
    ...(job.sandbox === "workspace-write"
      ? ["-c", `sandbox_workspace_write.network_access=${job.network}`]
      : []),
  ];
  const env = codexEnvironment(
    runtime,
    job.env === "isolated-home" ? job.homeDir : undefined
  );
  Object.assign(env, job.processEnv);
  return {
    command: runtime.executable,
    args,
    env,
    credentialRoots: [codexHome(env)],
    parseLine: (line, state) =>
      codexHeadlessParseLine(line, state, Boolean(job.outputSchema)),
  };
}
