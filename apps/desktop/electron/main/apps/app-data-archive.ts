/**
 * [INPUT]: Depends on DurableJson, crypto and immutable snapshot/provenance digest
 * [OUTPUT]: Provides AppDataArchiveStore; archive-pending→ owned
 * [POS]: The data owner of the retained server is not a user of the apps; The archive is independently verifiable after the App record is deleted
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { Sha256Digest } from "../../../shared/extensions-ipc";
import { DurableJson } from "../persistence/durable-json";

const archiveSchema = z.object({
  archiveId: z.string().uuid(),
  sourceAppId: z.string().regex(/^[a-z0-9]{10}$/),
  dataEpochId: z.string().min(1),
  snapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  provenanceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  phase: z.enum(["archive-pending", "owned"]),
  createdAt: z.number().int().nonnegative(),
}).strict();
const fileSchema = z.object({ schemaVersion: z.literal(1), archives: z.array(archiveSchema) }).strict();
type File = z.infer<typeof fileSchema>;

export class AppDataArchiveStore {
  private readonly file: DurableJson<File>;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "app-data-archives", "archives.json"),
      fileSchema,
      () => ({ schemaVersion: 1, archives: [] })
    );
  }

  initialize() {
    return this.file.initialize();
  }

  prepare(input: {
    sourceAppId: string;
    dataEpochId: string;
    snapshotDigest: Sha256Digest;
    provenanceDigest: Sha256Digest;
  }) {
    return this.file.mutate((state) => {
      const existing = state.archives.find(
        (archive) => archive.dataEpochId === input.dataEpochId
      );
      if (existing) return existing;
      const archive = archiveSchema.parse({
        ...input,
        archiveId: randomUUID(),
        phase: "archive-pending",
        createdAt: Date.now(),
      });
      state.archives.push(archive);
      return archive;
    });
  }

  commit(archiveId: string) {
    return this.file.mutate((state) => {
      const archive = state.archives.find((item) => item.archiveId === archiveId);
      if (!archive) throw new Error("App data archive 不存在");
      archive.phase = "owned";
      return archive;
    });
  }
}
