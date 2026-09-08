/**
 * [INPUT]: Depends on the trusted manual submission contract, submission/precondition schemas, canonical hashing, and prepared turn types
 * [OUTPUT]: Re-validates submissions at admission, creates text-only prepared turns, and strips binary payloads
 * [POS]: Text-only boundary for prepared-manual-turn; binary staging and hydration live in the primary admission module and prepared/ respectively
 */

import type {
  AgentSendPayload,
  PreparedSkillSelectionReceipt,
} from "../../../../../shared/agent-ipc";
import type {
  TrustedManualTurnSubmission as ManualTurnSubmission,
} from "../../../../../shared/sections-ipc";
import {
  incarnationPreconditionSchema,
  submissionContentV1Schema,
  workspacePreconditionSchema,
  type SubmissionContentV1,
} from "../../../../../shared/submission";
import type { TurnProjectContext } from "../../../../../shared/product-resource-scope";
import { skillsTurnOwnerId } from "../../../skills-management/turn-custody";
import { canonicalHash } from "../coordinator-values";
import type {
  PreparedInputItem,
  PreparedManualTurn,
  PreparedPersistence,
} from "./prepared-manual-turn";
import { emptyProjectToolsReceipt } from "./prepared-project-tools";

/** Re-parses the strict capsule fields so an in-process caller cannot hand admission an unvalidated shape. */
export function normalizeManualSubmission(
  submission: ManualTurnSubmission
): ManualTurnSubmission {
  const content = submissionContentV1Schema.parse(submission.content);
  const precondition = incarnationPreconditionSchema.parse(submission.precondition);
  const workspacePrecondition = workspacePreconditionSchema.parse(
    submission.workspacePrecondition
  );
  const persistence = submission.persistence.kind === "append"
    ? {
        ...submission.persistence,
        input: { ...submission.persistence.input, precondition },
      }
    : submission.persistence;
  return { ...submission, persistence, content, precondition, workspacePrecondition };
}

export function prepareTextOnlyManualTurn(
  submission: ManualTurnSubmission,
  lifecycleProjectId = inferredLifecycleProjectId(submission)
): PreparedManualTurn {
  const { input: raw, ...turn } = submission.turn;
  if (raw.some((item) => item.type !== "text")) {
    throw new Error("测试/降级 preparation 只接受文本输入");
  }
  const projectContext: TurnProjectContext = lifecycleProjectId
    ? { projectId: lifecycleProjectId, projectLifecycleRevision: 1 }
    : { projectId: null, projectLifecycleRevision: null };
  const body = {
    agentSwitch: submission.agentSwitch,
    expectedAgentRevision: submission.expectedAgentRevision,
    intentId: submission.intentId,
    persistence: submission.persistence as PreparedPersistence,
    turn,
    input: raw as PreparedInputItem[],
    content: binaryFreeSubmissionContent(submission.content),
    precondition: submission.precondition,
    workspacePrecondition: workspacePreconditionSchema.parse(
      submission.workspacePrecondition
    ),
    lifecycleProjectId,
    projectContext,
    projectTools: emptyProjectToolsReceipt(projectContext),
    skillSelection: emptyPreparedSkillSelection(
      submission.turn.requestId,
      submission.turn.turnOptions.backend,
      Boolean(submission.turn.planMode),
      projectContext
    ),
    stagingDir: "",
  };
  return { ...body, contentHash: canonicalHash(body) };
}

export function binaryFreeSubmissionContent(
  content: SubmissionContentV1
): SubmissionContentV1 {
  return submissionContentV1Schema.parse({
    ...content,
    content: {
      ...content.content,
      files: content.content.files.map((file) => {
        const { url: _url, nativeFile: _nativeFile, ...metadata } = file as
          typeof file & { nativeFile?: unknown };
        return metadata;
      }),
    },
  });
}

export function emptyPreparedSkillSelection(
  requestId: string,
  backend: AgentSendPayload["turnOptions"]["backend"],
  planMode: boolean,
  projectContext: TurnProjectContext
): PreparedSkillSelectionReceipt {
  return {
    refOwnerId: skillsTurnOwnerId(requestId),
    backend,
    planMode,
    projectContext: structuredClone(projectContext),
    visibleInventoryVersion: "prepared:no-extension-inventory",
    candidates: [],
  };
}

function inferredLifecycleProjectId(submission: ManualTurnSubmission) {
  if (submission.persistence.kind !== "append") {
    return submission.persistence.input.projectId ?? null;
  }
  return submission.workspacePrecondition.kind === "project"
    ? submission.workspacePrecondition.projectId
    : null;
}
