/**
 * [INPUT]: Depends on DurableJson, Node crypto/fs/path, and caller-supplied installation lineage identifiers
 * [OUTPUT]: Provides DesignCustodyLedger with stable data roots, singleton-slot reattachment, forced-clean replacement, orphaning, and explicit deletion tombstones
 * [POS]: Design's durable user-data owner outside AppStore; uninstalling code can never implicitly delete canvas data
 */

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";

const ID = /^[A-Za-z0-9:_-]{1,160}$/;
const entrySchema = z
  .object({
    custodySlotId: z.string().regex(ID),
    dataCustodyId: z.string().uuid(),
    appId: z.string().regex(/^[a-z0-9]{10}$/).nullable(),
    presetId: z.string().min(1).max(64),
    state: z.enum(["active", "orphaned", "explicitly-deleted"]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    deletedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
const fileSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    entries: z.array(entrySchema),
  })
  .strict();

type CustodyFile = z.infer<typeof fileSchema>;
export type DesignCustodyEntry = z.infer<typeof entrySchema>;

export class DesignCustodyLedger {
  readonly root: string;
  private readonly dataRoot: string;
  private readonly file: DurableJson<CustodyFile>;

  constructor(
    userData: string,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID
  ) {
    this.root = join(userData, "design");
    this.dataRoot = join(this.root, "data");
    this.file = new DurableJson(join(this.root, "custody.json"), fileSchema, () => ({
      schemaVersion: 1,
      revision: 0,
      entries: [],
    }));
  }

  async initialize() {
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
    await this.file.initialize();
  }

  list() {
    return this.file.snapshot().entries;
  }

  activeForApp(appId: string) {
    return this.list().find(
      (entry) => entry.appId === appId && entry.state === "active"
    ) ?? null;
  }

  pathFor(entry: Pick<DesignCustodyEntry, "dataCustodyId">) {
    return join(this.dataRoot, entry.dataCustodyId);
  }

  async activate(input: {
    custodySlotId: string;
    appId: string;
    presetId: string;
  }) {
    const entry = await this.file.mutate((state) => {
      const reusable = [...state.entries]
        .reverse()
        .find(
          (candidate) =>
            candidate.custodySlotId === input.custodySlotId &&
            candidate.state !== "explicitly-deleted"
        );
      const timestamp = this.now();
      if (reusable) {
        reusable.appId = input.appId;
        reusable.presetId = input.presetId;
        reusable.state = "active";
        reusable.updatedAt = timestamp;
        state.revision += 1;
        return reusable;
      }
      const created: DesignCustodyEntry = {
        ...input,
        dataCustodyId: this.createId(),
        state: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.entries.push(created);
      state.revision += 1;
      return created;
    });
    await mkdir(this.pathFor(entry), { recursive: true, mode: 0o700 });
    return entry;
  }

  // 刻意不自行路由 DesignStorageOperations：唯一调用方是 custody-deletion saga 的
  // replacement 步骤，它已在 operations.run 内调用本方法。若此处再 run 一次会与外层
  // 同一串行队列重入死锁。故激活的串行化由该调用方持有，本方法只做幂等 mutate。
  async activateFresh(input: {
    custodySlotId: string;
    appId: string;
    presetId: string;
    dataCustodyId: string;
  }) {
    const entry = await this.file.mutate((state) => {
      const replay = state.entries.find(
        (candidate) => candidate.dataCustodyId === input.dataCustodyId
      );
      if (replay) {
        if (
          replay.custodySlotId !== input.custodySlotId ||
          replay.appId !== input.appId ||
          replay.presetId !== input.presetId ||
          replay.state !== "active"
        ) {
          throw new Error("Design replacement custody receipt 不匹配");
        }
        return replay;
      }
      const timestamp = this.now();
      const created: DesignCustodyEntry = {
        ...input,
        state: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.entries.push(created);
      state.revision += 1;
      return created;
    });
    await mkdir(this.pathFor(entry), { recursive: true, mode: 0o700 });
    return entry;
  }

  orphanApp(appId: string) {
    return this.file.mutate((state) => {
      const entry = state.entries.find(
        (candidate) => candidate.appId === appId && candidate.state === "active"
      );
      if (!entry) return null;
      entry.appId = null;
      entry.state = "orphaned";
      entry.updatedAt = this.now();
      state.revision += 1;
      return entry;
    });
  }

  explicitlyDelete(dataCustodyId: string) {
    return this.file.mutate((state) => {
      const entry = state.entries.find(
        (candidate) => candidate.dataCustodyId === dataCustodyId
      );
      if (!entry) return null;
      if (entry.state === "explicitly-deleted") return entry;
      const timestamp = this.now();
      entry.appId = null;
      entry.state = "explicitly-deleted";
      entry.updatedAt = timestamp;
      entry.deletedAt = timestamp;
      state.revision += 1;
      return entry;
    });
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }
}
