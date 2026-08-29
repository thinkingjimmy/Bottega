/**
 * [INPUT]: Depends on DurableJson and cryptographic canvas digests supplied by secure workspace readers
 * [OUTPUT]: Provides CanvasRegistry, the sole isCanonicalDesignPath predicate (case-sensitive design/ prefix), case-insensitive designPathIdentity dedup, registered-only listing, digest updates, owner migration, and owner termination
 * [POS]: Design's durable canvas identity ledger keyed only by stable workspace owner plus canonical relative path
 */

import { join, posix } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const provenanceSchema = z
  .object({
    chatId: z.string().min(1).max(128).optional(),
    conversationIncarnationId: z.string().min(1).max(128).optional(),
    turnId: z.string().min(1).max(256).optional(),
  })
  .strict();
const entrySchema = z
  .object({
    stableWorkspaceOwnerId: z.string().min(1).max(256),
    canonicalRelativePath: z.string().min(1).max(512),
    currentDigest: digestSchema,
    registeredAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    provenance: provenanceSchema,
  })
  .strict();
const fileSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    entries: z.array(entrySchema),
  })
  .strict();

type RegistryFile = z.infer<typeof fileSchema>;
export type CanvasProvenance = z.infer<typeof provenanceSchema>;
export type CanvasRegistryEntry = z.infer<typeof entrySchema>;

// design/ 前缀大小写敏感：磁盘目录恒为小写 design/，若前缀也走 /i，则
// DESIGN/hero.html 与 design/hero.html 会 alias 成同一文件的两个身份。文件名段
// （含 .html 扩展名）保持大小写不敏感，与 workspace-access 的 readdir 过滤器一致，
// 大小写保真用于文件 I/O。
const DESIGN_PATH_PREFIX = "design/";
const DESIGN_LEAF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}\.html$/i;

/**
 * 唯一权威的 Design canvas 路径判定式。design-ipc.ts 的校验器应 import 此谓词
 * 而非自带正则，才能与登记表保持 lockstep（前缀大小写敏感）。
 */
export function isCanonicalDesignPath(value: string): boolean {
  return (
    !value.includes("\\") &&
    !value.includes("\0") &&
    value === posix.normalize(value) &&
    value.startsWith(DESIGN_PATH_PREFIX) &&
    DESIGN_LEAF_PATTERN.test(value.slice(DESIGN_PATH_PREFIX.length))
  );
}

/**
 * 身份键：大小写不敏感 FS（macOS/Windows 默认）上 design/Hero.html 与
 * design/hero.html 是同一物理文件，登记时必须折叠到同一条目，避免分裂成两个
 * artboard 身份而互相覆盖。仅用于比较/去重；存储与文件 I/O 仍用大小写保真的
 * canonicalRelativePath。
 */
export function designPathIdentity(canonicalPath: string) {
  return canonicalPath.toLowerCase();
}

export function canonicalDesignPath(value: string) {
  if (!isCanonicalDesignPath(value)) {
    throw Object.assign(new Error("Design canvas path 无效"), { status: 400 });
  }
  return value;
}

export class CanvasRegistry {
  private readonly file: DurableJson<RegistryFile>;

  constructor(userData: string, private readonly now: () => number = Date.now) {
    this.file = new DurableJson(
      join(userData, "design", "canvas-registry.json"),
      fileSchema,
      () => ({ schemaVersion: 1, revision: 0, entries: [] })
    );
  }

  initialize() {
    return this.file.initialize();
  }

  revision() {
    return this.file.snapshot().revision;
  }

  list(stableWorkspaceOwnerId: string) {
    const snapshot = this.file.snapshot();
    return {
      revision: snapshot.revision,
      entries: snapshot.entries
        .filter((entry) => entry.stableWorkspaceOwnerId === stableWorkspaceOwnerId)
        .sort((left, right) =>
          left.canonicalRelativePath.localeCompare(right.canonicalRelativePath)
        ),
    };
  }

  get(stableWorkspaceOwnerId: string, relativePath: string) {
    const identity = designPathIdentity(canonicalDesignPath(relativePath));
    return this.file.snapshot().entries.find(
      (entry) =>
        entry.stableWorkspaceOwnerId === stableWorkspaceOwnerId &&
        designPathIdentity(entry.canonicalRelativePath) === identity
    ) ?? null;
  }

  register(input: {
    stableWorkspaceOwnerId: string;
    relativePath: string;
    digest: string;
    provenance?: CanvasProvenance;
  }) {
    const path = canonicalDesignPath(input.relativePath);
    const identity = designPathIdentity(path);
    const digest = digestSchema.parse(input.digest);
    return this.file.mutate((state) => {
      // 按大小写不敏感身份去重：已存在的条目（哪怕大小写不同）视为同一文件，
      // 就地更新并沿用其大小写保真的 canonicalRelativePath，绝不新增第二条。
      const current = state.entries.find(
        (entry) =>
          entry.stableWorkspaceOwnerId === input.stableWorkspaceOwnerId &&
          designPathIdentity(entry.canonicalRelativePath) === identity
      );
      const timestamp = this.now();
      if (current) {
        if (current.currentDigest === digest) return current;
        current.currentDigest = digest;
        current.updatedAt = timestamp;
        current.provenance = provenanceSchema.parse(input.provenance ?? {});
        state.revision += 1;
        return current;
      }
      const entry: CanvasRegistryEntry = {
        stableWorkspaceOwnerId: input.stableWorkspaceOwnerId,
        canonicalRelativePath: path,
        currentDigest: digest,
        registeredAt: timestamp,
        updatedAt: timestamp,
        provenance: provenanceSchema.parse(input.provenance ?? {}),
      };
      state.entries.push(entry);
      state.revision += 1;
      return entry;
    });
  }

  terminateOwner(stableWorkspaceOwnerId: string) {
    return this.file.mutate((state) => {
      const retained = state.entries.filter(
        (entry) => entry.stableWorkspaceOwnerId !== stableWorkspaceOwnerId
      );
      const removed = state.entries.length - retained.length;
      if (!removed) return 0;
      state.entries = retained;
      state.revision += 1;
      return removed;
    });
  }

  migrateOwner(fromOwnerId: string, toOwnerId: string) {
    if (fromOwnerId === toOwnerId) return Promise.resolve(0);
    return this.file.mutate((state) => {
      const moving = state.entries.filter(
        (entry) => entry.stableWorkspaceOwnerId === fromOwnerId
      );
      for (const entry of moving) {
        const conflict = state.entries.find(
          (candidate) =>
            candidate.stableWorkspaceOwnerId === toOwnerId &&
            candidate.canonicalRelativePath === entry.canonicalRelativePath
        );
        if (conflict) throw Object.assign(new Error("Canvas owner migration 冲突"), { status: 409 });
      }
      for (const entry of moving) entry.stableWorkspaceOwnerId = toOwnerId;
      if (moving.length) state.revision += 1;
      return moving.length;
    });
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }
}
