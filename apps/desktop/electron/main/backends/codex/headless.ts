/**
 * [INPUT]: Depends on codex runtime codexEnvironment, user credential root, authorized processEnv and General HeadlessJob/ExecutionSpec agreement
 * [OUTPUT]: Provides codexHeadlessSpec, translates the title/processEnv HeadlessJob into codex exec JSONL command line, declares credentialRoots and parses the agent_message end value;
 *           prompt does not enter the argv file executor Unified by stdin Deliver and close ((codex uninterrupted reading instructions from stdin)
 * [POS]: The Codex descriptor is a translation layer that is not guarded by anyone; CLI is responsible for the protocol parameters only
 *        readRoots/WriteRoot/Network is required by the executor's Unified macOS seatbelt, title open with toolPolicy: none + read-only
 */

import { codexEnvironment } from "../../codex-runtime";
import { codexHome } from "../sandbox/fences";
import type {
  HeadlessExecutionSpec,
  HeadlessJob,
  HeadlessParserState,
  ResolvedRuntime,
} from "../types";

// ─── JSONL 解析：只认 item.completed/agent_message 终值，其余行静默 ───
function parseEventLine(
  line: string,
  state: HeadlessParserState,
  wantsJson: boolean
) {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  const record = event as {
    type?: string;
    item?: { type?: string; text?: string };
  };
  if (record.type !== "item.completed") return;
  if (record.item?.type !== "agent_message") return;
  state.text = record.item.text ?? "";
  if (!wantsJson) return;
  try {
    state.json = JSON.parse(state.text);
  } catch {
    state.json = undefined;
  }
}

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
      parseEventLine(line, state, Boolean(job.outputSchema)),
  };
}
