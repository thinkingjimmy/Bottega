/**
 * [INPUT]: Depends on Node durable directory/file primitives, canonical Registry digests, DurableJson claims, and SerialQueue
 * [OUTPUT]: Provides one shared ExtensionContentStore per packages root with intent-before-publish claims, canonical tree verification, serialized adoption/GC, and startup reconciliation
 * [POS]: Extensions content-addressed byte authority; installer and uninstall never race filesystem existence checks outside this owner
 */

import { randomUUID } from "node:crypto";
import { open, opendir, readFile, rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import type { Sha256Digest } from "../../../shared/extensions-ipc";
import {
  DurableJson,
  ensureDurableDirectory,
} from "../persistence/durable-json";
import { SerialQueue } from "../persistence/serial-queue";
import { digestCanonical } from "./registry-store";

const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as Sha256Digest);
const claimSchema = z.object({
  claimId: z.string().uuid(),
  contentDigest: digestSchema,
  createdAt: z.number().int().nonnegative(),
}).strict();
const fileSchema = z.object({
  schemaVersion: z.literal(1),
  claims: z.array(claimSchema),
}).strict().superRefine((file, context) => {
  const ids = new Set<string>();
  for (const [index, claim] of file.claims.entries()) {
    if (ids.has(claim.claimId)) {
      context.addIssue({
        code: "custom",
        path: ["claims", index, "claimId"],
        message: "content claimId 必须唯一",
      });
    }
    ids.add(claim.claimId);
  }
});

type ContentFile = z.infer<typeof fileSchema>;

const stores = new Map<string, ExtensionContentStore>();

export function extensionContentStore(packagesRoot: string) {
  let store = stores.get(packagesRoot);
  if (!store) {
    store = new ExtensionContentStore(packagesRoot);
    stores.set(packagesRoot, store);
  }
  return store;
}

export class ExtensionContentStore {
  private readonly file: DurableJson<ContentFile>;
  private readonly queue = new SerialQueue();
  private initialization: Promise<void> | null = null;

  constructor(readonly packagesRoot: string) {
    this.file = new DurableJson(
      join(packagesRoot, "..", "content-claims.json"),
      fileSchema,
      () => ({ schemaVersion: 1, claims: [] })
    );
  }

  initialize() {
    this.initialization ??= this.file.initialize().then(() => undefined);
    return this.initialization;
  }

  async claim(contentDigest: Sha256Digest, now = Date.now()) {
    await this.initialize();
    const claim = claimSchema.parse({
      claimId: randomUUID(),
      contentDigest,
      createdAt: now,
    });
    await this.file.mutate((state) => {
      state.claims.push(claim);
    });
    return claim.claimId;
  }

  async adopt(
    claimId: string,
    stagedRoot: string,
    expectedDigest: Sha256Digest
  ) {
    await this.initialize();
    return this.queue.enqueue(async () => {
      this.assertClaim(claimId, expectedDigest);
      const stagedDigest = await digestExtensionPackageTree(stagedRoot);
      if (stagedDigest !== expectedDigest) {
        throw new Error("staged Extension content digest 与 claim 不一致");
      }
      await ensureDurableDirectory(this.packagesRoot);
      const target = this.contentRoot(expectedDigest);
      if (await directoryExists(target)) {
        const existingDigest = await digestExtensionPackageTree(target);
        if (existingDigest !== expectedDigest) {
          throw new Error("existing Extension content root digest 不一致，拒绝复用或覆盖");
        }
        return target;
      }
      await rename(stagedRoot, target);
      await syncDirectory(this.packagesRoot);
      return target;
    });
  }

  async releaseClaim(claimId: string) {
    await this.initialize();
    await this.file.mutate((state) => {
      state.claims = state.claims.filter((claim) => claim.claimId !== claimId);
    });
  }

  async collect(
    retainedDigests: ReadonlySet<Sha256Digest>,
    afterRemove?: (contentRoot: string) => void | Promise<void>
  ) {
    await this.initialize();
    return this.queue.enqueue(async () => {
      const retained = new Set(
        [...retainedDigests].map((digest) => digest.replace(/^sha256:/, ""))
      );
      for (const claim of this.file.snapshot().claims) {
        retained.add(claim.contentDigest.replace(/^sha256:/, ""));
      }
      await this.collectRoots(retained, afterRemove);
    });
  }

  /** A fresh process has no live pre-publish owner; durable domain ledgers re-declare all truth. */
  async reconcile(retainedDigests: ReadonlySet<Sha256Digest>) {
    await this.initialize();
    return this.queue.enqueue(async () => {
      const retained = new Set(
        [...retainedDigests].map((digest) => digest.replace(/^sha256:/, ""))
      );
      await this.collectRoots(retained);
      await this.file.mutate((state) => {
        state.claims = [];
      });
    });
  }

  contentRoot(contentDigest: string) {
    return join(this.packagesRoot, contentDigest.replace(/^sha256:/, ""));
  }

  private assertClaim(claimId: string, contentDigest: Sha256Digest) {
    const claim = this.file.snapshot().claims.find((item) => item.claimId === claimId);
    if (!claim || claim.contentDigest !== contentDigest) {
      throw new Error("Extension content publish claim 不存在或身份漂移");
    }
  }

  private async collectRoots(
    retained: ReadonlySet<string>,
    afterRemove?: (contentRoot: string) => void | Promise<void>
  ) {
    let removed = false;
    for (const name of await contentRootNames(this.packagesRoot)) {
      if (retained.has(name)) continue;
      const root = join(this.packagesRoot, name);
      await rm(root, { recursive: true, force: true });
      removed = true;
      await afterRemove?.(root);
    }
    if (removed) await syncDirectory(this.packagesRoot, true);
  }
}

export async function digestExtensionPackageTree(
  root: string
): Promise<Sha256Digest> {
  const files: Array<{
    path: string;
    bytes: number;
    digest: Sha256Digest;
  }> = [];
  await walk(root, root, files);
  files.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8"))
  );
  return digestCanonical(files);
}

async function walk(
  root: string,
  current: string,
  files: Array<{ path: string; bytes: number; digest: Sha256Digest }>
) {
  const directory = await opendir(current);
  for await (const entry of directory) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Extension content tree 拒绝 symlink：${relative(root, path)}`);
    }
    if (entry.isDirectory()) {
      await walk(root, path, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Extension content tree 含非普通文件：${relative(root, path)}`);
    }
    const content = await readFile(path);
    files.push({
      path: relative(root, path),
      bytes: content.byteLength,
      digest: digestCanonical(content.toString("base64")),
    });
  }
}

async function contentRootNames(packagesRoot: string) {
  const names: string[] = [];
  try {
    const directory = await opendir(packagesRoot);
    for await (const entry of directory) {
      if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) {
        names.push(entry.name);
      }
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  return names;
}

async function directoryExists(path: string) {
  try {
    const directory = await opendir(path);
    await directory.close();
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

async function syncDirectory(path: string, allowMissing = false) {
  let directory;
  try {
    directory = await open(path, "r");
  } catch (cause) {
    if (allowMissing && (cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
