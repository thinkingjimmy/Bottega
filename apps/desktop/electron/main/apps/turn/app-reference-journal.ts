/**
 * [INPUT]: Depends on DurableJson, Crypto and shared AppReferenceJournalEntry
 * [OUTPUT]: Provides AppReferenceJournal; acquire-many single commit, prepared→active CAS, release-as-forget, and durable per-generation counts
 * [POS]: App generation 字节/容量托管的唯一真相源；内存里的桥接缓存替代不了这本账，它才是「引用归零」的证明
 */

import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type {
  AppReferenceJournalEntry,
  AppReferenceOwner,
  FrozenAppReferenceCapability,
} from "../../../../shared/app-lifecycle";
import type { Sha256Digest } from "../../../../shared/extensions-ipc";
import { DurableJson } from "../../persistence/durable-json";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ownerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["chat-turn", "relay-attempt"]), ownerId: z.string().min(1), ownerRevision: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("app-internal-turn"), ownerId: z.string().min(1), ownerRevision: z.number().int().nonnegative(), activationId: z.string().min(1) }).strict(),
]);
const capabilitySchema = z.object({
  data: z.enum(["none", "base-read", "base-row-write"]),
  fileRead: z.boolean(),
  useData: z.boolean(),
  backendId: z.string().min(1),
  snapshotDigest: digest,
}).strict();
const entrySchema = z.object({
  journalEntryId: z.string().uuid(),
  leaseId: z.string().uuid(),
  turnRequestId: z.string().min(1),
  owner: ownerSchema,
  appId: z.string().regex(/^[a-z0-9]{10}$/),
  generationId: z.string().min(1),
  contentDigest: digest,
  lifecycleRevision: z.number().int().nonnegative(),
  frozenCapability: capabilitySchema,
  capabilityDigest: digest,
  phase: z.enum(["prepared", "active", "released"]),
}).strict();
const fileSchema = z.object({ schemaVersion: z.literal(2), entries: z.array(entrySchema) }).strict();
type File = z.infer<typeof fileSchema>;

export class AppReferenceJournal {
  private readonly file: DurableJson<File>;

  constructor(userData: string) {
    this.file = new DurableJson(
      join(userData, "apps", "reference-journal.json"),
      fileSchema,
      () => ({ schemaVersion: 2, entries: [] })
    );
  }

  initialize() {
    return this.file.initialize();
  }

  acquireMany(input: {
    turnRequestId: string;
    owner: AppReferenceOwner;
    references: readonly {
      appId: string;
      generationId: string;
      contentDigest: Sha256Digest;
      lifecycleRevision: number;
      capability: FrozenAppReferenceCapability;
    }[];
  }) {
    return this.file.mutate((state) => {
      const existing = state.entries.filter(
        (entry) => entry.turnRequestId === input.turnRequestId
      );
      if (existing.length) return existing as AppReferenceJournalEntry[];
      const entries = input.references.map((reference) => {
        const { capability, ...identity } = reference;
        return entrySchema.parse({
          journalEntryId: randomUUID(),
          leaseId: randomUUID(),
          turnRequestId: input.turnRequestId,
          owner: input.owner,
          ...identity,
          frozenCapability: capability,
          capabilityDigest: hash(capability),
          phase: "prepared",
        });
      });
      state.entries.push(...entries);
      return entries as AppReferenceJournalEntry[];
    });
  }

  activateMany(turnRequestId: string) {
    return this.transition(turnRequestId, "prepared", "active");
  }

  /**
   * 释放即遗忘：turn 终态之后这条 reference 再也回答不了任何问题，留着只会让
   * 账本单调膨胀——而它每轮要被重新解析并 fsync 三次。删掉才是它的终态。
   */
  releaseMany(turnRequestId: string) {
    return this.file.mutate((state) => {
      const released: AppReferenceJournalEntry[] = [];
      state.entries = state.entries.filter((entry) => {
        if (entry.turnRequestId !== turnRequestId) return true;
        released.push({ ...entry, phase: "released" } as AppReferenceJournalEntry);
        return false;
      });
      return released;
    });
  }

  /** 本轮已激活的 logical lease；custody dependency 只认这一档。 */
  listActive(turnRequestId: string) {
    return this.file
      .snapshot()
      .entries.filter(
        (entry) =>
          entry.turnRequestId === turnRequestId && entry.phase === "active"
      ) as AppReferenceJournalEntry[];
  }

  /**
   * D17 conversion 准入用：该 owner 名下尚未 released 的 reference。撤销 grant 不会
   * 让它消失——已冻结的能力要等本轮 terminal 才释放（D19），所以「有没有 grant」
   * 回答不了「现在还有没有人在读这个 App」。
   */
  listByOwner(ownerId: string) {
    return this.file
      .snapshot()
      .entries.filter(
        (entry) => entry.owner.ownerId === ownerId && entry.phase !== "released"
      ) as AppReferenceJournalEntry[];
  }

  isActive(journalEntryId: string) {
    return this.file
      .snapshot()
      .entries.some(
        (entry) =>
          entry.journalEntryId === journalEntryId && entry.phase === "active"
      );
  }

  count(appId: string, generationId: string) {
    const entries = this.file.snapshot().entries.filter(
      (entry) =>
        entry.appId === appId &&
        entry.generationId === generationId &&
        entry.phase !== "released"
    );
    return {
      providerId: "app-reference",
      count: entries.length,
      evidenceIds: entries.map((entry) => entry.journalEntryId),
    };
  }

  private transition(
    turnRequestId: string,
    from: File["entries"][number]["phase"],
    to: File["entries"][number]["phase"]
  ) {
    return this.file.mutate((state) => {
      const entries = state.entries.filter(
        (entry) => entry.turnRequestId === turnRequestId
      );
      if (!entries.length) throw new Error("App reference intent 不存在");
      for (const entry of entries) {
        if (entry.phase === to) continue;
        if (entry.phase !== from) throw new Error("APP_REFERENCE_PHASE_MISMATCH");
        entry.phase = to;
      }
      return entries as AppReferenceJournalEntry[];
    });
  }
}

function hash(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
