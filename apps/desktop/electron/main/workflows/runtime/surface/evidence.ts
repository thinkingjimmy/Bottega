/**
 * [INPUT]: A locally owned workflow run and the content-addressed evidence store.
 * [OUTPUT]: The same 4 KiB evidence pages for desktop IPC and encrypted remote read commands, clipped at 64 KiB.
 * [POS]: Evidence disclosure boundary beside workflow IPC; callers never supply a filesystem reference.
 */
import { createHash } from "node:crypto";
import type { WorkflowRun } from "@bottega/contracts/workflow/run";
import type { WorkflowEvidencePage } from "@bottega/contracts/workflow/bridge";
import { cutUtf8 } from "@ai-chat/cloud-protocol/workflows/projection";
import type { EvidenceStore, CodeEvidence } from "../../evidence";

const VIEW_BYTES = 65_536, PAGE_BYTES = 4096;
export async function readWorkflowEvidence(run: WorkflowRun | null, store: EvidenceStore, stepId: string, kind: "diff" | "report", offset: number): Promise<WorkflowEvidencePage> {
  if (!run) throw new Error("workflow-run-not-found");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= VIEW_BYTES || offset % PAGE_BYTES !== 0) throw new Error("workflow-evidence-unavailable");
  const step = run.steps.find(step => step.stepId === stepId);
  const output = step?.output as { result?: string; evidence?: { code?: CodeEvidence } } | null;
  let text: string, partial = false;
  if (kind === "report") {
    const report = [...(step?.attempts ?? [])].reverse().find(attempt => attempt.report)?.report;
    const result = output?.result ?? report?.result;
    if (typeof result !== "string") throw new Error("workflow-evidence-unavailable");
    text = result;
  } else {
    const code = output?.evidence?.code;
    if (!code?.diff.ref || !["included", "partial"].includes(code.diff.state)) throw new Error("workflow-evidence-unavailable");
    text = await store.readVerified(code.diff.ref);
    partial = code.diff.state === "partial";
  }
  const bytes = Buffer.from(cutUtf8(text, VIEW_BYTES)), totalBytes = Buffer.byteLength(text);
  if (offset > bytes.length || totalBytes > 2 * 1024 * 1024) throw new Error("workflow-evidence-unavailable");
  const end = Math.min(bytes.length, offset + PAGE_BYTES);
  return { kind, offset, chunk: bytes.subarray(offset, end).toString("base64url"), nextOffset: end < bytes.length ? end : null,
    totalBytes, digest: createHash("sha256").update(bytes).digest("hex"), truncated: partial || totalBytes > bytes.length };
}
