/**
 * [INPUT]: Depends on the logical scope of the workspace-resolver, the fresh member entity metadata of the catalog, and the read-only file capability of Node lstat/realpath/open/fstat/with boundaries read
 * [OUTPUT]: Provides binding identity, canonical path, inode and TTL, and grant/synchronize/distribute with both hard-bound opaque readRef authority
 * [POS]: Electron main's Workspace content read the authorized boundaries; It locks fresh proof to the same non-soft chain entity as the local lstat and is responsible for granting reuse/removal, stat-sized read and dual scope fence
 */

import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  WORKSPACE_READ_BYTE_LIMIT,
  WORKSPACE_TEXT_PREVIEW_BYTE_LIMIT,
  type WorkspaceFileReadInput,
  type WorkspaceFileReadResult,
} from "../../shared/workspace-files-ipc";
import type {
  EffectiveWorkspace,
  EffectiveWorkspaceResolver,
} from "./workspace-resolver";

const READ_REF_TTL_MS = 60_000;
export const WORKSPACE_READ_REF_LIMIT = 256;
export const WORKSPACE_READ_CONCURRENCY_LIMIT = 4;

type EntryKind = "file" | "dir";

type WorkspaceReadEntry = {
  path: string;
  entryKind: EntryKind;
};

export type WorkspaceReadMetadata = {
  kind: EntryKind | "symlink" | "missing";
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
};

type ReadGrant = {
  key: string;
  identity: string;
  workspace: string;
  canonicalPath: string;
  path: string;
  dev: number;
  ino: number;
  expiresAt: number;
};

type WorkspaceFileReadTestHooks = {
  beforeBoundedRead?: () => Promise<void> | void;
  onReadBufferAllocated?: (bytes: number) => void;
};

export class WorkspaceFileReadError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "WorkspaceFileReadError";
  }
}

function failure(code: string, message: string): never {
  throw new WorkspaceFileReadError(code, message);
}

function stableFailure(cause: unknown, fallback: WorkspaceFileReadError) {
  return cause instanceof WorkspaceFileReadError ? cause : fallback;
}

function contained(root: string, target: string) {
  const path = relative(root, target);
  return path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function imageMime(path: string) {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png" as const;
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg" as const;
  if (extension === ".gif") return "image/gif" as const;
  if (extension === ".webp") return "image/webp" as const;
  return null;
}

function sniffImage(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png" as const;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg" as const;
  }
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
    return "image/gif" as const;
  }
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp" as const;
  return null;
}

export class WorkspaceFileReadAuthority {
  private readonly grants = new Map<string, ReadGrant>();
  private readonly refsByKey = new Map<string, string>();
  private activeReads = 0;

  constructor(
    private readonly resolveEffectiveWorkspace: EffectiveWorkspaceResolver,
    private readonly now: () => number,
    private readonly testHooks: WorkspaceFileReadTestHooks = {}
  ) {}

  async issue(input: {
    effective: Extract<EffectiveWorkspace, { kind: "ready" }>;
    workspace: string;
    entry: WorkspaceReadEntry;
    metadata: WorkspaceReadMetadata;
  }) {
    try {
      return await this.issueStable(input);
    } catch (cause) {
      throw stableFailure(
        cause,
        new WorkspaceFileReadError(
          "WORKSPACE_READ_REF_ISSUE_FAILED",
          "Workspace readRef 签发失败"
        )
      );
    }
  }

  async read(input: WorkspaceFileReadInput): Promise<WorkspaceFileReadResult> {
    if (this.activeReads >= WORKSPACE_READ_CONCURRENCY_LIMIT) {
      failure("WORKSPACE_READ_BUSY", "Workspace 文件读取繁忙，请稍后重试");
    }
    this.activeReads += 1;
    try {
      return await this.readStable(input);
    } catch (cause) {
      this.deleteGrant(input.readRef);
      throw stableFailure(
        cause,
        new WorkspaceFileReadError(
          "WORKSPACE_FILE_READ_FAILED",
          "Workspace 文件读取失败"
        )
      );
    } finally {
      this.activeReads -= 1;
    }
  }

  clear() {
    this.grants.clear();
    this.refsByKey.clear();
  }

  private async issueStable(input: {
    effective: Extract<EffectiveWorkspace, { kind: "ready" }>;
    workspace: string;
    entry: WorkspaceReadEntry;
    metadata: WorkspaceReadMetadata;
  }) {
    this.prune();
    if (input.entry.entryKind !== "file") {
      failure("WORKSPACE_READ_DIRECTORY", "目录不提供 readRef");
    }
    const workspace = await realpath(input.workspace);
    const requestedPath = resolve(workspace, input.entry.path);
    const metadata = await lstat(requestedPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      failure("WORKSPACE_READ_NOT_FILE", "Workspace 条目不再是普通文件");
    }
    if (
      input.metadata.kind !== "file" ||
      input.metadata.dev !== Number(metadata.dev) ||
      input.metadata.ino !== Number(metadata.ino) ||
      input.metadata.size !== metadata.size ||
      input.metadata.mtimeMs !== metadata.mtimeMs
    ) {
      failure("WORKSPACE_READ_FILE_CHANGED", "Workspace 文件在签发期间发生变化");
    }
    const canonicalPath = await realpath(requestedPath);
    if (canonicalPath !== requestedPath || !contained(workspace, canonicalPath)) {
      failure("WORKSPACE_READ_OUTSIDE", "Workspace 路径越界或含软链");
    }
    const key = JSON.stringify([
      input.effective.identity,
      workspace,
      canonicalPath,
      input.entry.path,
      Number(metadata.dev),
      Number(metadata.ino),
      metadata.size,
      metadata.mtimeMs,
    ]);
    const existingRef = this.refsByKey.get(key);
    const existing = existingRef && this.grants.get(existingRef);
    if (existing && existing.expiresAt > this.now()) {
      existing.expiresAt = this.now() + READ_REF_TTL_MS;
      this.grants.delete(existingRef);
      this.grants.set(existingRef, existing);
      return existingRef;
    }
    if (existingRef) this.deleteGrant(existingRef);
    while (this.grants.size >= WORKSPACE_READ_REF_LIMIT) {
      const oldest = this.grants.keys().next().value;
      if (oldest === undefined) break;
      this.deleteGrant(oldest);
    }
    const readRef = `wr_${randomUUID().replaceAll("-", "")}`;
    const grant: ReadGrant = {
      key,
      identity: input.effective.identity,
      workspace,
      canonicalPath,
      path: input.entry.path,
      dev: Number(metadata.dev),
      ino: Number(metadata.ino),
      expiresAt: this.now() + READ_REF_TTL_MS,
    };
    this.grants.set(readRef, grant);
    this.refsByKey.set(key, readRef);
    return readRef;
  }

  private async readStable(
    input: WorkspaceFileReadInput
  ): Promise<WorkspaceFileReadResult> {
    this.prune();
    const grant = this.grants.get(input.readRef);
    if (!grant || grant.expiresAt <= this.now()) {
      failure("WORKSPACE_READ_REF_EXPIRED", "Workspace readRef 已失效");
    }
    await this.assertScope(input, grant);
    const canonicalPath = await realpath(grant.canonicalPath);
    if (canonicalPath !== grant.canonicalPath || !contained(grant.workspace, canonicalPath)) {
      failure("WORKSPACE_READ_PATH_CHANGED", "Workspace 路径已变化或越界");
    }
    const handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      this.assertFile(grant, before);
      const expectedImage = imageMime(grant.path);
      const limit = expectedImage
        ? WORKSPACE_READ_BYTE_LIMIT
        : WORKSPACE_TEXT_PREVIEW_BYTE_LIMIT;
      if (before.size > limit) {
        return await this.finish(input, grant, {
          kind: "metadata",
          reason: "too-large",
          ...this.base(grant, before),
        });
      }
      await this.testHooks.beforeBoundedRead?.();
      const bytes = await this.boundedRead(handle, limit, before.size);
      const after = await handle.stat();
      this.assertFile(grant, after);
      const base = this.base(grant, after);
      if (bytes.length > limit || after.size > limit) {
        return await this.finish(input, grant, {
          kind: "metadata",
          reason: "too-large",
          ...base,
        });
      }
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        failure("WORKSPACE_READ_FILE_CHANGED", "Workspace 文件在读取期间发生变化");
      }
      if (expectedImage) {
        const actual = sniffImage(bytes);
        if (actual !== expectedImage) {
          failure("WORKSPACE_READ_IMAGE_MISMATCH", "图片内容与扩展名不匹配");
        }
        return await this.finish(input, grant, {
          kind: "image",
          mediaType: actual,
          dataUrl: `data:${actual};base64,${bytes.toString("base64")}`,
          ...base,
        });
      }
      if (bytes.includes(0)) {
        return await this.finish(input, grant, {
          kind: "metadata",
          reason: "binary",
          ...base,
        });
      }
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return await this.finish(input, grant, {
          kind: "metadata",
          reason: "binary",
          ...base,
        });
      }
      return await this.finish(input, grant, {
        kind: "text",
        mediaType: "text/plain",
        content,
        ...base,
      });
    } finally {
      await handle.close();
    }
  }

  private async finish(
    input: WorkspaceFileReadInput,
    grant: ReadGrant,
    result: WorkspaceFileReadResult
  ) {
    await this.assertScope(input, grant);
    return result;
  }

  private async assertScope(input: WorkspaceFileReadInput, grant: ReadGrant) {
    const effective = this.resolveEffectiveWorkspace(input.scope);
    if (
      effective.kind !== "ready" ||
      effective.identity !== grant.identity ||
      (await realpath(effective.workspace)) !== grant.workspace
    ) {
      failure("WORKSPACE_READ_SCOPE_CHANGED", "Workspace identity 已变化，readRef 失效");
    }
  }

  private assertFile(
    grant: ReadGrant,
    metadata: Stats
  ) {
    if (!metadata.isFile()) {
      failure("WORKSPACE_READ_NOT_FILE", "Workspace 条目不再是文件");
    }
    if (
      Number(metadata.dev) !== grant.dev || Number(metadata.ino) !== grant.ino
    ) {
      failure("WORKSPACE_READ_INODE_CHANGED", "Workspace 文件 inode 已变化");
    }
  }

  private base(
    grant: ReadGrant,
    metadata: Stats
  ) {
    return {
      name: basename(grant.path),
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
    };
  }

  private async boundedRead(
    handle: Awaited<ReturnType<typeof open>>,
    limit: number,
    expectedSize: number
  ) {
    const allocation = Math.min(limit + 1, Math.max(1, expectedSize + 1));
    this.testHooks.onReadBufferAllocated?.(allocation);
    const buffer = Buffer.allocUnsafe(allocation);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  }

  private prune() {
    const now = this.now();
    for (const [readRef, grant] of this.grants) {
      if (grant.expiresAt <= now) this.deleteGrant(readRef);
    }
  }

  private deleteGrant(readRef: string) {
    const grant = this.grants.get(readRef);
    this.grants.delete(readRef);
    if (grant && this.refsByKey.get(grant.key) === readRef) {
      this.refsByKey.delete(grant.key);
    }
  }
}
