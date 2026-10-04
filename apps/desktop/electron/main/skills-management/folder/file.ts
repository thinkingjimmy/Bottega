/**
 * [INPUT]: Depends on forward-tolerant Skill content, private acquisition facts and durable publication.
 * [OUTPUT]: Implements portable generations with private provenance, conversion notices and projection receipts committed with the same manifest, under an optional revision precondition.
 * [POS]: Folder adapter; immutable content precedes the manifest and original local intent precedes publication.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { skillSlugSchema } from "@ai-chat/cloud-protocol/skills/identity";
import { libraryDirectory, libraryObjectId } from "../../library/paths";
import { durableReplaceFile, isErrnoCode } from "../../persistence/durable-json";
import { storeSchema, type Store } from "./model";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const generationSchema = z.object({ generationId: id, digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), importedAt: z.number().int().nonnegative() });
const portableSchema = z.object({ version: z.literal(1), contentRevision: z.number().int().nonnegative(), entries: z.array(z.object({
  libraryId: id, name: skillSlugSchema, displayName: z.string().min(1), description: z.string().min(1),
  requires: z.string().optional(), enabled: z.boolean(), activeGenerationId: id, generations: z.array(generationSchema).min(1),
  tombstoneAt: z.number().int().nonnegative().nullable().default(null),
})) });
type Portable = z.infer<typeof portableSchema>;
const localSchema = z.object({ version: z.literal(1), contentRevision: z.number().int().nonnegative(), contentHash: z.string(), projections: z.record(z.string(), z.string()).optional(), entries: z.array(
  z.object({ libraryId: id, provenance: storeSchema.shape.entries.element.shape.provenance, origin: storeSchema.shape.entries.element.shape.origin,
    notice: storeSchema.shape.entries.element.shape.notice, revisions: z.record(z.string(), z.string()) })) });
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class SkillsFolderFile {
  private state: Store = { schemaVersion: 3, revision: 0, entries: [] };
  private pendingRecovery = false;
  readonly filePath: string;
  constructor(userData: string, private root: () => string | null) { this.filePath = join(userData, "unified-skills", "library-local.json"); }
  snapshot(): Store { return structuredClone(this.state); }
  async initialize() {
    if (!this.root()) { this.state = { schemaVersion: 3, revision: 0, entries: [] }; return; }
    const path = join(await libraryDirectory(this.root()!, "skills"), "skills.json");
    const bytes = await readOptional(path);
    const portable = bytes === null ? { version: 1 as const, contentRevision: 0, entries: [] } : portableSchema.parse(JSON.parse(bytes));
    const ids = new Set<string>(), slugs = new Set<string>();
    for (const entry of portable.entries) {
      if (ids.has(entry.libraryId) || entry.tombstoneAt === null && slugs.has(entry.name) || !entry.generations.some(g => g.generationId === entry.activeGenerationId)) throw new Error("SKILL_FOLDER_IDENTITY_INVALID");
      ids.add(entry.libraryId); if (entry.tombstoneAt === null) slugs.add(entry.name);
    }
    let local = await this.readLocal(this.filePath);
    const intent = await this.readLocal(this.filePath + ".intent");
    if (intent && intent.contentRevision === portable.contentRevision && intent.contentHash === fingerprint(portable)) {
      await durableReplaceFile(this.filePath, JSON.stringify(intent) + "\n"); local = intent;
    }
    if (intent) await rm(this.filePath + ".intent", { force: true });
    const matchedLocal = local?.contentRevision === portable.contentRevision && local.contentHash === fingerprint(portable) ? local : null;
    this.state = storeSchema.parse({ schemaVersion: 3, revision: portable.contentRevision, projections: matchedLocal?.projections, entries: portable.entries.map(entry => {
      const facts = local?.contentRevision === portable.contentRevision && local.contentHash === fingerprint(portable)
        ? local.entries.find(item => item.libraryId === entry.libraryId) : undefined;
      return { ...entry, provenance: facts?.provenance ?? { kind: "local-folder", sourcePath: join(this.root()!, "skills", entry.libraryId, entry.activeGenerationId),
        sourceIdentity: `restored:${entry.libraryId}`, importedAt: entry.generations[0]!.importedAt }, origin: facts?.origin ?? null, notice: facts?.notice ?? null,
        generations: entry.generations.map(generation => ({ ...generation, packageDirectory: generation.digest.slice(7), sourceRevision: facts?.revisions[generation.generationId] ?? `restored:${generation.digest}` })) };
    }) });
    this.pendingRecovery = false;
  }
  /**
   * `expectedRevision` is re-validated AFTER a deferred recovery reload: the caller
   * computed its change from a snapshot, and a reload replaces that snapshot with
   * whatever is on disk. Applying the change anyway would commit generations and
   * facts derived from state that no longer exists.
   */
  async mutate<T>(change: (state: Store) => T, expectedRevision?: number): Promise<T> {
    if (this.pendingRecovery) await this.initialize();
    if (expectedRevision !== undefined && this.state.revision !== expectedRevision) throw new Error("SKILL_LOCAL_CHANGED");
    const root = this.root(); if (!root) throw new Error("LIBRARY_NOT_CONFIGURED");
    const next = structuredClone(this.state), result = change(next);
    storeSchema.parse(next);
    const portable: Portable = portableSchema.parse({ version: 1, contentRevision: next.revision, entries: next.entries.map(({ provenance: _provenance, origin: _origin, notice: _notice, ...entry }) => entry) });
    const local = localSchema.parse({ version: 1, contentRevision: next.revision, contentHash: fingerprint(portable), projections: next.projections, entries: next.entries.map(entry => ({
      libraryId: entry.libraryId, provenance: entry.provenance, origin: entry.origin, notice: entry.notice,
      revisions: Object.fromEntries(entry.generations.map(generation => [generation.generationId, generation.sourceRevision])),
    })) });
    const path = join(await libraryDirectory(root, "skills"), "skills.json");
    for (const entry of portable.entries) {
      libraryObjectId(entry.libraryId);
      for (const generation of entry.generations) libraryObjectId(generation.generationId);
    }
    try {
      await durableReplaceFile(this.filePath + ".intent", JSON.stringify(local) + "\n");
      await durableReplaceFile(path, JSON.stringify(portable, null, 2) + "\n");
      await durableReplaceFile(this.filePath, JSON.stringify(local) + "\n");
      this.state = next;
      await rm(this.filePath + ".intent", { force: true });
    } catch (error) { this.pendingRecovery = true; throw error; }
    return structuredClone(result);
  }
  async closeAndFlush() {}
  private async readLocal(path: string) {
    const bytes = await readOptional(path); if (bytes === null) return null;
    try { return localSchema.parse(JSON.parse(bytes)); }
    catch {
      await rename(path, `${path}.quarantine-${Date.now()}`);
      const files = (await readdir(dirname(path))).filter(name => name.startsWith(path.slice(dirname(path).length + 1) + ".quarantine-")).sort().reverse();
      for (const file of files.slice(3)) await rm(join(dirname(path), file));
      return null;
    }
  }
}
async function readOptional(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024) throw new Error("SKILL_FOLDER_FILE_INVALID");
    return await readFile(path, "utf8");
  } catch (error) { if (isErrnoCode(error, "ENOENT")) return null; throw error; }
}
