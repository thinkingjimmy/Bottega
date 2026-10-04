/**
 * [INPUT]: Depends on the report contract and its schema, step-results' model-free extraction and derived-report sanitising, the run ledger and the format extractor ports, and providerOf.
 * [OUTPUT]: Provides repairReport: W9's repair of a clean turn that submitted no report.
 * [POS]: workflows/executor's report repair, called from index.ts's latch; it never reopens the turn's writable session.
 */
import { stepReportSchema, type StepReport } from "@ai-chat/cloud-protocol/contracts/workflow/report";
import type { BlockedReason, EXTRACTOR_BLOCKS, WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import { extractReportFromText, reportDigest, sanitizeDerivedReport } from "../step-results";
import { providerOf } from "./reasons";
import type { ExecutorPorts, Turn } from "./types";

/**
 * W9 (06 §4): the model-free extraction first; then at most two format-extractor calls, each counted on the attempt before it
 * runs. A derived report keeps only references the turn's own result contained, is marked derived, and leaves the turn's real
 * terminal untouched. When the extractor cannot run the step stays blocked, saying why.
 */
export async function repairReport(ports: Pick<ExecutorPorts, "ledger" | "formatExtractor">, run: WorkflowRun, turn: Turn, attempt: WorkflowRun["steps"][number]["attempts"][number], source: string | null):
  Promise<{ report: StepReport } | { blocked: BlockedReason }> {
  const blocked = (extractor: (typeof EXTRACTOR_BLOCKS)[number] | null) => ({ blocked: { kind: "no-valid-report" as const, provider: extractor ? ports.formatExtractor.provider : providerOf(run.configs[turn.role]),
    role: turn.role, cause: null, action: null, failure: null, extractor } });
  if (!source?.trim()) return blocked(null);
  const record = async (report: StepReport, verbatim = true) => {
    const derived = sanitizeDerivedReport(report, source, verbatim);
    await ports.ledger.recordReport(run.runId, turn.stepId, turn.attemptId, derived, reportDigest(derived), true);
    return { report: derived };
  };
  const direct = extractReportFromText(source);
  if (direct) return record(direct, false);
  const unavailable = await ports.formatExtractor.readiness();
  if (unavailable) return blocked(unavailable);
  for (let spent = attempt.extractions; spent < 2; spent++) {
    await ports.ledger.countExtraction(run.runId, turn.stepId, turn.attemptId);
    const parsed = stepReportSchema.safeParse(await ports.formatExtractor.extract(source).catch(() => null));
    if (parsed.success) return record(parsed.data);
  }
  return blocked("failed");
}
