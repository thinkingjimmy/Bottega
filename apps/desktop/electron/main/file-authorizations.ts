/**
 * [INPUT]: Depends on Node fs/path/crypto, shared
 * [OUTPUT]: Provides FileAuthorizationStore, authorizing with path+dev+ino and using reserve→commit/rollback
 * [POS]: The user file capacity of Electron main is limited; The authorization to bind specific inodes, the actual paths are given only to the main private staging
 */

import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import {
  ATTACHMENT_BYTE_LIMIT,
  ATTACHMENT_FILENAME_BYTE_LIMIT,
  type AgentWorkspaceScope,
} from "../../shared/agent-ipc";
import type { AuthorizedFile } from "../../shared/app-ipc";

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
    workspace: string
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
    });
    return { fileRef, name: input.name, mediaType: input.mediaType };
  }

  reserve(fileRef: string, workspace: string, name: string): FileReservation {
    const grant = this.grants.get(fileRef);
    if (!grant || grant.expiresAt <= this.now()) {
      this.grants.delete(fileRef);
      throw new Error("文件授权已过期或不存在");
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

  clear() {
    this.grants.clear();
  }
}
