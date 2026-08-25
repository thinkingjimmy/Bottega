/**
 * [INPUT]: Depends on Node fs/crypto, shared manual/legacy Gallery submission, Skills/File License, Section record/tail snapshot plan/annex reading, canonical Modify annex reading and agent-input Secure copying
 * [OUTPUT]: Provides create/create-app/app/append/adopt(hash-verified PreparedManualTurn with revised annex reconstruction and resolved-only Section images; Workspace CAS; intent staging/hydrate; release and quota/reconcile etc
 * [POS]: The manual/steer sharing of the coordinator's boundaries with the attachment; The first is the database database database, which is not a database
 */

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  AgentSendPayload,
  AgentUserInput,
  AgentWorkspaceScope,
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
  incarnationPreconditionSchema,
  submissionContentV1Schema,
  workspacePreconditionSchema,
  type IncarnationPrecondition,
  type SubmissionContentV1,
  type WorkspacePrecondition,
} from "../../../../../shared/submission";
import { preparedSubmissionV1Schema } from "../../../../../shared/gallery-submission";
import type { ResolvedAgentInput } from "../../../backends/types";
import type {
  FileAuthorizationStore,
  FileReservation,
} from "../../../file-authorizations";
import type { SkillsCatalog } from "../../../skills-catalog";
import {
  removeReadonlySnapshot,
  stageDirectorySnapshot,
  stageFileSnapshot,
} from "../../../agent-input";
import { exportSectionSnapshotDraft } from "../../export-transcript";
import {
  assertCopyFidelity,
  planSectionSnapshots,
  type SectionSnapshotPlan,
} from "../../../../../shared/section-attachments";
import { canonicalHash } from "../coordinator-values";

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

type PreparedInputItem =
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

type PreparedPersistence =
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
  input: PreparedInputItem[];
  stagingDir: string;
  contentHash: string;
};

export type PreparedManualLease = {
  prepared: PreparedManualTurn;
  commit(): void;
  rollback(): Promise<void>;
};

type PreparationDependencies = {
  workspace: string;
  workspaceScope: AgentWorkspaceScope;
  backend: AgentSendPayload["turnOptions"]["backend"];
  planMode: boolean;
  stagingRoot: string;
  skills: SkillsCatalog;
  files: FileAuthorizationStore;
  lifecycleProjectId: string | null;
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
    const staged = await stageDirectorySnapshot(
      dirname(skill.path),
      packageRoot
    );
    byteSize = staged.totalBytes;
    await reserveBytes(byteSize);
    reserved = true;
    const path = join(packageRoot, "SKILL.md");
    const content = await readFile(path);
    if (!content.equals(Buffer.from(skill.content))) {
      throw new Error("Skill 在目录快照期间发生变化");
    }
    return {
      blobId,
      kind: "skill",
      path,
      filename: "SKILL.md",
      mediaType: "text/markdown",
      byteSize,
      sha256: digest(content),
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
  reusableBlobs: readonly StagedBlobRef[]
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
        }
      );
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
      persistence.input.attachmentPayloads ?? []
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
    const body = {
      intentId: submission.intentId,
      persistence,
      turn,
      input,
      content: binaryFreeSubmissionContent(submission.content),
      precondition: submission.precondition,
      workspacePrecondition: submission.workspacePrecondition,
      lifecycleProjectId: dependencies.lifecycleProjectId,
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

type LegacyManualTurnSubmission = Omit<
  ManualTurnSubmission,
  "content" | "precondition" | "workspacePrecondition"
> & {
  content?: unknown;
  precondition?: unknown;
  workspacePrecondition?: unknown;
  gallery?: unknown;
};

async function normalizeManualSubmission(
  input: ManualTurnSubmission,
  dependencies: Pick<PreparationDependencies, "sections">
): Promise<ManualTurnSubmission> {
  const legacy = input as unknown as LegacyManualTurnSubmission;
  const content =
    legacy.content === undefined
      ? legacySubmissionContent(legacy)
      : submissionContentV1Schema.parse(legacy.content);
  const precondition =
    legacy.precondition === undefined
      ? await legacyPrecondition(legacy, dependencies)
      : incarnationPreconditionSchema.parse(legacy.precondition);
  const workspacePrecondition = workspacePreconditionSchema.parse(
    legacy.workspacePrecondition
  );
  const persistence =
    legacy.persistence.kind === "append"
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

function legacySubmissionContent(
  submission: LegacyManualTurnSubmission
): SubmissionContentV1 {
  const gallery =
    submission.gallery === undefined
      ? undefined
      : preparedSubmissionV1Schema.parse(submission.gallery);
  const displayText =
    gallery?.message.displayText ??
    ("firstMessage" in submission.persistence.input
      ? submission.persistence.input.firstMessage.content
      : submission.persistence.input.message.content);
  return submissionContentV1Schema.parse({
    schemaVersion: 1,
    content: {
      richValue:
        gallery?.message.richValue ?? [
          {
            id: `legacy_${submission.intentId}`,
            type: "text",
            value: displayText,
          },
        ],
      displayText,
      files: gallery?.message.files ?? [],
    },
    origin: "composer",
    capabilityEpoch: gallery?.capabilityEpoch ?? 0,
    backendEpoch: gallery?.backendEpoch ?? 0,
    ...(gallery
      ? {
          gallery: {
            schemaVersion: 1,
            attachments: gallery.galleryAttachments,
          },
        }
      : {}),
  });
}

async function legacyPrecondition(
  submission: LegacyManualTurnSubmission,
  dependencies: Pick<PreparationDependencies, "sections">
): Promise<IncarnationPrecondition> {
  if (submission.persistence.kind === "append") {
    const record = await dependencies.sections.get(
      submission.persistence.input.chatId
    );
    if (!record) throw new Error("INCARNATION_MISMATCH");
    return {
      kind: "existing",
      incarnationId: record.incarnationId,
    };
  }
  const proposedIncarnationId = submission.persistence.input.incarnationId;
  if (!proposedIncarnationId) {
    throw new Error("旧提交缺少 proposedIncarnationId，迁移保持只读");
  }
  return { kind: "absent", proposedIncarnationId };
}

export function prepareTextOnlyManualTurn(
  submission: ManualTurnSubmission,
  lifecycleProjectId = inferredLifecycleProjectId(submission)
): PreparedManualTurn {
  const { input: raw, ...turn } = submission.turn;
  if (raw.some((item) => item.type !== "text")) {
    throw new Error("测试/降级 preparation 只接受文本输入");
  }
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
    stagingDir: "",
  };
  return { ...body, contentHash: canonicalHash(body) };
}

function inferredLifecycleProjectId(submission: ManualTurnSubmission) {
  if (submission.persistence.kind !== "append") {
    return submission.persistence.input.projectId ?? null;
  }
  return submission.workspacePrecondition.kind === "project"
    ? submission.workspacePrecondition.projectId
    : null;
}

function binaryFreeSubmissionContent(
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

export async function hydratePreparedTurn(prepared: PreparedManualTurn) {
  assertPreparedContentHash(prepared);
  if (
    !("lifecycleProjectId" in prepared) ||
    (prepared.lifecycleProjectId !== null &&
      !/^[A-Za-z0-9_-]{1,128}$/.test(prepared.lifecycleProjectId))
  ) {
    throw new Error("PreparedManualTurn 缺少合法 lifecycle Project 身份");
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
  };
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
