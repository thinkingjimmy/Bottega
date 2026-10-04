/**
 * [INPUT]: Depends on the step-report contract, the canonical request digest and a sink that records a report on the run ledger.
 * [OUTPUT]: Provides StepResultIntake (expect / release / submit), installStepResultIntake, createWorkflowToolset (the submit_step_result and read_step_history handlers),
 *           reportDigest, and the W9 helpers: extractReportFromText (the model-free step), sanitizeDerivedReport (the turn's own words and
 *           references only) and truncateWithNote (an explicit, never silent, cut).
 * [POS]: The receiving end of an agent step's report (W6–W8). The executor says which turn owes which run/step/attempt before it submits the turn; the handler trusts only the turn's lease — request id, Chat and incarnation — never anything the Agent passes, and the ledger decides replay, conflict and staleness.
 */
import { requestDigest } from "@ai-chat/cloud-protocol/contracts/canonical";
import { stepReportSchema, type StepReport } from "@ai-chat/cloud-protocol/contracts/workflow/report";
import type { BuiltinToolset } from "../tools/registry";
import { statusError } from "../ipc/errors";
import { workflowTurnPolicyFor } from "./turn-policy";

export type ExpectedReport = Readonly<{ runId: string; stepId: string; attemptId: string; chatId: string; incarnationId: string }>;
export type ReportSink = { recordReport(runId: string, stepId: string, attemptId: string, report: StepReport, digest: string): Promise<unknown> };
type LeaseIdentity = Readonly<{ requestId: string; chatId: string; incarnationId: string }>;

export class StepResultIntake {
  private readonly expected = new Map<string, ExpectedReport>();
  constructor(private readonly sink: ReportSink) {}
  /** Set before the turn is submitted; the turn's request id is the only key, so no other turn can report for it. */
  expect(requestId: string, report: ExpectedReport) { this.expected.set(requestId, report); }
  release(requestId: string) { this.expected.delete(requestId); }

  async submit(lease: LeaseIdentity, args: unknown) {
    const expected = this.expected.get(lease.requestId);
    if (!expected || expected.chatId !== lease.chatId || expected.incarnationId !== lease.incarnationId) throw new Error("workflow-report-not-expected");
    const report = stepReportSchema.parse(args);
    const digest = reportDigest(report);
    await this.sink.recordReport(expected.runId, expected.stepId, expected.attemptId, report, digest);
    return { accepted: true, receipt: digest };
  }
}

/* The built-in tool registry is composed before the workflow runtime; the runtime installs its intake once it exists. */
let installed: StepResultIntake | null = null;
export function installStepResultIntake(intake: StepResultIntake | null) { installed = intake; }

/**
 * `readSection` is the sections domain's own read_section (paging, byte budget and transcript projection alike); read_step_history
 * only fixes its target: the one development Chat the host linked to this review turn. Any other Chat is refused (TASK-18).
 */
export function createWorkflowToolset(readSection: NonNullable<BuiltinToolset["read_section"]>): BuiltinToolset {
  return {
    submit_step_result: (args, context) => {
      if (!installed) throw new Error("workflow-runtime-unavailable");
      return installed.submit(context.lease, args);
    },
    read_step_history: (args, context) => {
      const linked = workflowTurnPolicyFor(context.lease.requestId)?.historyChatId;
      const asked = (args as { chat_id?: string }).chat_id;
      if (!linked || (asked !== undefined && asked !== linked)) throw statusError(403, "workflow-history-not-linked");
      return readSection({ section_id: linked, ...((args as { from_seq?: number }).from_seq !== undefined ? { from_seq: (args as { from_seq: number }).from_seq } : {}) }, context);
    },
  };
}

export const reportDigest = (report: StepReport) => requestDigest(report);

/**
 * W9, the model-free step: a turn that ended without submitting may still have written its report as JSON — the whole
 * answer, or a fenced block. Only a report that validates is taken; prose is never guessed into one.
 */
export function extractReportFromText(text: string): StepReport | null {
  const candidates = [text.trim(), ...[...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map(match => match[1]!.trim())];
  for (const candidate of candidates.reverse()) {
    if (!candidate.startsWith("{")) continue;
    try {
      const parsed = stepReportSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch { /* not JSON */ }
  }
  return null;
}

const RESULT_LIMIT = 65_536;
export const TRUNCATION_NOTE = "\n\n[Truncated by Bottega. The full text is in this step's Chat.]";
/** Cut to `limit` characters and say so, never silently (W9). */
export function truncateWithNote(text: string, limit: number) {
  return text.length <= limit ? text : `${text.slice(0, limit - TRUNCATION_NOTE.length)}${TRUNCATION_NOTE}`;
}

/**
 * A derived report is the turn's own words (06: extraction cannot invent). Its references must appear in the turn's result;
 * a `result` the extractor wrote is kept only when it appears there verbatim, otherwise the turn's result itself is used —
 * so a rewrite, a summary or an injected "tests passed" never reaches a confirmation. `verbatim` is false only for the
 * model-free path, where the Agent wrote the report itself.
 */
export function sanitizeDerivedReport(report: StepReport, source: string, verbatim = true): StepReport {
  const artifactRef = report.artifactRef && source.includes(report.artifactRef) ? report.artifactRef : undefined;
  const evidenceRefs = report.evidenceRefs?.filter(ref => source.includes(ref));
  const claimed = report.result.trim();
  const result = !verbatim || (claimed && source.includes(claimed)) ? report.result : source.trim();
  return { result: truncateWithNote(result, RESULT_LIMIT), ...(artifactRef ? { artifactRef } : {}), ...(evidenceRefs?.length ? { evidenceRefs } : {}) };
}

