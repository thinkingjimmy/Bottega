/**
 * [INPUT]: Depends on legacy/manual submission contracts, Section incarnation lookup, canonical hashing, and prepared turn types
 * [OUTPUT]: Normalizes legacy submissions, creates text-only prepared turns, strips binary payloads, and validates prepared content hashes
 * [POS]: Compatibility and text-only fixture boundary for prepared-manual-turn; binary staging and hydration stay in the primary admission module
 */

import type {
  AgentSendPayload,
  PreparedSkillSelectionReceipt,
} from "../../../../../shared/agent-ipc";
import { preparedSubmissionV1Schema } from "../../../../../shared/gallery-submission";
import type {
  TrustedManualTurnSubmission as ManualTurnSubmission,
} from "../../../../../shared/sections-ipc";
import {
  incarnationPreconditionSchema,
  submissionContentV1Schema,
  workspacePreconditionSchema,
  type IncarnationPrecondition,
  type SubmissionContentV1,
} from "../../../../../shared/submission";
import type { TurnProjectContext } from "../../../../../shared/product-resource-scope";
import { skillsTurnOwnerId } from "../../../skills-management/turn-custody";
import { canonicalHash } from "../coordinator-values";
import type {
  PreparationDependencies,
  PreparedInputItem,
  PreparedManualTurn,
  PreparedPersistence,
} from "./prepared-manual-turn";
import { emptyProjectToolsReceipt } from "./prepared-project-tools";

type LegacyManualTurnSubmission = Omit<
  ManualTurnSubmission,
  "content" | "precondition" | "workspacePrecondition"
> & {
  content?: unknown;
  precondition?: unknown;
  workspacePrecondition?: unknown;
  gallery?: unknown;
};

export async function normalizeManualSubmission(
  input: ManualTurnSubmission,
  dependencies: Pick<PreparationDependencies, "sections">
): Promise<ManualTurnSubmission> {
  const legacy = input as unknown as LegacyManualTurnSubmission;
  const content = legacy.content === undefined
    ? legacySubmissionContent(legacy)
    : submissionContentV1Schema.parse(legacy.content);
  const precondition = legacy.precondition === undefined
    ? await legacyPrecondition(legacy, dependencies)
    : incarnationPreconditionSchema.parse(legacy.precondition);
  const workspacePrecondition = workspacePreconditionSchema.parse(
    legacy.workspacePrecondition
  );
  const persistence = legacy.persistence.kind === "append"
    ? {
        ...legacy.persistence,
        input: { ...legacy.persistence.input, precondition },
      }
    : legacy.persistence;
  const { gallery: _legacyGallery, ...submission } = legacy;
  return {
    ...submission,
    persistence,
    content,
    precondition,
    workspacePrecondition,
  } as ManualTurnSubmission;
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

export function assertPreparedContentHash(prepared: PreparedManualTurn) {
  const { contentHash, ...body } = prepared;
  if (contentHash !== canonicalHash(body)) {
    throw new Error("PreparedManualTurn content hash 冲突");
  }
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

function legacySubmissionContent(
  submission: LegacyManualTurnSubmission
): SubmissionContentV1 {
  const gallery = submission.gallery === undefined
    ? undefined
    : preparedSubmissionV1Schema.parse(submission.gallery);
  const displayText = gallery?.message.displayText ??
    ("firstMessage" in submission.persistence.input
      ? submission.persistence.input.firstMessage.content
      : submission.persistence.input.message.content);
  return submissionContentV1Schema.parse({
    schemaVersion: 1,
    content: {
      richValue: gallery?.message.richValue ?? [{
        id: `legacy_${submission.intentId}`,
        type: "text",
        value: displayText,
      }],
      displayText,
      files: gallery?.message.files ?? [],
    },
    origin: "composer",
    capabilityEpoch: gallery?.capabilityEpoch ?? 0,
    backendEpoch: gallery?.backendEpoch ?? 0,
    ...(gallery ? {
      gallery: {
        schemaVersion: 1,
        attachments: gallery.galleryAttachments,
      },
    } : {}),
  });
}

async function legacyPrecondition(
  submission: LegacyManualTurnSubmission,
  dependencies: Pick<PreparationDependencies, "sections">
): Promise<IncarnationPrecondition> {
  if (submission.persistence.kind === "append") {
    const record = await dependencies.sections.get(submission.persistence.input.chatId);
    if (!record) throw new Error("INCARNATION_MISMATCH");
    return { kind: "existing", incarnationId: record.incarnationId };
  }
  const proposedIncarnationId = submission.persistence.input.incarnationId;
  if (!proposedIncarnationId) {
    throw new Error("旧提交缺少 proposedIncarnationId，迁移保持只读");
  }
  return { kind: "absent", proposedIncarnationId };
}
