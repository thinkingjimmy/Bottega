/**
 * [INPUT]: Depends on DurableJson, Node crypto/fs/path, and canonical CanvasRegistry identity fields
 * [OUTPUT]: Provides VersionHistory with content-addressed blobs, parent-linked capture, restore reads, explicit owner migration, and owner termination with garbage collection
 * [POS]: Design's historical ledger; it complements CanvasRegistry current truth and never infers versions from Git history
 */

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DurableJson, durableReplaceFile } from "../../persistence/durable-json";
import { canonicalDesignPath, type CanvasProvenance } from "./canvas-registry";

const MAX_CANVAS_BYTES = 8 * 1024 * 1024;
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const versionSchema = z
  .object({
    versionId: z.string().uuid(),
    stableWorkspaceOwnerId: z.string().min(1).max(256),
    canonicalRelativePath: z.string().min(1).max(512),
    digest: digestSchema,
    source: z.enum(["ai", "manual", "restore"]),
    parentVersion: z.string().uuid().nullable(),
    restoredFromVersion: z.string().uuid().optional(),
    provenance: z
      .object({
        chatId: z.string().min(1).max(128).optional(),
        conversationIncarnationId: z.string().min(1).max(128).optional(),
        turnId: z.string().min(1).max(256).optional(),
      })
      .strict(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
const fileSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    versions: z.array(versionSchema),
  })
  .strict();

type HistoryFile = z.infer<typeof fileSchema>;
export type CanvasVersion = z.infer<typeof versionSchema>;

export class VersionHistory {
  private readonly root: string;
  private readonly blobsRoot: string;
  private readonly file: DurableJson<HistoryFile>;

  constructor(
    userData: string,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID
  ) {
    this.root = join(userData, "design", "history");
    this.blobsRoot = join(this.root, "blobs");
    this.file = new DurableJson(join(this.root, "index.json"), fileSchema, () => ({
      schemaVersion: 1,
      revision: 0,
      versions: [],
    }));
  }

  async initialize() {
    await mkdir(this.blobsRoot, { recursive: true, mode: 0o700 });
    await this.file.initialize();
  }

  list(stableWorkspaceOwnerId: string, relativePath: string) {
    const path = canonicalDesignPath(relativePath);
    return this.file
      .snapshot()
      .versions.filter(
        (version) =>
          version.stableWorkspaceOwnerId === stableWorkspaceOwnerId &&
          version.canonicalRelativePath === path
      )
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  async capture(input: {
    stableWorkspaceOwnerId: string;
    relativePath: string;
    content: Buffer | string;
    source: CanvasVersion["source"];
    provenance?: CanvasProvenance;
    restoredFromVersion?: string;
  }) {
    const path = canonicalDesignPath(input.relativePath);
    const content = Buffer.isBuffer(input.content)
      ? input.content
      : Buffer.from(input.content, "utf8");
    if (content.byteLength > MAX_CANVAS_BYTES) {
      throw Object.assign(new Error("Design canvas 超过 8 MiB"), { status: 413 });
    }
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    await this.storeBlob(digest, content);
    return this.file.mutate((state) => {
      const lineage = state.versions.filter(
        (version) =>
          version.stableWorkspaceOwnerId === input.stableWorkspaceOwnerId &&
          version.canonicalRelativePath === path
      );
      const parent = lineage.at(-1) ?? null;
      if (parent?.digest === digest && input.source !== "restore") return parent;
      const version: CanvasVersion = {
        versionId: this.createId(),
        stableWorkspaceOwnerId: input.stableWorkspaceOwnerId,
        canonicalRelativePath: path,
        digest,
        source: input.source,
        parentVersion: parent?.versionId ?? null,
        ...(input.restoredFromVersion
          ? { restoredFromVersion: input.restoredFromVersion }
          : {}),
        provenance: input.provenance ?? {},
        createdAt: this.now(),
      };
      state.versions.push(version);
      state.revision += 1;
      return version;
    });
  }

  async readVersion(versionId: string) {
    const version = this.file.snapshot().versions.find(
      (candidate) => candidate.versionId === versionId
    );
    if (!version) throw Object.assign(new Error("Canvas version 不存在"), { status: 404 });
    return { version, content: await this.readBlob(version.digest) };
  }

  migrateOwner(fromOwnerId: string, toOwnerId: string) {
    if (fromOwnerId === toOwnerId) return Promise.resolve(0);
    return this.file.mutate((state) => {
      const moving = state.versions.filter(
        (version) => version.stableWorkspaceOwnerId === fromOwnerId
      );
      for (const version of moving) version.stableWorkspaceOwnerId = toOwnerId;
      if (moving.length) state.revision += 1;
      return moving.length;
    });
  }

  async terminateOwner(stableWorkspaceOwnerId: string) {
    const removed = await this.file.mutate((state) => {
      const retained = state.versions.filter(
        (version) => version.stableWorkspaceOwnerId !== stableWorkspaceOwnerId
      );
      const count = state.versions.length - retained.length;
      if (!count) return 0;
      state.versions = retained;
      state.revision += 1;
      return count;
    });
    await this.collectGarbage();
    return removed;
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }

  private blobPath(digest: string) {
    return join(this.blobsRoot, digest.slice("sha256:".length));
  }

  private async storeBlob(digest: string, content: Buffer) {
    const path = this.blobPath(digest);
    if (await exists(path)) return;
    await durableReplaceFile(path, content.toString("utf8"));
  }

  private async readBlob(digest: string) {
    const handle = await open(
      this.blobPath(digestSchema.parse(digest)),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_CANVAS_BYTES) {
        throw new Error("Canvas history blob 无效");
      }
      const content = await handle.readFile();
      const actual = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      if (actual !== digest) throw new Error("Canvas history blob 摘要不匹配");
      return content;
    } finally {
      await handle.close();
    }
  }

  private async collectGarbage() {
    const retained = new Set(
      this.file.snapshot().versions.map((version) => version.digest.slice(7))
    );
    for (const entry of await readdir(this.blobsRoot).catch(() => [])) {
      if (!retained.has(entry)) await rm(join(this.blobsRoot, entry), { force: true });
    }
  }
}

const exists = (path: string) => access(path).then(() => true, () => false);
