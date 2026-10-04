/**
 * [INPUT]: Scoped crypto identity, durable local JSON and frozen file records.
 * [OUTPUT]: Skills confirmed baselines, pending downlink journals, immutable head intents, locally retired generations, original file byte custody and staged-download hygiene.
 * [POS]: Private sync persistence; never writes control state into the user's content folder.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, link, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { encryptedSkillHeadSchema, skillFactsSchema, skillReceiptSchema } from "@ai-chat/cloud-protocol/skills/model";
import { frozenFileRecordSchema, type FrozenFileJournal } from "@ai-chat/cloud-protocol/blobs/encrypted/journal";
import { DurableJson, durableReplaceFile, isErrnoCode, DurableFileCorruptionError, quarantineDurableFile, syncDirectory } from "../../../persistence/durable-json";
const pending = z.object({ head: encryptedSkillHeadSchema, facts: skillFactsSchema, generationId: z.string().nullable(),
  before: skillFactsSchema.nullable(), sourceFacts: skillFactsSchema, sourceHash: z.string(), receipt: skillReceiptSchema.nullable() }).strict();
const entry = z.object({ head: encryptedSkillHeadSchema.nullable(), facts: skillFactsSchema.nullable(),
  observedHash: z.string().nullable(), generations: z.array(z.string()), digests: z.record(z.string(), z.string()).default({}),
  /* Generations local retention collected while the account still lists them.
     Without it the next downlink downloads exactly what the last pass deleted. */
  retired: z.array(z.string()).default([]), pending: pending.nullable(),
  projection: z.object({ id: z.string().min(1), head: encryptedSkillHeadSchema, facts: skillFactsSchema, generations: z.array(z.string()) }).nullable() }).strict();
const schema = z.object({ version: z.literal(1), entries: z.record(z.string(), entry), aliases: z.record(z.string(), z.string()), uploads: z.record(z.string(), z.number().int().nonnegative()).default({}) }).strict();
type SkillSyncEntry = z.infer<typeof entry>;
export const emptySkillSyncEntry = (): SkillSyncEntry => ({ head: null, facts: null, observedHash: null, generations: [], digests: {}, retired: [], pending: null, projection: null });
export const skillHash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export class SkillSyncState {
  readonly root: string;
  private file: DurableJson<z.infer<typeof schema>>;
  private initialized = false;
  constructor(userData: string, scope: unknown) {
    this.root = join(userData, "skills-sync", skillHash(scope));
    this.file = new DurableJson(join(this.root, "state.json"), schema, () => ({ version: 1, entries: {}, aliases: {}, uploads: {} }));
  }
  async initialize() {
    if (this.initialized) return;
    try { await this.file.initialize(); }
    catch (error) {
      if (!(error instanceof DurableFileCorruptionError)) throw error;
      await quarantineDurableFile(this.file.filePath);
      this.file = new DurableJson(this.file.filePath, schema, () => ({ version: 1, entries: {}, aliases: {}, uploads: {} })); await this.file.initialize();
    }
    await this.sweepStagedDownloads();
    this.initialized = true;
  }
  /* A staged download is consumed by the Store the moment it is published, and a
     quarantine is evidence of a pass that already failed. Neither survives a
     restart with any meaning, and both are full copies of Skill content. */
  private async sweepStagedDownloads() {
    const downloads = join(this.root, "downloads");
    for (const name of await readdir(downloads).catch(() => [] as string[])) {
      await rm(join(downloads, name), { recursive: true, force: true }).catch(() => undefined);
    }
  }
  /** Drops the frozen byte custody and the retry counters it was addressed by. */
  releaseFiles(identity: unknown, blobIds: readonly string[] = []) {
    return Promise.all([
      rm(join(this.root, "files", skillHash(identity)), { recursive: true, force: true }),
      blobIds.length
        ? this.file.mutate(state => { for (const blobId of blobIds) delete state.uploads[blobId]; })
        : Promise.resolve(),
    ]).then(() => undefined);
  }
  get(id: string) { return this.file.snapshot().entries[id] ?? emptySkillSyncEntry(); }
  projections() { return Object.entries(this.file.snapshot().entries).filter(([, value]) => value.projection !== null); }
  alias(id: string) { return this.file.snapshot().aliases[id] ?? null; }
  save(id: string, change: (entry: SkillSyncEntry) => void) { return this.file.mutate(state => { const record = state.entries[id] ??= emptySkillSyncEntry(); change(record); }); }
  setAlias(from: string, to: string) { return this.file.mutate(state => { state.aliases[from] = to; }); }
  uploadAttempt(blobId: string) { return this.file.snapshot().uploads[blobId] ?? 0; }
  renewUpload(blobId: string) { return this.file.mutate(state => { state.uploads[blobId] = (state.uploads[blobId] ?? 0) + 1; }); }
  journal(identity: unknown): FrozenFileJournal {
    const directory = join(this.root, "files", skillHash(identity));
    const path = (key: string) => join(directory, skillHash(key) + ".json");
    const read = async (key: string) => {
      try { return frozenFileRecordSchema.parse(JSON.parse(await readFile(path(key), "utf8"))); }
      catch (error) { if (isErrnoCode(error, "ENOENT")) return null; throw error; }
    };
    return { read, write: async (key, value) => {
      const previous = await read(key); if (previous) return previous;
      const checked = frozenFileRecordSchema.parse(value), target = path(key), temporary = target + `.${randomUUID()}.tmp`;
      await durableReplaceFile(temporary, JSON.stringify(checked));
      try {
        try { await link(temporary, target); await syncDirectory(dirname(target)); return checked; }
        catch (error) { if (!isErrnoCode(error, "EEXIST")) throw error; return (await read(key))!; }
      } finally { await rm(temporary, { force: true }); }
    } };
  }
  async close() { if (this.initialized) await this.file.closeAndFlush(); }
}
