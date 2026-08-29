/**
 * [INPUT]: Depends on shared AgentUserInput, fresh Skills resolution, file authorization, Chat/Section snapshot readers, and the main-private staging root
 * [OUTPUT]: Provides resolveAgentInput with read-only staged files, fresh Skill blocks, snapshot transcripts, resolved images, provenance, and private read roots
 * [POS]: Main-process structured-input boundary; backends receive private copies and never renderer-authorized source paths
 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import type { AgentUserInput } from "../../shared/agent-ipc";
import type { AgentBackendId } from "../../shared/agent-ipc";
import { ATTACHMENT_BYTE_LIMIT } from "../../shared/agent-ipc";
import type { ChatRecord } from "../../shared/chats-ipc";
import { ProductFailureError, skillsRuntimeFailure } from "../../shared/product-failure";
import type { ResolvedAgentInput } from "./backends/types";
import type {
  FileAuthorizationStore,
  FileReservation,
} from "./file-authorizations";
import type { SkillsCatalog } from "./skills-catalog";
import type { TurnProjectContext } from "../../shared/product-resource-scope";
import { exportSectionSnapshotDraft } from "./sections/export-transcript";
import {
  assertCopyFidelity,
  planSectionSnapshots,
  type SectionSnapshotPlan,
} from "../../shared/section-attachments";

const SKILL_BYTE_LIMIT = 128 * 1024;
export const SKILL_DIRECTORY_BUDGET = {
  fileBytes: 512 * 1024,
  totalBytes: 4 * 1024 * 1024,
  files: 128,
  depth: 5,
} as const;

type DirectorySnapshotBudget = {
  fileBytes: number;
  totalBytes: number;
  files: number;
  depth: number;
};

export async function removeReadonlySnapshot(root: string) {
  const makeDirectoriesWritable = async (path: string): Promise<void> => {
    let metadata;
    try {
      metadata = await lstat(path);
    } catch {
      return;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return;
    await chmod(path, 0o700);
    const entries = await readdir(path, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => makeDirectoriesWritable(join(path, entry.name)))
    );
  };
  await makeDirectoriesWritable(root);
  await rm(root, { recursive: true, force: true });
}

export async function stageSkillPackageSnapshot(
  skill: Awaited<ReturnType<SkillsCatalog["resolveSkill"]>>,
  directory: string
) {
  if (skill.content.byteLength > SKILL_BYTE_LIMIT) {
    throw new ProductFailureError(skillsRuntimeFailure("file-too-large", {
      version: 1, kind: "limit", limit: SKILL_BYTE_LIMIT,
    }));
  }
  try {
    const snapshot = await stageDirectorySnapshot(dirname(skill.path), directory);
    const path = join(directory, "SKILL.md");
    const staged = await readFile(path);
    if (!staged.equals(Buffer.from(skill.content))) {
      throw new ProductFailureError(skillsRuntimeFailure("changed-during-read"));
    }
    return { path, totalBytes: snapshot.totalBytes };
  } catch (cause) {
    if (cause instanceof ProductFailureError) throw cause;
    throw new ProductFailureError(skillsRuntimeFailure("staging-rejected"));
  }
}

type ExpectedIdentity = Pick<FileReservation, "device" | "inode">;

export async function stageFileSnapshot(
  source: string,
  destination: string,
  byteLimit: number,
  expected?: ExpectedIdentity
) {
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("路径输入必须是普通文件");
  }
  if ((await realpath(source)) !== source) {
    throw new Error("路径输入已被替换");
  }
  const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > byteLimit) {
      throw new Error(`路径输入无效或超过 ${byteLimit} 字节`);
    }
    if (
      expected &&
      (opened.dev !== expected.device || opened.ino !== expected.inode)
    ) {
      throw new Error("文件授权目标已被替换");
    }
    const content = await file.readFile();
    if (content.byteLength !== opened.size) {
      throw new Error("文件在复制期间发生变化");
    }
    await writeFile(destination, content, { flag: "wx", mode: 0o400 });
  } finally {
    await file.close();
  }
}

/**
 * 目录包必须作为一个整体成立：任一预算、类型或 containment 校验失败，
 * destination 会被完整移除，调用方永远看不到半份 Skill。
 */
export async function stageDirectorySnapshot(
  sourceDirectory: string,
  destinationDirectory: string,
  budget: DirectorySnapshotBudget = SKILL_DIRECTORY_BUDGET
) {
  const sourceMetadata = await lstat(sourceDirectory);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
    throw new Error("目录输入必须是普通目录");
  }
  const canonicalRoot = await realpath(sourceDirectory);
  if (canonicalRoot !== sourceDirectory) {
    throw new Error("目录输入已被替换");
  }

  let files = 0;
  let totalBytes = 0;
  const directories: string[] = [];
  const visit = async (
    source: string,
    destination: string,
    depth: number
  ): Promise<void> => {
    if (depth > budget.depth) {
      throw new Error(`目录快照深度不能超过 ${budget.depth}`);
    }
    await mkdir(destination, { mode: 0o700 });
    directories.push(destination);
    const entries = (await readdir(source, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const sourcePath = resolve(source, entry.name);
      const location = relative(canonicalRoot, sourcePath);
      if (!location || location.startsWith("..") || isAbsolute(location)) {
        throw new Error("目录快照路径越过来源根目录");
      }
      const metadata = await lstat(sourcePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`目录快照拒绝符号链接：${location}`);
      }
      if ((await realpath(sourcePath)) !== sourcePath) {
        throw new Error(`目录快照路径已被替换：${location}`);
      }
      const destinationPath = join(destination, entry.name);
      if (metadata.isDirectory()) {
        await visit(sourcePath, destinationPath, depth + 1);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error(`目录快照只接受普通文件：${location}`);
      }
      files += 1;
      if (files > budget.files) {
        throw new Error(`目录快照文件数不能超过 ${budget.files}`);
      }
      if (metadata.size > budget.fileBytes) {
        throw new Error(`目录快照单文件不能超过 ${budget.fileBytes} 字节`);
      }
      totalBytes += metadata.size;
      if (totalBytes > budget.totalBytes) {
        throw new Error(`目录快照总量不能超过 ${budget.totalBytes} 字节`);
      }
      await stageFileSnapshot(
        sourcePath,
        destinationPath,
        budget.fileBytes
      );
    }
  };

  try {
    await visit(sourceDirectory, destinationDirectory, 0);
    await Promise.all(
      directories.reverse().map((directory) => chmod(directory, 0o500))
    );
    return { files, totalBytes };
  } catch (cause) {
    await removeReadonlySnapshot(destinationDirectory);
    throw cause;
  }
}

export async function initializeAgentInputStaging(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
}

/* ============================================================
 * 交出去的快照必须同时出现在本轮读面上。
 *
 * file/section/skill 三类输入在 wire 上都是指向 main 私有快照的
 * `resource_link`，而 OS 围栏按路径裁决：快照目录不进读面，等于把附件递过去
 * 又不让读。死状不是"附件丢了"，而是 CLI 侧一句 EPERM——用户看到的是 Agent
 * 说"系统权限拒绝访问该文件"，附件名与路径却都在。
 *
 * 声明目录而非单文件：skill 是目录包（SKILL.md 的相对资源必须同在），
 * file/section 的快照与它同住本轮 staging 目录，那里面本来就只有本轮交出去
 * 的东西。规则只认 `path` 这一个事实，任何新的 staged 产出者自动被覆盖。
 * ============================================================ */
export function stagedInputReadRoots(input: ResolvedAgentInput["input"]) {
  return [
    ...new Set(
      input.flatMap((item) =>
        item.type === "skill" || item.type === "mention"
          ? [dirname(item.path)]
          : []
      )
    ),
  ];
}

export async function resolveAgentInput(
  source: AgentUserInput[],
  workspace: string,
  skills: SkillsCatalog,
  files: FileAuthorizationStore,
  stagingRoot: string,
  sections?: {
    conversationId: string;
    get(chatId: string): Promise<ChatRecord | null>;
    readAttachment?(sectionId: string, attachmentId: string): Promise<string>;
    imageInput?: boolean;
  },
  histories?: {
    export(opaqueId: string): Promise<{ title: string; transcript: string } | null>;
  },
  skillAccess?: {
    backend: AgentBackendId;
    planMode: boolean;
  },
  projectContext?: TurnProjectContext
): Promise<ResolvedAgentInput> {
  const reservations: ReturnType<FileAuthorizationStore["reserve"]>[] = [];
  const staging = join(stagingRoot, randomUUID());
  let committed = false;
  let finished = false;
  try {
    await mkdir(staging, { recursive: false, mode: 0o700 });
    const input: ResolvedAgentInput["input"] = [];
    const sectionPlans = new Map<number, SectionSnapshotPlan>();
    if (sections) {
      const drafts: Array<{ index: number; draft: ReturnType<typeof exportSectionSnapshotDraft> }> = [];
      for (const [index, item] of source.entries()) {
        if (item.type !== "section") continue;
        if (item.chatId === sections.conversationId) {
          throw new Error("Section 不能引用当前聊天");
        }
        const record = await sections.get(item.chatId);
        if (!record) throw new Error(`Section ${item.name} 已删除或不存在`);
        drafts.push({ index, draft: exportSectionSnapshotDraft(record) });
      }
      const planned = planSectionSnapshots(
        drafts.map((item) => item.draft),
        { imageInput: sections.imageInput ?? false }
      );
      drafts.forEach((item, planIndex) => {
        sectionPlans.set(item.index, planned[planIndex]!);
      });
    }
    for (const [index, item] of source.entries()) {
      if (item.type === "text") {
        input.push({ type: "text", text: item.text });
        continue;
      }
      if (item.type === "image") {
        input.push({
          type: "image",
          dataUrl: item.dataUrl,
          filename: item.filename,
        });
        continue;
      }
      if (item.type === "skill") {
        if (!skillAccess) {
          throw new ProductFailureError(skillsRuntimeFailure("invalid-request"));
        }
        const skill = await skills.resolveSkill(
          item.skillRef,
          workspace,
          skillAccess,
          projectContext
        );
        const directory = join(staging, `${index}-skill`);
        const { path } = await stageSkillPackageSnapshot(skill, directory);
        input.push({ type: "skill", name: skill.name, path });
        continue;
      }
      if (item.type === "section") {
        if (!sections) {
          throw new Error("当前运行环境不支持 Section 引用");
        }
        const plan = sectionPlans.get(index);
        if (!plan) throw new Error(`Section ${item.name} 计划缺失`);
        const path = join(staging, `${index}-section-${plan.sectionId}.md`);
        await writeFile(path, plan.transcript, {
          flag: "wx",
          mode: 0o400,
        });
        input.push({
          type: "text",
          text: `@${item.name} 的幸存 tail 快照见 ${path}`,
        });
        input.push({ type: "mention", name: `@${item.name}`, path });
        for (const attachment of plan.attachments.included) {
          if (!sections.readAttachment) {
            throw new Error("Section 附件读取器未配置");
          }
          const dataUrl = await sections.readAttachment(
            plan.sectionId,
            attachment.id
          );
          assertCopyFidelity(attachment, dataUrl);
          input.push({
            type: "text",
            text: `@${item.name} 的附件 ${attachment.filename}（来自 Section ${plan.sectionId}，${attachment.mediaType}，${attachment.byteSize} 字节；该 Section 由 ${plan.sourceAgent} 处理）`,
          });
          input.push({
            type: "image",
            dataUrl,
            filename: attachment.filename,
            resolvedOnly: true,
          });
        }
        continue;
      }
      if (item.type === "history") {
        if (!histories) {
          throw new Error("当前运行环境不支持外源历史引用");
        }
        const exported = await histories.export(item.opaqueId);
        if (!exported) {
          throw new Error(`外源历史 ${item.name} 已不可见或不存在`);
        }
        const name = exported.title || item.name;
        const path = join(staging, `${index}-history-${item.opaqueId.slice(0, 12)}.md`);
        await writeFile(path, exported.transcript, { flag: "wx", mode: 0o400 });
        input.push({
          type: "text",
          text: `@${name} 的导入转录快照见 ${path}`,
        });
        input.push({ type: "mention", name: `@${name}`, path });
        continue;
      }
      const reservation = files.reserve(item.fileRef, workspace, item.name);
      reservations.push(reservation);
      const path = join(staging, `${index}-${basename(reservation.name)}`);
      await stageFileSnapshot(
        reservation.path,
        path,
        ATTACHMENT_BYTE_LIMIT,
        reservation
      );
      input.push({
        type: "mention",
        name: reservation.name,
        path,
      });
    }
    const removeStaging = () => removeReadonlySnapshot(staging);
    return {
      input,
      commit: () => {
        if (finished || committed) return;
        committed = true;
        reservations.forEach((item) => item.commit());
      },
      rollback: () => {
        if (finished) return;
        finished = true;
        if (!committed) reservations.forEach((item) => item.rollback());
        void removeStaging().catch(() => {});
      },
      release: async () => {
        if (finished) return;
        finished = true;
        if (!committed) reservations.forEach((item) => item.rollback());
        await removeStaging();
      },
    };
  } catch (cause) {
    reservations.forEach((item) => item.rollback());
    await removeReadonlySnapshot(staging);
    throw cause;
  }
}

const lateSkillDeliveries = new WeakMap<ResolvedAgentInput, ReadonlySet<string>>();

/**
 * runtime finalization 后的唯一 App-required Skill 入口。fresh/reuse/resume 都走
 * 这里；稳定 identity 是 deliveryInstanceId，path/name 只负责 wire 展示。
 */
export function mergeMaterializedExtensionSkills(
  resolved: ResolvedAgentInput,
  skills: readonly {
    deliveryInstanceId: string;
    name: string;
    path: string;
  }[]
) {
  const delivered = new Set(lateSkillDeliveries.get(resolved) ?? []);
  const additions = skills.filter(
    (skill) => !delivered.has(skill.deliveryInstanceId)
  );
  if (!additions.length) return resolved;
  for (const skill of additions) delivered.add(skill.deliveryInstanceId);
  const merged: ResolvedAgentInput = {
    input: [
      ...additions.map((skill) => ({
        type: "skill" as const,
        name: skill.name,
        path: skill.path,
      })),
      ...resolved.input,
    ],
    commit: () => resolved.commit(),
    rollback: () => resolved.rollback(),
    release: () => resolved.release(),
  };
  lateSkillDeliveries.set(merged, delivered);
  return merged;
}
