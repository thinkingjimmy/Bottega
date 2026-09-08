/**
 * [INPUT]: Depends on shared compiler budgets, the strict inner request and canonical policy hashing
 * [OUTPUT]: Provides Windows v2 policy/control frames and operation-bound resource/release result validation
 * [POS]: Host side of the native wrapper contract; schema validation never substitutes for native isolation probes
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { APP_GUI_BUILD_BUDGET } from "../contracts";
import { canonicalDigest } from "../../support";
import { compilerRequestSchema, encodeCompilerRequest, encodeJsonFrame, type CompilerRequest } from "./request";

const WINDOWS_POLICY_SCHEMA = "bottega.compiler-windows-policy/v2";
export const WINDOWS_POLICY_BYTES = 2 * 1024 * 1024;
export const WINDOWS_RELEASE_TIMEOUT_MS = 2_000;
const windowsCompilerControlSchema = z.object({
  schema: z.literal("bottega.compiler-windows-control/v2"),
  operationId: z.string().uuid(), policyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  action: z.literal("cancel"), reason: z.enum(["aborted", "wall", "stdout", "stderr"]),
}).strict();
export type WindowsCompilerStop = z.infer<typeof windowsCompilerControlSchema>["reason"];

export function encodeWindowsCompilerControl(expected: ReturnType<typeof createWindowsCompilerPolicy>, reason: WindowsCompilerStop) {
  return encodeJsonFrame(windowsCompilerControlSchema.parse({
    schema: "bottega.compiler-windows-control/v2", operationId: expected.policy.operationId,
    policyDigest: expected.policyDigest, action: "cancel", reason,
  }), 1024);
}
const path = z.string().min(1).max(32_768).refine((value) => !value.includes("\0"));
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const budgetsSchema = z.object({
  wallTimeMs: positive.max(APP_GUI_BUILD_BUDGET.wallTimeMs),
  cpuTimeMs: positive.max(APP_GUI_BUILD_BUDGET.cpuTimeMs),
  peakProcessRssBytes: positive.max(APP_GUI_BUILD_BUDGET.rssBytes),
  processCount: positive.max(APP_GUI_BUILD_BUDGET.processCount),
}).strict();

const windowsCompilerPolicySchema = z.object({
  schema: z.literal(WINDOWS_POLICY_SCHEMA), operationId: z.string().uuid(),
  readOnly: z.array(path).min(1).max(1024), writable: z.array(path).length(2),
  executable: z.array(path).min(1).max(4), network: z.literal("deny"),
  command: z.object({ executable: path, args: z.array(path).length(1) }).strict(),
  request: compilerRequestSchema, budgets: budgetsSchema,
}).strict();

export type CompilerLimits = Readonly<{ wallTimeMs?: number; rssBytes?: number; cpuTimeMs?: number; processCount?: number }>;

export function compilerBudgets(limits: CompilerLimits = {}) {
  return budgetsSchema.parse({
    wallTimeMs: limits.wallTimeMs ?? APP_GUI_BUILD_BUDGET.wallTimeMs,
    cpuTimeMs: limits.cpuTimeMs ?? APP_GUI_BUILD_BUDGET.cpuTimeMs,
    peakProcessRssBytes: limits.rssBytes ?? APP_GUI_BUILD_BUDGET.rssBytes,
    processCount: limits.processCount ?? APP_GUI_BUILD_BUDGET.processCount,
  });
}

export function createWindowsCompilerPolicy(input: {
  readOnly: string[]; writable: string[]; executable: string[];
  nodeExecutable: string; compilerEntry: string; request: CompilerRequest; limits?: CompilerLimits;
}) {
  encodeCompilerRequest(input.request);
  const policy = windowsCompilerPolicySchema.parse({
    schema: WINDOWS_POLICY_SCHEMA, operationId: randomUUID(), readOnly: input.readOnly,
    writable: input.writable, executable: input.executable, network: "deny",
    command: { executable: input.nodeExecutable, args: [input.compilerEntry] },
    request: input.request, budgets: compilerBudgets(input.limits),
  });
  const policyDigest = canonicalDigest(policy);
  return { policy, policyDigest, frame: encodeJsonFrame({ policy, policyDigest }, WINDOWS_POLICY_BYTES) };
}

const resultSchema = z.object({
  schema: z.literal("bottega.compiler-windows-result/v2"), operationId: z.string().uuid(),
  policyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), budgets: budgetsSchema,
  mechanism: z.enum(["job-appcontainer", "job-lpac"]),
  released: z.literal(true), activeProcesses: z.literal(0),
  measurementSource: z.literal("GetProcessMemoryInfo+QueryInformationJobObject"),
  peakProcessRssBytes: z.number().nonnegative(), cpuTimeMs: z.number().nonnegative(), wallTimeMs: z.number().nonnegative(),
  peakProcesses: z.number().int().nonnegative(),
  /* 单进程峰值 RSS 是唯一内存预算；Job commit 只是诊断读数，没有对应的 limit。 */
  jobCommitBytes: z.number().nonnegative().optional(),
  limit: z.enum(["rss", "cpu", "process", "wall", "aborted", "stdout", "stderr"]).nullable(),
  exitCode: z.number().int(), stdout: z.string().max(APP_GUI_BUILD_BUDGET.stdoutBytes),
}).strict();

export function verifyWindowsCompilerResult(value: unknown, expected: ReturnType<typeof createWindowsCompilerPolicy>, stop?: WindowsCompilerStop) {
  const result = resultSchema.parse(value);
  if (result.operationId !== expected.policy.operationId || result.policyDigest !== expected.policyDigest ||
      canonicalDigest(result.budgets) !== canonicalDigest(expected.policy.budgets)) throw new Error("Windows compiler policy/result mismatch");
  const limits = result.budgets;
  const exceeded = result.peakProcessRssBytes > limits.peakProcessRssBytes || result.cpuTimeMs > limits.cpuTimeMs ||
    result.peakProcesses > limits.processCount || result.wallTimeMs > limits.wallTimeMs;
  if ((result.limit === null && exceeded) || (result.limit !== null && result.exitCode === 0)) {
    throw new Error("Windows compiler success contradicts its resource report");
  }
  if ((result.limit === "rss" && result.peakProcessRssBytes <= limits.peakProcessRssBytes) ||
      (result.limit === "cpu" && result.cpuTimeMs <= limits.cpuTimeMs) ||
      (result.limit === "process" && result.peakProcesses <= limits.processCount) ||
      (result.limit === "wall" && stop !== "wall" && result.wallTimeMs < limits.wallTimeMs)) {
    throw new Error("Windows compiler limit has no corresponding measurement");
  }
  if ((result.limit === "aborted" || result.limit === "stdout" || result.limit === "stderr") && result.limit !== stop) {
    throw new Error("Windows compiler reported an unrequested control outcome");
  }
  if (Buffer.byteLength(result.stdout) > APP_GUI_BUILD_BUDGET.stdoutBytes) throw new Error("Windows compiler stdout exceeds its byte budget");
  return result;
}
