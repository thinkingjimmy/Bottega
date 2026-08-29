/**
 * [INPUT]: Depends on ProjectsService workspace authority/exclusive queue, guarded Node filesystem primitives, Electron shell, renderer IPC, and shared Project Personalization contracts
 * [OUTPUT]: Provides ProjectPersonalizationService and registerProjectPersonalization with contained list/save/reveal and digest × workspaceRevision CAS
 * [POS]: Main-only Project instruction-file authority; App-bound files are read-only and renderer-supplied paths are never trusted
 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { shell, type BrowserWindow } from "electron";
import {
  PERSONALIZATION_BYTE_LIMIT,
  PROJECT_PERSONALIZATION_CHANNEL,
  projectInstructionsTargetSchema,
  saveProjectInstructionsInputSchema,
  type ProjectInstructionsErrorCode,
  type ProjectInstructionsFile,
  type ProjectInstructionsFileId,
  type ProjectInstructionsSnapshot,
  type SaveProjectInstructionsInput,
  type SaveProjectInstructionsResult,
} from "../../shared/personalization-ipc";
import { PROJECT_ID_PATTERN, PROJECT_UNAVAILABLE } from "../../shared/projects-ipc";
import { rendererIpc } from "./ipc-registrar";
import type { ProjectsService } from "./projects/projects-service";

type Target = Readonly<{
  fileId: ProjectInstructionsFileId;
  name: "AGENTS.md" | "CLAUDE.md";
  readBy: ProjectInstructionsFile["readBy"];
}>;

type ReadResult = ProjectInstructionsFile & {
  writePath: string;
  mode: number;
};

const TARGETS: readonly Target[] = [
  {
    fileId: "agents",
    name: "AGENTS.md",
    readBy: ["codex", "kimi", "opencode"],
  },
  { fileId: "claude", name: "CLAUDE.md", readBy: ["claude"] },
];

const digest = (content: string) =>
  createHash("sha256").update(content).digest("hex");
const oversizedDigest = (size: number, mtimeMs: number) =>
  digest(`oversized:${size}:${mtimeMs}`);

function contained(root: string, candidate: string) {
  const rest = relative(root, candidate);
  return rest === "" || (!rest.startsWith("..") && !isAbsolute(rest));
}

export class ProjectPersonalizationService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly revealPath: (path: string) => void = (path) =>
      shell.showItemInFolder(path)
  ) {}

  list(rawProjectId: string): Promise<ProjectInstructionsSnapshot> {
    const projectId = this.projectId(rawProjectId);
    return this.projects.runExclusive(() => this.listHeld(projectId));
  }

  save(raw: SaveProjectInstructionsInput): Promise<SaveProjectInstructionsResult> {
    const parsed = saveProjectInstructionsInputSchema.safeParse(raw);
    if (!parsed.success) {
      const tooLarge = parsed.error.issues.some(
        (issue) => issue.message === "too-large"
      );
      if (tooLarge) {
        return Promise.resolve({ status: "error", code: "too-large" });
      }
      return Promise.reject(new Error("Project 个性化保存载荷不合法"));
    }
    return this.projects.runExclusive(() => this.saveHeld(parsed.data));
  }

  reveal(rawProjectId: string, rawFileId: ProjectInstructionsFileId) {
    const targetInput = projectInstructionsTargetSchema.parse({
      projectId: rawProjectId,
      fileId: rawFileId,
    });
    return this.projects.runExclusive(async () => {
      const context = await this.context(targetInput.projectId);
      const target = this.target(targetInput.fileId);
      const current = await this.read(context.root, target);
      if (current.error === "outside-workspace") {
        throw new Error("outside-workspace");
      }
      if (!current.exists || current.error) return;
      this.revealPath(current.writePath);
    });
  }

  private async listHeld(projectId: string): Promise<ProjectInstructionsSnapshot> {
    const context = await this.context(projectId);
    const files = await Promise.all(
      TARGETS.map((target) => this.readPublic(context.root, target))
    );
    return { workspaceRevision: context.workspaceRevision, files };
  }

  private async saveHeld(
    input: SaveProjectInstructionsInput
  ): Promise<SaveProjectInstructionsResult> {
    const stored = this.projects.store.get(input.projectId);
    if (!stored) throw new Error(`${PROJECT_UNAVAILABLE}: Project 记录不存在`);
    if (stored.workspaceBinding.kind === "app") {
      return { status: "error", code: "app-managed" };
    }
    if (stored.membershipRevision !== input.expectedWorkspaceRevision) {
      return {
        status: "workspace-changed",
        snapshot: await this.listHeld(input.projectId),
      };
    }
    const context = await this.context(input.projectId);
    const target = this.target(input.fileId);
    const current = await this.read(context.root, target);
    if (current.error === "outside-workspace") {
      return { status: "error", code: current.error };
    }
    if (current.error === "symlink-unresolvable") {
      return { status: "error", code: current.error };
    }
    if (current.error && current.error !== "oversized-file") {
      return { status: "error", code: current.error };
    }
    if (current.digest !== input.expectedDigest) {
      return {
        status: "conflict",
        current: current.oversized
          ? { oversized: true, content: null, digest: current.digest! }
          : {
              oversized: false,
              content: current.content ?? "",
              digest: current.digest,
            },
        workspaceRevision: context.workspaceRevision,
      };
    }
    if (current.oversized) {
      return { status: "error", code: "oversized-file" };
    }
    try {
      await durableReplaceFileNoMkdir(
        current.writePath,
        input.content,
        current.mode,
        context.root
      );
      return {
        status: "ok",
        file: await this.readPublic(context.root, target),
        workspaceRevision: context.workspaceRevision,
      };
    } catch (cause) {
      if (cause instanceof Error && cause.message === "outside-workspace") {
        return { status: "error", code: "outside-workspace" };
      }
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`${PROJECT_UNAVAILABLE}: Project 文件夹已丢失`);
      }
      console.error("[project-personalization] write failed", input.fileId, cause);
      return { status: "error", code: "write-failed" };
    }
  }

  private async context(projectId: string) {
    const stored = this.projects.store.get(projectId);
    if (!stored || stored.archivedAt) {
      throw new Error(`${PROJECT_UNAVAILABLE}: Project 不可用`);
    }
    const { workspace } = this.projects.resolveCodexContext(projectId);
    let root: string;
    try {
      root = await realpath(workspace);
      if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new Error(`${PROJECT_UNAVAILABLE}: Project 文件夹已丢失`);
    }
    return { root, workspaceRevision: stored.membershipRevision };
  }

  private async readPublic(root: string, target: Target) {
    const { writePath: _writePath, mode: _mode, ...file } = await this.read(
      root,
      target
    );
    return file;
  }

  private async read(root: string, target: Target): Promise<ReadResult> {
    const path = join(root, target.name);
    let info;
    try {
      info = await lstat(path);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        return this.empty(path, target);
      }
      return this.failed(path, target, "read-failed");
    }

    let writePath = path;
    let linkTarget: string | undefined;
    if (info.isSymbolicLink()) {
      try {
        writePath = await realpath(path);
        if (!contained(root, writePath)) {
          return this.failed(path, target, "outside-workspace");
        }
        info = await stat(writePath);
        linkTarget = relative(root, writePath) || target.name;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error("[project-personalization] symlink resolve failed", target.fileId, cause);
        }
        return this.failed(path, target, "symlink-unresolvable");
      }
    }
    if (!contained(root, writePath)) {
      return this.failed(path, target, "outside-workspace");
    }
    if (!info.isFile()) {
      return this.failed(path, target, "read-failed", writePath, 0o644, linkTarget);
    }
    const mode = info.mode & 0o777;
    if (info.size > PERSONALIZATION_BYTE_LIMIT) {
      return {
        ...this.base(target),
        linkTarget,
        exists: true,
        oversized: true,
        size: info.size,
        content: null,
        digest: oversizedDigest(info.size, info.mtimeMs),
        error: "oversized-file",
        writePath,
        mode,
      };
    }
    try {
      const handle = await open(
        writePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      );
      try {
        if (!(await handle.stat()).isFile()) throw new Error("not a regular file");
        const buffer = Buffer.alloc(PERSONALIZATION_BYTE_LIMIT + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > PERSONALIZATION_BYTE_LIMIT) {
          return {
            ...this.base(target),
            linkTarget,
            exists: true,
            oversized: true,
            size: bytesRead,
            content: null,
            digest: oversizedDigest(bytesRead, info.mtimeMs),
            error: "oversized-file",
            writePath,
            mode,
          };
        }
        const content = buffer.subarray(0, bytesRead).toString("utf8");
        return {
          ...this.base(target),
          linkTarget,
          exists: true,
          oversized: false,
          content,
          digest: digest(content),
          writePath,
          mode,
        };
      } finally {
        await handle.close();
      }
    } catch (cause) {
      console.error("[project-personalization] guarded read failed", target.fileId, cause);
      return this.failed(path, target, "read-failed", writePath, mode, linkTarget);
    }
  }

  private base(target: Target) {
    return {
      fileId: target.fileId,
      readBy: target.readBy,
      displayPath: target.name,
    };
  }

  private empty(path: string, target: Target): ReadResult {
    return {
      ...this.base(target),
      exists: false,
      oversized: false,
      content: "",
      digest: null,
      writePath: path,
      mode: 0o644,
    };
  }

  private failed(
    path: string,
    target: Target,
    error: Extract<
      ProjectInstructionsErrorCode,
      | "oversized-file"
      | "symlink-unresolvable"
      | "read-failed"
      | "outside-workspace"
    >,
    writePath = path,
    mode = 0o644,
    linkTarget?: string
  ): ReadResult {
    return {
      ...this.base(target),
      linkTarget,
      exists: true,
      oversized: false,
      content: null,
      digest: null,
      error,
      writePath,
      mode,
    };
  }

  private target(fileId: ProjectInstructionsFileId) {
    return TARGETS.find((candidate) => candidate.fileId === fileId)!;
  }

  private projectId(value: string) {
    if (!PROJECT_ID_PATTERN.test(value)) throw new Error("Project id 无效");
    return value;
  }
}

async function durableReplaceFileNoMkdir(
  filePath: string,
  content: string,
  mode: number,
  expectedRoot: string
) {
  const directory = dirname(filePath);
  if (!contained(expectedRoot, await realpath(directory))) {
    throw new Error("outside-workspace");
  }
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", mode);
  try {
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    /* Node lacks openat-style rename fencing. Revalidate immediately before
       rename; the remaining local-user race is outside the product threat model. */
    if (!contained(expectedRoot, await realpath(directory))) {
      throw new Error("outside-workspace");
    }
    await rename(temporary, filePath);
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
  const parent = await open(directory, "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

export function registerProjectPersonalization(
  window: BrowserWindow,
  rendererUrl: string,
  projects: ProjectsService,
  service = new ProjectPersonalizationService(projects)
) {
  rendererIpc(window, rendererUrl, "拒绝非主窗口的 Project 个性化请求")
    .roles("main")
    .handle(PROJECT_PERSONALIZATION_CHANNEL.list, (projectId) =>
      service.list(projectId as string)
    )
    .handle(PROJECT_PERSONALIZATION_CHANNEL.save, (input) =>
      service.save(input as SaveProjectInstructionsInput)
    )
    .handle(PROJECT_PERSONALIZATION_CHANNEL.reveal, (projectId, fileId) =>
      service.reveal(
        projectId as string,
        fileId as ProjectInstructionsFileId
      )
    );
}
