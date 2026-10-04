/**
 * [INPUT]: Depends on Node fs/path/crypto and shared agent-ipc/app-ipc attachment types
 * [OUTPUT]: Provides FileAuthorizationStore with renderer-window ownership, atomic ref rebinding, crash cleanup, main-only grant inspection, and path+dev+ino reserve→commit/rollback
 * [POS]: apps/desktop/electron/main/workspace/files; Electron main's boundary for renderer-selected files; grants bind to one path+dev+ino, and real paths are exposed only to main-owned private staging
 */

import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import {
  ATTACHMENT_BYTE_LIMIT,
  ATTACHMENT_FILENAME_BYTE_LIMIT,
  type AgentWorkspaceScope,
} from "../../../../shared/ipc/agent/agent-ipc";
import { FILE_GRANT_EXPIRED, type AuthorizedFile } from "../../../../shared/ipc/apps/app-ipc";

const FILE_REF_TTL_MS = 30 * 60_000;

type FileGrant = {
  path: string;
  name: string;
  mediaType: string;
  byteSize: number;
  device: number;
  inode: number;
  workspace: string;
  expiresAt: number;
  reserved: boolean;
  releaseRequested: boolean;
  rendererWindowId: string;
};

export type FileReservation = {
  path: string;
  name: string;
  mediaType: string;
  byteSize: number;
  device: number;
  inode: number;
  commit: () => void;
  rollback: () => void;
};

const byteLength = (value: string) => Buffer.byteLength(value, "utf8");

export class FileAuthorizationStore {
  private readonly grants = new Map<string, FileGrant>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = FILE_REF_TTL_MS
  ) {}

  async authorize(
    input: {
      path: string;
      name: string;
      mediaType: string;
      scope?: AgentWorkspaceScope;
    },
    workspace: string,
    rendererWindowId = "main"
  ): Promise<AuthorizedFile> {
    if (!isAbsolute(input.path) || !input.name.trim()) {
      throw new Error("文件授权参数无效");
    }
    if (byteLength(input.name) > ATTACHMENT_FILENAME_BYTE_LIMIT) {
      throw new Error("文件名过长");
    }
    if (byteLength(input.mediaType) > 256) throw new Error("文件类型过长");
    const canonicalPath = await realpath(input.path);
    const metadata = await stat(canonicalPath);
    if (!metadata.isFile()) throw new Error("只能授权普通文件");
    if (metadata.size > ATTACHMENT_BYTE_LIMIT) {
      throw new Error("附件不能超过 8 MB");
    }
    if (basename(canonicalPath) !== input.name) {
      throw new Error("文件名与用户选择不一致");
    }
    const fileRef = randomUUID();
    this.grants.set(fileRef, {
      path: canonicalPath,
      name: input.name,
      mediaType: input.mediaType,
      byteSize: metadata.size,
      device: metadata.dev,
      inode: metadata.ino,
      workspace,
      expiresAt: this.now() + this.ttlMs,
      reserved: false,
      releaseRequested: false,
      rendererWindowId,
    });
    return { fileRef, name: input.name, mediaType: input.mediaType };
  }

  reserve(fileRef: string, workspace: string, name: string): FileReservation {
    const grant = this.grants.get(fileRef);
    if (!grant || grant.expiresAt <= this.now()) {
      this.grants.delete(fileRef);
      // The renderer renews grants from the retained File; the typed marker lets it name the file it could not renew.
      throw Object.assign(new Error(`${FILE_GRANT_EXPIRED}:${name}`), { code: FILE_GRANT_EXPIRED });
    }
    if (grant.workspace !== workspace || grant.name !== name) {
      throw new Error("文件授权不属于当前 workspace");
    }
    if (grant.reserved) throw new Error("文件授权正在使用");
    grant.reserved = true;
    let active = true;
    return {
      path: grant.path,
      name: grant.name,
      mediaType: grant.mediaType,
      byteSize: grant.byteSize,
      device: grant.device,
      inode: grant.inode,
      commit: () => {
        if (!active) return;
        active = false;
        this.grants.delete(fileRef);
      },
      rollback: () => {
        if (!active) return;
        active = false;
        const current = this.grants.get(fileRef);
        if (current !== grant) return;
        if (current.releaseRequested) this.grants.delete(fileRef);
        else current.reserved = false;
      },
    };
  }

  release(fileRef: string) {
    const grant = this.grants.get(fileRef);
    if (!grant) return;
    if (grant.reserved) {
      grant.releaseRequested = true;
      return;
    }
    this.grants.delete(fileRef);
  }

  releaseForWindow(fileRef: string, rendererWindowId: string) {
    const grant = this.liveGrant(fileRef);
    if (!grant || grant.rendererWindowId !== rendererWindowId) {
      throw new Error("文件授权不属于当前窗口");
    }
    this.release(fileRef);
  }

  /** Main-only facts of a live grant this window owns, so a durable draft (F-12) records them instead of trusting the renderer. */
  inspect(fileRef: string, rendererWindowId: string) {
    const grant = this.liveGrant(fileRef);
    if (!grant || grant.rendererWindowId !== rendererWindowId) return null;
    return { path: grant.path, name: grant.name, mediaType: grant.mediaType, device: grant.device, inode: grant.inode };
  }

  releaseWindow(rendererWindowId: string) {
    for (const [fileRef, grant] of this.grants) {
      if (grant.rendererWindowId === rendererWindowId) this.release(fileRef);
    }
  }

  rebindWindow(
    fileRefs: readonly string[],
    sourceWindowId: string,
    targetWindowId: string,
    workspace: string
  ) {
    const unique = [...new Set(fileRefs)];
    const grants = unique.map((fileRef) => {
      const grant = this.liveGrant(fileRef);
      if (
        !grant ||
        grant.rendererWindowId !== sourceWindowId ||
        grant.workspace !== workspace ||
        grant.reserved
      ) {
        throw new Error("文件授权无法迁移到目标窗口");
      }
      return grant;
    });
    for (const grant of grants) grant.rendererWindowId = targetWindowId;
  }

  clear() {
    this.grants.clear();
  }

  private liveGrant(fileRef: string) {
    const grant = this.grants.get(fileRef);
    if (!grant || grant.expiresAt <= this.now()) {
      this.grants.delete(fileRef);
      return undefined;
    }
    return grant;
  }
}
