/**
 * [INPUT]: Depends on the recipe/run contracts, the workspace leases, the Base action ports, the binding store, the run ledger, the step-result intake and the evidence store (types only).
 * [OUTPUT]: Provides the executor's port and value types: AgentDispatch, ExecutorPorts, SettledTurn, and the internal Turn, StepEvidence, ForceStopGroup and ExtractorBlock.
 * [POS]: workflows/executor's shared vocabulary; index.ts and its sibling modules import it, the runtime composition imports the public ones through index.ts.
 */
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import type { BlockedReason, EXTRACTOR_BLOCKS, WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import type { BaseActionPorts } from "../base-actions";
import type { WorkflowBindingStore } from "../bindings";
import type { WorkflowRunLedger } from "../ledger";
import type { WorkspaceLeases } from "../runtime/workspace-leases";
import type { StepResultIntake } from "../step-results";
import type { CodeEvidence, CommandEvidence, EvidenceStore } from "../evidence";

export type ForceStopGroup = WorkflowRun["forceStopGroups"][number];
/** Headroom kept under the Chat message limit for the separators between instructions, prompt and evidence. */
export type ExtractorBlock = Exclude<(typeof EXTRACTOR_BLOCKS)[number], "failed">;
export type AgentDispatch = {
  /** Submits one turn into the record × role Chat through the Chat machinery; the request id must be the one given. */
  dispatch(input: { runId: string; stepId: string; role: WorkflowRoleName; record: WorkflowRun["record"];
    /** The attempt's 1-based number within its step: with run, step and role it is the turn's workflow origin. */
    attempt: number; requestId: string; prompt: string;
    /** The task name, for the title of the record × role Chat when this turn creates it. */
    task: string; config: unknown }): Promise<{ chatId: string; incarnationId: string }>;
  /** Stops a running turn (cancel). */
  stop(requestId: string): Promise<void>;
  /** Force stop: kills the turn's whole process tree and says whether it is confirmed gone; one that is not names its group (pid + birth). */
  forceKill(requestId: string): Promise<{ outcome: "gone" | "absent" } | { outcome: "survived"; group: ForceStopGroup }>;
  /** The one check on a group left unconfirmed (retry and startup alike): gone or reused is ended, still ours is killed, none is unknown. */
  verifyGroup(group: ForceStopGroup): Promise<"gone" | "survived" | "unknown">;
  /**
   * What still holds this request's process, by the turn's launch identity (custody's pid + birth): a live turn or a custody entry
   * not yet released is `held` (its group, or null when it has none yet); `none` is proof nothing of it runs — custody records
   * its intent before any spawn, so no entry means no process.
   */
  processOf(requestId: string): Promise<{ state: "none" } | { state: "held"; group: ForceStopGroup }>;
};
export type ExecutorPorts = {
  ledger: WorkflowRunLedger; bindings: WorkflowBindingStore; base: BaseActionPorts; intake: StepResultIntake; agent: AgentDispatch;
  /** Role admission for this computer (04 §5): the Provider must be on, installed, signed in and proven to take the role. */
  admit(role: WorkflowRoleName, config: unknown, workspace?: string | null): Promise<{ admitted: true } | { admitted: false; reason: BlockedReason["kind"]; guarantee?: BlockedReason["guarantee"] }>;
  newRequestId(): string;
  /** The Chat of a role for a record, when it exists (review reads the development one, TASK-18). */
  chatOf(record: WorkflowRun["record"], role: WorkflowRoleName): string | null;
  /**
   * W9's format extractor: Claude alone, with no tools, no workspace and no write access, given only the turn's own result and
   * the report schema, on `provider`. `readiness` says why it cannot run (never a fallback to a session with tools); `extract` is one call.
   */
  formatExtractor: { provider: string; readiness(): Promise<ExtractorBlock | null>; extract(source: string): Promise<unknown> };
  /** A desktop reminder about a waiting confirmation (Q16); opening it only shows the confirmation, it never decides. */
  notify(input: { runId: string; stepId: string; reminder: "started" | "final-hour" }): void;
  /** Review evidence (W16): the record's workspace and the evidence store. */
  workspaceOf(run: WorkflowRun): string | null;
  /** A-07: one durable writer lease per canonical workspace. */
  leases: Pick<WorkspaceLeases, "acquire" | "release" | "list" | "holder">;
  /** A-04: the Workflow plugin; off, no run takes its next step. */
  workflowEnabled(): boolean;
  evidence: EvidenceStore;
};
export type StepEvidence = { code: CodeEvidence | null; commands: CommandEvidence[] | null };
export type Turn = { runId: string; stepId: string; role: WorkflowRoleName; attemptId: string; chatId: string; incarnationId: string };
/** What a turn's end looks like to the latch (06 §4): terminal, durable, and whether its process and leases are cleaned up. */
export type SettledTurn = { requestId: string; terminal: "done" | "cancelled" | "error"; outcome: "stored" | "empty" | "missing" | "fatal"; cleanup: "pending" | "complete" | "failed";
  /** The commands the turn really ran, from its recorded tool calls (null when unknown). */
  commands: CommandEvidence[] | null;
  /** The turn's final answer as stored, for W9 when it submitted no report. */
  assistantText?: string | null };
