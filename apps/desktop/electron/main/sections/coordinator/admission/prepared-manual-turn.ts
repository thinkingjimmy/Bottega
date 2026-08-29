/**
 * [INPUT]: Depends on Node filesystem/crypto, manual submission contracts, canonical Project context, frozen Project Tools and Skill selections, fresh input resolution, Section snapshots, and workspace preconditions
 * [OUTPUT]: Provides hash-sealed PreparedManualTurn staging with exact Project/Tools/Skill receipts plus hydration, release, quota accounting, and reconciliation
 * [POS]: Coordinator admission boundary; durable workspace, Project tool policy, and Extension generation identity precede every manual backend turn
 */

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  AgentSendPayload,
  AgentUserInput,
  AgentWorkspaceScope,
  PreparedSkillSelectionReceipt,
} from "../../../../../shared/agent-ipc";
import type {
  ChatAttachmentPayload,
  ChatRecord,
} from "../../../../../shared/chats-ipc";
import type {
  TrustedManualTurnPersistence as ManualTurnPersistence,
  TrustedManualTurnSubmission as ManualTurnSubmission,
} from "../../../../../shared/sections-ipc";
import {
  workspacePreconditionSchema,
  type IncarnationPrecondition,
  type SubmissionContentV1,
  type WorkspacePrecondition,
} from "../../../../../shared/submission";
import type { ResolvedAgentInput } from "../../../backends/types";
import { backendRuntimeRegistry } from "../../../backends";
import type {
  FileAuthorizationStore,
  FileReservation,
} from "../../../file-authorizations";
import type { SkillsCatalog } from "../../../skills-catalog";
import {
  removeReadonlySnapshot,
  stageFileSnapshot,
  stageSkillPackageSnapshot,
} from "../../../agent-input";
import { exportSectionSnapshotDraft } from "../../export-transcript";
import {
  assertCopyFidelity,
  planSectionSnapshots,
  type SectionSnapshotPlan,
} from "../../../../../shared/section-attachments";
import { canonicalHash } from "../coordinator-values";
import type { TurnProjectContext } from "../../../../../shared/product-resource-scope";
import { skillsTurnOwnerId } from "../../../skills-management/turn-custody";
import {
  acquirePreparedSkillReferences,
  assertPreparedSkillReferences,
  releasePreparedSkillReferences,
} from "./prepared-skill-reference-custody";
import {
  assertPreparedContentHash,
  binaryFreeSubmissionContent,
  emptyPreparedSkillSelection,
  normalizeManualSubmission,
} from "./prepared-manual-legacy";
import {
  emptyProjectToolsSnapshot,
  hydrateProjectToolsReceipt,
  stageProjectToolsReceipt,
  type ExplicitSkillRequirementReceipt,
  type FrozenProjectToolsReceipt,
  type ProjectToolsPreparationSnapshot,
} from "./prepared-project-tools";

export { configurePreparedSkillReferenceCustody } from "./prepared-skill-reference-custody";
export {
  assertPreparedContentHash,
  prepareTextOnlyManualTurn,
} from "./prepared-manual-legacy";

const STAGED_BLOB_QUOTA = 2 * 1024 * 1024 * 1024;

type StagedBlobRef = {
  blobId: string;
  kind: "image" | "file" | "skill";
  path: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
};

export type PreparedInputItem =
  | {
      type: "text";
      text: string;
      resolvedOnly?: true;
      originalSection?: Extract<AgentUserInput, { type: "section" }>;
    }
  | { type: "image"; blob: StagedBlobRef; resolvedOnly?: true }
  | { type: "mention"; name: string; blob: StagedBlobRef; resolvedOnly?: true }
  | { type: "skill"; name: string; blob: StagedBlobRef; resolvedOnly?: true };

type PreparedCreate = Omit<
  Extract<ManualTurnPersistence, { kind: "create" }>["input"],
  "attachmentPayloads"
> & { attachmentPayloads?: StagedBlobRef[] };
type PreparedCreateApp = Omit<
  Extract<ManualTurnPersistence, { kind: "create-app" }>["input"],
  "attachmentPayloads"
> & { attachmentPayloads?: StagedBlobRef[] };
type PreparedAppend = Omit<
  Extract<ManualTurnPersistence, { kind: "append" }>["input"],
  "attachmentPayloads"
> & { attachmentPayloads?: StagedBlobRef[] };
type PreparedAdopt = Omit<
  Extract<ManualTurnPersistence, { kind: "adopt" }>["input"],
  "attachmentPayloads"
> & { attachmentPayloads?: StagedBlobRef[] };

export type PreparedPersistence =
  | { kind: "create"; input: PreparedCreate }
  | { kind: "create-app"; input: PreparedCreateApp }
  | { kind: "adopt"; input: PreparedAdopt }
  | { kind: "append"; input: PreparedAppend };

export type PreparedManualTurn = {
  intentId: string;
  persistence: PreparedPersistence;
  turn: Omit<AgentSendPayload, "input">;
  content: SubmissionContentV1;
  precondition: IncarnationPrecondition;
  workspacePrecondition: WorkspacePrecondition;
  lifecycleProjectId: string | null;
  projectContext: TurnProjectContext;
  projectTools: FrozenProjectToolsReceipt;
  skillSelection: PreparedSkillSelectionReceipt;
  input: PreparedInputItem[];
  stagingDir: string;
  contentHash: string;
};

export type PreparedManualLease = {
  prepared: PreparedManualTurn;
  commit(): void;
  rollback(): Promise<void>;
};

export type PreparationDependencies = {
  workspace: string;
  workspaceScope: AgentWorkspaceScope;
  backend: AgentSendPayload["turnOptions"]["backend"];
  planMode: boolean;
  stagingRoot: string;
  skills: SkillsCatalog;
  files: FileAuthorizationStore;
  lifecycleProjectId: string | null;
  projectContext?: TurnProjectContext;
  projectTools?: ProjectToolsPreparationSnapshot;
  freezeSkillSelection?: (input: Readonly<{
    refOwnerId: string;
    workspace: string;
    backend: AgentSendPayload["turnOptions"]["backend"];
    planMode: boolean;
    projectContext: TurnProjectContext;
  }>) => Promise<PreparedSkillSelectionReceipt>;
  sections: {
    conversationId: string;
    get(chatId: string): Promise<ChatRecord | null>;
    readAttachment?(sectionId: string, attachmentId: string): Promise<string>;
    imageInput?: boolean;
  };
  histories?: {
    export(opaqueId: string): Promise<{ title: string; transcript: string } | null>;
  };
  attachments?: {
    readRevision(
      chatId: string,
      messageId: string
    ): Promise<ChatAttachmentPayload[]>;
  };
};

let stagedBytes = 0;
let quotaTail = Promise.resolve();

const withQuotaLock = async <T>(task: () => T | Promise<T>) => {
  const previous = quotaTail;
  let release!: () => void;
  quotaTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
};

async function reserveBytes(bytes: number) {
  await withQuotaLock(() => {
    if (stagedBytes + bytes > STAGED_BLOB_QUOTA) {
      throw new Error("staged blob 磁盘额度已满");
    }
    stagedBytes += bytes;
  });
}

const releaseBytes = (bytes: number) =>
  withQuotaLock(() => {
    stagedBytes = Math.max(0, stagedBytes - bytes);
  });

const digest = (content: Uint8Array) =>
  createHash("sha256").update(content).digest("hex");

const safeFilename = (value: string) =>
  basename(value).replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 180) || "blob";

async function writeBlob(
  directory: string,
  kind: StagedBlobRef["kind"],
  filename: string,
  mediaType: string,
  content: Uint8Array
) {
  await reserveBytes(content.byteLength);
  const blobId = randomUUID();
  const path = join(directory, `${blobId}-${safeFilename(filename)}`);
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o400 });
    return {
      blobId,
      kind,
      path,
      filename,
      mediaType,
      byteSize: content.byteLength,
      sha256: digest(content),
    } satisfies StagedBlobRef;
  } catch (cause) {
    await releaseBytes(content.byteLength);
    throw cause;
  }
}

const parseDataUrl = (value: string) => {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/s.exec(value);
  if (!match) throw new Error("附件不是合法 base64 data URL");
  return { mediaType: match[1], content: Buffer.from(match[2], "base64") };
};

async function stagePayload(
  directory: string,
  payload: ChatAttachmentPayload
) {
  const decoded = parseDataUrl(payload.dataUrl);
  return writeBlob(
    directory,
    "image",
    payload.filename,
    payload.mediaType || decoded.mediaType,
    decoded.content
  );
}

async function stagePersistence(
  persistence: ManualTurnPersistence,
  directory: string,
  dependencies: PreparationDependencies
): Promise<PreparedPersistence> {
  const payloads =
    persistence.kind === "append" && persistence.input.revise
      ? await dependencies.attachments?.readRevision(
          persistence.input.chatId,
          persistence.input.revise.supersedesUserMessageId
        ) ?? []
      : persistence.input.attachmentPayloads ?? [];
  const refs = await Promise.all(
    payloads.map((payload) =>
      stagePayload(directory, payload)
    )
  );
  const input = {
    ...persistence.input,
    attachmentPayloads: refs.length ? refs : undefined,
  };
  return { kind: persistence.kind, input } as PreparedPersistence;
}

async function stageAuthorizedFile(
  item: Extract<AgentUserInput, { type: "mention" }>,
  directory: string,
  dependencies: PreparationDependencies,
  reservations: FileReservation[]
) {
  const reservation = dependencies.files.reserve(
    item.fileRef,
    dependencies.workspace,
    item.name
  );
  reservations.push(reservation);
  await reserveBytes(reservation.byteSize);
  const blobId = randomUUID();
  const path = join(directory, `${blobId}-${safeFilename(reservation.name)}`);
  try {
    await stageFileSnapshot(
      reservation.path,
      path,
      reservation.byteSize,
      reservation
    );
    return {
      blobId,
      kind: "file",
      path,
      filename: reservation.name,
      mediaType: reservation.mediaType,
      byteSize: reservation.byteSize,
      sha256: await fileHash(path),
    } satisfies StagedBlobRef;
  } catch (cause) {
    await releaseBytes(reservation.byteSize);
    throw cause;
  }
}

async function stageSkill(
  directory: string,
  skill: Awaited<ReturnType<SkillsCatalog["resolveSkill"]>>
) {
  const blobId = randomUUID();
  const packageRoot = join(directory, `${blobId}-skill`);
  let byteSize = 0;
  let reserved = false;
  try {
    const staged = await stageSkillPackageSnapshot(skill, packageRoot);
    const path = staged.path;
    byteSize = staged.totalBytes;
    await reserveBytes(byteSize);
    reserved = true;
    return {
      blobId,
      kind: "skill",
      path,
      filename: "SKILL.md",
      mediaType: "text/markdown",
      byteSize,
      sha256: digest(await readFile(path)),
    } satisfies StagedBlobRef;
  } catch (cause) {
    await removeReadonlySnapshot(packageRoot);
    if (reserved) await releaseBytes(byteSize);
    throw cause;
  }
}

async function stageInput(
  source: AgentUserInput[],
  directory: string,
  dependencies: PreparationDependencies,
  reservations: FileReservation[],
  reusableBlobs: readonly StagedBlobRef[],
  explicitSkills: ExplicitSkillRequirementReceipt[]
) {
  const result: PreparedInputItem[] = [];
  const sectionPlans = new Map<number, SectionSnapshotPlan>();
  const drafts: Array<{
    index: number;
    draft: ReturnType<typeof exportSectionSnapshotDraft>;
  }> = [];
  for (const [index, item] of source.entries()) {
    if (item.type !== "section") continue;
    if (item.chatId === dependencies.sections.conversationId) {
      throw new Error("Section 不能引用当前聊天");
    }
    const record = await dependencies.sections.get(item.chatId);
    if (!record) throw new Error(`Section ${item.name} 已删除或不存在`);
    drafts.push({ index, draft: exportSectionSnapshotDraft(record) });
  }
  const planned = planSectionSnapshots(
    drafts.map((item) => item.draft),
    { imageInput: dependencies.sections.imageInput ?? false }
  );
  drafts.forEach((item, index) => sectionPlans.set(item.index, planned[index]!));

  for (const [sourceIndex, item] of source.entries()) {
    if (item.type === "text") {
      result.push(item);
    } else if (item.type === "image") {
      const value = parseDataUrl(item.dataUrl);
      const sha256 = digest(value.content);
      const existing = reusableBlobs.find(
        (blob) =>
          blob.kind === "image" &&
          blob.filename === item.filename &&
          blob.mediaType === value.mediaType &&
          blob.sha256 === sha256
      );
      result.push({
        type: "image",
        blob:
          existing ??
          await writeBlob(
            directory,
            "image",
            item.filename,
            value.mediaType,
            value.content
          ),
      });
    } else if (item.type === "mention") {
      result.push({
        type: "mention",
        name: item.name,
        blob: await stageAuthorizedFile(item, directory, dependencies, reservations),
      });
    } else if (item.type === "skill") {
      const skill = await dependencies.skills.resolveSkill(
        item.skillRef,
        dependencies.workspace,
        {
          backend: dependencies.backend,
          planMode: dependencies.planMode,
          ...(dependencies.projectTools
            ? {
                toolPolicy: {
                  allowedTools: dependencies.projectTools.allowedTools,
                  policyDigest: canonicalHash({
                    projectContext: dependencies.projectTools.projectContext,
                    resourceVersion: dependencies.projectTools.resourceVersion,
                    policyRevisions: dependencies.projectTools.policyRevisions,
                    builtinIntent: dependencies.projectTools.builtinIntent,
                    allowedTools: dependencies.projectTools.allowedTools,
                  }),
                },
              }
            : {}),
        },
        dependencies.projectContext ?? fallbackProjectContext(dependencies)
      );
      explicitSkills.push({
        ref: item.skillRef,
        name: skill.name,
        requirement: skill.requirementReceipt?.requirement ?? null,
        allowedToolsDigest:
          skill.requirementReceipt?.policyDigest ?? "legacy-live",
      });
      result.push({
        type: "skill",
        name: skill.name,
        blob: await stageSkill(directory, skill),
      });
    } else if (item.type === "history") {
      const exported = await dependencies.histories?.export(item.opaqueId);
      if (!exported) throw new Error(`外源历史 ${item.name} 已不可见或不存在`);
      const blob = await writeBlob(
        directory,
        "file",
        `history-${item.opaqueId.slice(0, 12)}.md`,
        "text/markdown",
        Buffer.from(exported.transcript)
      );
      result.push({ type: "text", text: `@${item.name} 的导入转录快照见附件` });
      result.push({ type: "mention", name: `@${item.name}`, blob });
    } else {
      const plan = sectionPlans.get(sourceIndex);
      if (!plan) throw new Error(`Section ${item.name} 计划缺失`);
      const content = Buffer.from(plan.transcript);
      const blob = await writeBlob(
        directory,
        "file",
        `section-${plan.sectionId}.md`,
        "text/markdown",
        content
      );
      result.push({
        type: "text",
        text: `@${item.name} 的幸存 tail 快照见附件`,
        originalSection: item,
      });
      result.push({
        type: "mention",
        name: `@${item.name}`,
        blob,
        resolvedOnly: true,
      });
      for (const attachment of plan.attachments.included) {
        if (!dependencies.sections.readAttachment) {
          throw new Error("Section 附件读取器未配置");
        }
        const dataUrl = await dependencies.sections.readAttachment(
          plan.sectionId,
          attachment.id
        );
        assertCopyFidelity(attachment, dataUrl);
        const decoded = parseDataUrl(dataUrl);
        result.push({
          type: "text",
          text: `@${item.name} 的附件 ${attachment.filename}（来自 Section ${plan.sectionId}，${attachment.mediaType}，${attachment.byteSize} 字节；该 Section 由 ${plan.sourceAgent} 处理）`,
          resolvedOnly: true,
        });
        result.push({
          type: "image",
          blob: await writeBlob(
            directory,
            "image",
            attachment.filename,
            attachment.mediaType,
            decoded.content
          ),
          resolvedOnly: true,
        });
      }
    }
  }
  return result;
}

export async function prepareManualTurn(
  input: ManualTurnSubmission,
  dependencies: PreparationDependencies
): Promise<PreparedManualLease> {
  const submission = await normalizeManualSubmission(input, dependencies);
  const stagingDir = join(dependencies.stagingRoot, submission.intentId);
  const reservations: FileReservation[] = [];
  const explicitSkills: ExplicitSkillRequirementReceipt[] = [];
  await mkdir(stagingDir, { recursive: false, mode: 0o700 });
  try {
    const persistence = await stagePersistence(
      submission.persistence,
      stagingDir,
      dependencies
    );
    const stagedInput = await stageInput(
      submission.turn.input,
      stagingDir,
      dependencies,
      reservations,
      persistence.input.attachmentPayloads ?? [],
      explicitSkills
    );
    const input =
      persistence.kind === "append" && persistence.input.revise
        ? [
            ...stagedInput,
            ...(persistence.input.attachmentPayloads ?? []).map((blob) => ({
              type: "image" as const,
              blob,
            })),
          ]
        : stagedInput;
    const { input: _input, ...turn } = submission.turn;
    const projectContext =
      dependencies.projectContext ??
      dependencies.projectTools?.projectContext ??
      fallbackProjectContext(dependencies);
    const projectTools = await stageProjectToolsReceipt({
      stagingDir,
      snapshot:
        dependencies.projectTools ??
        emptyProjectToolsSnapshot(projectContext),
      explicitSkills,
      quota: { reserve: reserveBytes, release: releaseBytes },
    });
    const skillSelection = dependencies.freezeSkillSelection
      ? await dependencies.freezeSkillSelection({
          refOwnerId: skillsTurnOwnerId(submission.turn.requestId),
          workspace: dependencies.workspace,
          backend: dependencies.backend,
          planMode: dependencies.planMode,
          projectContext,
        })
      : emptyPreparedSkillSelection(
          submission.turn.requestId,
          dependencies.backend,
          dependencies.planMode,
          projectContext
        );
    await acquirePreparedSkillReferences(skillSelection);
    const body = {
      intentId: submission.intentId,
      persistence,
      turn,
      input,
      content: binaryFreeSubmissionContent(submission.content),
      precondition: submission.precondition,
      workspacePrecondition: submission.workspacePrecondition,
      lifecycleProjectId: dependencies.lifecycleProjectId,
      projectContext,
      projectTools,
      skillSelection,
      stagingDir,
    };
    const prepared = { ...body, contentHash: canonicalHash(body) };
    let completed = false;
    return {
      prepared,
      commit() {
        if (completed) return;
        completed = true;
        reservations.forEach((reservation) => reservation.commit());
      },
      async rollback() {
        if (completed) return;
        completed = true;
        reservations.forEach((reservation) => reservation.rollback());
        await releasePreparedStaging(prepared);
      },
    };
  } catch (cause) {
    reservations.forEach((reservation) => reservation.rollback());
    const bytes = await directoryBytes(stagingDir);
    await removeReadonlySnapshot(stagingDir);
    await releaseBytes(bytes);
    throw cause;
  }
}

export async function hydratePreparedTurn(prepared: PreparedManualTurn) {
  assertPreparedContentHash(prepared);
  if (
    !("lifecycleProjectId" in prepared) ||
    (prepared.lifecycleProjectId !== null &&
      !/^[A-Za-z0-9_-]{1,128}$/.test(prepared.lifecycleProjectId))
  ) {
    throw new Error("PreparedManualTurn 缺少合法 lifecycle Project 身份");
  }
  if (
    !prepared.projectContext ||
    prepared.projectContext.projectId !== prepared.lifecycleProjectId ||
    (prepared.projectContext.projectId === null
      ? prepared.projectContext.projectLifecycleRevision !== null
      : !Number.isSafeInteger(
          prepared.projectContext.projectLifecycleRevision
        ) || prepared.projectContext.projectLifecycleRevision! <= 0)
  ) {
    throw new Error("PreparedManualTurn 缺少合法 Project lifecycle receipt");
  }
  if (
    !prepared.skillSelection ||
    prepared.skillSelection.backend !== prepared.turn.turnOptions.backend ||
    prepared.skillSelection.planMode !== Boolean(prepared.turn.planMode) ||
    prepared.skillSelection.projectContext.projectId !==
      prepared.projectContext.projectId ||
    prepared.skillSelection.projectContext.projectLifecycleRevision !==
      prepared.projectContext.projectLifecycleRevision
  ) {
    throw new Error("PreparedManualTurn 缺少合法 Skills selection receipt");
  }
  await assertPreparedSkillReferences(prepared.skillSelection);
  const backendId = prepared.turn.turnOptions.backend;
  const runtime = await backendRuntimeRegistry.resolve(backendId);
  const backendRuntimeIdentity = runtime.runtimeStatus === "installed"
    ? `${backendId}@${runtime.runtime.version}`
    : undefined;
  const projectTools = await hydrateProjectToolsReceipt(
    prepared.projectTools,
    backendId,
    Boolean(prepared.turn.planMode),
    backendRuntimeIdentity,
    prepared.stagingDir === ""
  );
  if (
    projectTools.receipt.projectContext.projectId !==
      prepared.projectContext.projectId ||
    projectTools.receipt.projectContext.projectLifecycleRevision !==
      prepared.projectContext.projectLifecycleRevision
  ) {
    throw new Error("PROJECT_TOOLS_LIFECYCLE_MISMATCH");
  }
  const workspacePrecondition = workspacePreconditionSchema.parse(
    prepared.workspacePrecondition
  );
  const input: AgentUserInput[] = [];
  const resolved: ResolvedAgentInput["input"] = [];
  for (const item of prepared.input) {
    if (item.type === "text") {
      if (item.originalSection) input.push(item.originalSection);
      else if (!item.resolvedOnly) input.push({ type: "text", text: item.text });
      resolved.push({ type: "text", text: item.text });
    } else if (item.type === "image") {
      const dataUrl = await blobDataUrl(item.blob);
      if (!item.resolvedOnly) {
        input.push({ type: "image", dataUrl, filename: item.blob.filename });
      }
      resolved.push({
        type: "image",
        dataUrl,
        filename: item.blob.filename,
        ...(item.resolvedOnly ? { resolvedOnly: true as const } : {}),
      });
    } else {
      if (!item.resolvedOnly) {
        input.push({ type: "text", text: `${item.name}（staged resource）` });
      }
      resolved.push({
        type: item.type,
        name: item.name,
        path: item.blob.path,
      });
    }
  }
  return {
    submission: {
      intentId: prepared.intentId,
      persistence: await hydratePersistence(prepared.persistence),
      content: prepared.content,
      precondition: prepared.precondition,
      workspacePrecondition,
      turn: { ...prepared.turn, input },
    } satisfies ManualTurnSubmission,
    resolvedInput: {
      input: resolved,
      commit() {},
      rollback() {},
      release: () => releasePreparedStaging(prepared),
    } satisfies ResolvedAgentInput,
    projectTools,
  };
}

function fallbackProjectContext(
  dependencies: Pick<PreparationDependencies, "lifecycleProjectId">
): TurnProjectContext {
  return dependencies.lifecycleProjectId
    ? {
        projectId: dependencies.lifecycleProjectId,
        projectLifecycleRevision: 1,
      }
    : { projectId: null, projectLifecycleRevision: null };
}

async function hydratePersistence(
  persistence: PreparedPersistence
): Promise<ManualTurnPersistence> {
  const payloads = await Promise.all(
    (persistence.input.attachmentPayloads ?? []).map(async (blob) => ({
      filename: blob.filename,
      mediaType: blob.mediaType,
      dataUrl: await blobDataUrl(blob),
    }))
  );
  const input = {
    ...persistence.input,
    attachmentPayloads:
      persistence.kind === "append" && persistence.input.revise
        ? undefined
        : payloads.length
          ? payloads
          : undefined,
  };
  return { kind: persistence.kind, input } as ManualTurnPersistence;
}

async function blobDataUrl(blob: StagedBlobRef) {
  const content = await readFile(blob.path);
  if (digest(content) !== blob.sha256) throw new Error("staged blob hash 冲突");
  return `data:${blob.mediaType};base64,${content.toString("base64")}`;
}

const fileHash = async (path: string) => digest(await readFile(path));

const directoryBytes = async (directory: string): Promise<number> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? directoryBytes(path)
          : entry.isFile()
            ? stat(path).then((value) => value.size)
            : 0;
      })
    );
    return sizes.reduce((total, size) => total + size, 0);
  } catch {
    return 0;
  }
};

export async function releasePreparedStaging(prepared: PreparedManualTurn) {
  assertPreparedContentHash(prepared);
  await releasePreparedSkillReferences(prepared.skillSelection);
  if (!prepared.stagingDir) return;
  await withQuotaLock(async () => {
    const bytes = await directoryBytes(prepared.stagingDir);
    await removeReadonlySnapshot(prepared.stagingDir);
    stagedBytes = Math.max(0, stagedBytes - bytes);
  });
}

export const preparedStagingUsageBytes = () => stagedBytes;

export async function reconcilePreparedStaging(
  root: string,
  liveOwners: ReadonlySet<string>
) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  stagedBytes = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (!entry.isDirectory() || !liveOwners.has(entry.name)) {
      await removeReadonlySnapshot(path);
      continue;
    }
    stagedBytes += await directoryBytes(path);
  }
  if (stagedBytes > STAGED_BLOB_QUOTA) {
    throw new Error("staged blob 存量超过磁盘额度");
  }
}
