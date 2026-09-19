/**
 * [INPUT]: Depends on the folder Skill file, SerialQueue, package copy/verify helpers, Node fs/path/crypto, and shared agent/import-outcome types, and statusError from main/errors
 * [OUTPUT]: Provides serialized Skill imports, immutable generations, tombstones, enablement, bounded generation quarantines, active-plus-two generation retention and revision-checked downlink projection receipts.
 * [POS]: Sole durable authority for adopted/local Skill bytes and user enablement; content lives in the user's folder and Agent home directories never receive library writes
 */

import { recoverOrDefer, recoveryBlocked } from "../persistence/recovery-policy";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ManagedSkillAgent,
  ManagedSkillImportOutcome,
} from "../../../shared/unified-skills-ipc";
import { statusError } from "../errors";
import { ensureDurableDirectory, syncDirectory } from "../persistence/durable-json";
import { SerialQueue } from "../persistence/serial-queue";
import {
  copySkillDirectory,
  digestSkillFolder,
  type InspectedSkillFolder,
  verifyInspectedSkill,
} from "./package";

import { type Store, type ManagedSkillsLibraryEntry } from "./folder/model";
import { SkillsFolderFile } from "./folder/file";
import type { SkillFacts } from "@ai-chat/cloud-protocol/skills/model";
import { libraryObjectId } from "../library/paths";
export type { ManagedSkillsLibraryEntry } from "./folder/model";

export type ImportLibraryCandidate = Readonly<{
  skill: InspectedSkillFolder;
  source:
    | Readonly<{ kind: "local-folder"; sourcePath: string }>
    | Readonly<{ kind: "adopted"; agent: ManagedSkillAgent; sourcePath: string }>;
}>;

export type ManagedSkillsLibraryFaults = Readonly<{
  afterCandidateCopied?: (sourcePath: string, stagedSkillPath: string) => void | Promise<void>;
  afterTombstone?: (libraryId: string) => void | Promise<void>;
  afterGc?: (libraryId: string) => void | Promise<void>;
}>;

export type LibraryCustodyProbe = (
  packageDirectory: string
) => boolean | Promise<boolean>;

/* Generation directories are immutable and hash-named, so a quarantined one is
   forensic evidence, not state anyone reads. Three is enough to explain what
   happened without turning the user's folder into a landfill. */
const MAX_GENERATION_QUARANTINES = 3;

/* Every content change keeps a full copy of the Skill in the user's folder. Two
   superseded generations are enough to undo a bad edit, and the account keeps the
   same number, so a generation collected here is one the cloud is retiring too. */
export const RETAINED_SUPERSEDED_GENERATIONS = 2;

export class ManagedSkillsLibraryStore {
  readonly root: string;
  get packagesRoot() { return join(this.requireRoot(), "skills"); }
  private readonly stagingRoot: string;
  private readonly file: SkillsFolderFile;
  private readonly queue = new SerialQueue();
  /* Generations this device collected while the account still lists them. The
     synchronization pass reads it so retention is not undone by the next downlink. */
  private readonly retired = new Map<string, Set<string>>();

  constructor(
    userData: string,
    private readonly faults: ManagedSkillsLibraryFaults,
    /* Production always has a folder; the getter returns null only while the
       library is not yet mounted, and every write refuses until it is. */
    private readonly libraryRoot: () => string | null
  ) {
    this.root = join(userData, "unified-skills");
    this.stagingRoot = join(this.root, "staging");
    this.file = new SkillsFolderFile(userData, libraryRoot);
  }

  async initialize(custody: LibraryCustodyProbe = () => false) {
    await this.queue.enqueue(async () => {
      const root = this.libraryRoot();
      if (root) await mkdir(join(root, "skills"), { recursive: true, mode: 0o700 });
      await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
      /* A stale-generation or corrupted ledger is treated as absent (a pre-release
         breaking-change call). Content directories are addressed by
         libraryId/generationId; an orphan only costs disk bytes, and re-importing
         the same content verifies and reuses it in place, no need to sweep it
         alongside the ledger. */
      await this.file.initialize();
      if (recoveryBlocked()) await recoverOrDefer(() => this.resumeDeletions(custody));
      else await this.resumeDeletionsSerial(custody);
    });
  }

  private requireRoot() {
    const root = this.libraryRoot();
    if (!root) throw new Error("LIBRARY_NOT_CONFIGURED");
    return root;
  }

  snapshot() {
    return this.file.snapshot();
  }

  entry(libraryId: string) {
    return this.file.snapshot().entries.find((item) =>
      item.libraryId === libraryId && item.tombstoneAt === null
    ) ?? null;
  }

  entryIncludingTombstone(libraryId: string) {
    return this.file.snapshot().entries.find((item) => item.libraryId === libraryId) ?? null;
  }

  packagePath(entry: ManagedSkillsLibraryEntry) {
    const generation = entry.generations.find((item) => item.generationId === entry.activeGenerationId);
    if (!generation) throw new Error("Skill active generation 不存在");
    return this.contentPath(entry.libraryId, generation.generationId);
  }

  /** Generations local retention removed; empty for a Skill this process never collected. */
  retiredGenerations(libraryId: string): readonly string[] {
    return [...(this.retired.get(libraryId) ?? [])];
  }

  generationPath(libraryId: string, digest: string) {
    const entry = this.entry(libraryId);
    const generation = entry?.generations.find((item) => item.digest === digest);
    if (!entry || !generation) return null;
    return this.contentPath(entry.libraryId, generation.generationId);
  }

  /** Publish only after all immutable directories verify; a concurrent local edit retries from its new facts. */
  applySynchronized(input: { libraryId: string; facts: SkillFacts; replaceId?: string; expectedRevision: number; metadataOnly?: boolean; projectionId?: string;
    generations: { generationId: string; digest: string; importedAt: number; sourcePath: string }[] }) {
    return this.queue.enqueue(async () => {
      this.requireRoot();
      const current = this.file.snapshot();
      if (current.revision !== input.expectedRevision) throw new Error("SKILL_LOCAL_CHANGED");
      libraryObjectId(input.libraryId);
      const previous = current.entries.find(entry => entry.libraryId === input.libraryId),
        source = current.entries.find(entry => entry.libraryId === (input.replaceId ?? input.libraryId));
      if (input.metadataOnly && (previous || source || input.generations.length !== 1 || input.generations[0]?.generationId !== input.facts.activeGenerationId)) throw new Error("SKILL_METADATA_IDENTITY_CHANGED");
      const generations = [...(previous?.generations ?? [])];
      for (const generation of input.generations) {
        libraryObjectId(generation.generationId);
        const existing = generations.find(item => item.generationId === generation.generationId);
        if (existing && existing.digest !== generation.digest) throw new Error("SKILL_GENERATION_CHANGED");
        const record = { generationId: generation.generationId, digest: generation.digest, importedAt: generation.importedAt,
          packageDirectory: generation.digest.slice(7), sourceRevision: `synced:${generation.digest}` };
        const destination = this.contentPath(input.libraryId, record.generationId);
        if (!input.metadataOnly && await digestSkillFolder(destination).catch(() => null) !== record.digest) {
          const temporary = join(this.stagingRoot, randomUUID());
          try {
            if (!/^sha256:[a-f0-9]{64}$/.test(record.digest)) throw new Error("SKILL_GENERATION_CHANGED");
            await copySkillDirectory(generation.sourcePath, temporary, record.digest as `sha256:${string}`);
            await ensureDurableDirectory(dirname(destination));
            if (await exists(destination)) {
              await rename(destination, destination + `.quarantine-${Date.now()}-${randomUUID()}`);
              await capQuarantines(dirname(destination), `${record.generationId}.quarantine-`);
            }
            await rename(temporary, destination); await syncDirectory(dirname(destination));
          } finally { await rm(temporary, { recursive: true, force: true }); }
        }
        if (!existing) generations.push(record);
        else if (existing.importedAt === 0) existing.importedAt = generation.importedAt;
      }
      const activeGenerationId = input.facts.activeGenerationId ?? source?.activeGenerationId;
      if (!activeGenerationId || !generations.some(item => item.generationId === activeGenerationId)) throw new Error("SKILL_GENERATION_UNAVAILABLE");
      /* A conversion is the one cross-device event that rewrites an identity the
         user can see. It is recorded locally so the row can say so; it never
         reaches the portable file, because it is this device's news. */
      const converted = Boolean(input.replaceId && input.replaceId !== input.libraryId);
      const next: ManagedSkillsLibraryEntry = { libraryId: input.libraryId, name: input.facts.slug, displayName: input.facts.displayName,
        description: input.facts.description, ...(input.facts.requires ? { requires: input.facts.requires } : {}),
        enabled: input.facts.enabled, tombstoneAt: input.facts.tombstoneAt, activeGenerationId, generations,
        notice: converted ? "slug-conflict" : previous?.notice ?? null,
        provenance: source?.provenance ?? { kind: "local-folder", sourcePath: this.contentPath(input.libraryId, activeGenerationId),
          sourceIdentity: `synced:${input.libraryId}`, importedAt: generations[0]!.importedAt }, origin: source?.origin ?? null };
      const changed = JSON.stringify(previous) !== JSON.stringify(next) || Boolean(input.replaceId);
      if (!changed && !input.projectionId) return false;
      /* The revision was checked against the snapshot this projection was computed
         from; mutate re-checks it because a deferred recovery reload between the
         two would otherwise commit generations derived from facts that are gone. */
      await this.file.mutate(state => {
        const occupied = state.entries.find(entry => entry.tombstoneAt === null && entry.name === next.name && entry.libraryId !== next.libraryId && entry.libraryId !== input.replaceId);
        if (occupied && next.tombstoneAt === null) throw new Error("SKILL_LOCAL_CHANGED");
        if (input.replaceId && input.replaceId !== next.libraryId) {
          const retired = state.entries.find(entry => entry.libraryId === input.replaceId);
          if (retired) { retired.tombstoneAt = Date.now(); retired.enabled = false; }
        }
        if (changed) { state.entries = state.entries.filter(entry => entry.libraryId !== next.libraryId); state.entries.push(next); state.revision++; }
        if (input.projectionId) (state.projections ??= {})[input.libraryId] = input.projectionId;
      }, input.expectedRevision);
      return changed;
    });
  }

  private contentPath(libraryId: string, generationId: string) {
    return join(this.packagesRoot, libraryId, generationId);
  }

  private objectPath(libraryId: string) {
    return join(this.packagesRoot, libraryId);
  }

  importCandidates(candidates: readonly ImportLibraryCandidate[], now = Date.now()) {
    return this.queue.enqueue(() => this.importCandidatesSerial(candidates, now));
  }

  private async importCandidatesSerial(
    candidates: readonly ImportLibraryCandidate[],
    now: number
  ) {
    if (!candidates.length) throw new Error("至少选择一个可导入的 Skill");
    const verified = await Promise.all(candidates.map(async (candidate) => ({
      ...candidate,
      skill: await verifyInspectedSkill(candidate.skill),
    })));
    this.requireRoot();
    const current = this.file.snapshot();
    assertNamesDoNotConflict(current.entries, verified);
    const prepared = verified.map(candidate => {
      const existing = current.entries.find(entry => entry.tombstoneAt === null && entry.name === candidate.skill.name);
      return { ...candidate, libraryId: existing?.libraryId ?? randomUUID(),
        generation: existing?.generations.find(generation => generation.digest === candidate.skill.digest)
          ?? generationOf(candidate.skill.digest, now, candidate.skill.revision) };
    });
    const staged: string[] = [];
    try {
      for (const candidate of prepared) {
        const destination = this.contentPath(candidate.libraryId, candidate.generation.generationId);
        if (await exists(destination)) {
          if (await digestSkillFolder(destination) !== candidate.skill.digest) throw changedDuringImport();
          continue;
        }
        const temporary = join(this.stagingRoot, randomUUID()); staged.push(temporary);
        await copySkillDirectory(candidate.skill.canonicalPath, temporary, candidate.skill.digest);
        await this.faults.afterCandidateCopied?.(candidate.skill.canonicalPath, temporary);
        if (await digestSkillFolder(temporary) !== candidate.skill.digest) throw changedDuringImport();
        await ensureDurableDirectory(dirname(destination));
        await rename(temporary, destination); await syncDirectory(dirname(destination));
      }
      /* 结局在事实发生的这一行分类：建条目 / 追一代 / 什么也没做。
         renderer 的结果条只做把这份清单数一数的算术。 */
      return await this.file.mutate((state) => {
        const outcomes: Array<{ libraryId: string; name: string; outcome: ManagedSkillImportOutcome }> = [];
        for (const candidate of prepared) {
          const sourceIdentity = privateSourceIdentity(candidate.source.sourcePath);
          /* name 是 Skill 身份的一部分：来源改名产生新条目，旧 binding 仍由旧条目管理。 */
          const existing = state.entries.find((item) =>
            item.tombstoneAt === null && item.name === candidate.skill.name
          );
          if (existing) {
            const active = existing.generations.find((item) => item.generationId === existing.activeGenerationId)!;
            if (active.digest === candidate.skill.digest) {
              active.sourceRevision = candidate.skill.revision;
              /* tombstone 是删除进度，不是内容身份。同内容重导必须先复活
                 条目，再让延迟 GC 看见 tombstone 已撤销。 */
              if (existing.tombstoneAt !== null) {
                refreshImportedFacts(
                  existing,
                  candidate,
                  candidate.skill.digest,
                  sourceIdentity,
                  now
                );
                outcomes.push({ libraryId: existing.libraryId, name: existing.name, outcome: "updated" });
              } else {
                outcomes.push({ libraryId: existing.libraryId, name: existing.name, outcome: "unchanged" });
              }
              continue;
            }
            const generation = candidate.generation;
            if (!existing.generations.some(item => item.generationId === generation.generationId)) existing.generations.push(generation);
            existing.activeGenerationId = generation.generationId;
            refreshImportedFacts(
              existing,
              candidate,
              candidate.skill.digest,
              sourceIdentity,
              now
            );
            outcomes.push({ libraryId: existing.libraryId, name: existing.name, outcome: "updated" });
            continue;
          }
          const generation = candidate.generation;
          const entry: ManagedSkillsLibraryEntry = {
            libraryId: candidate.libraryId,
            name: candidate.skill.name,
            displayName: candidate.skill.displayName,
            description: candidate.skill.description,
            ...(candidate.skill.requires ? { requires: candidate.skill.requires } : {}),
            enabled: true,
            tombstoneAt: null,
            provenance: provenanceOf(candidate.source, sourceIdentity, now),
            generations: [generation],
            activeGenerationId: generation.generationId,
            notice: null,
            origin: candidate.source.kind === "adopted"
              ? originOf(candidate.source, sourceIdentity, candidate.skill.digest)
              : null,
          };
          state.entries.push(entry);
          outcomes.push({ libraryId: entry.libraryId, name: entry.name, outcome: "created" });
        }
        state.revision += 1;
        return outcomes;
      });
    } finally {
      await Promise.all(staged.map((item) => rm(item, { recursive: true, force: true })));
    }
  }

  setEnabled(libraryId: string, enabled: boolean) {
    return this.queue.enqueue(() => this.file.mutate((state) => {
      const entry = requireLiveEntry(state, libraryId);
      entry.enabled = enabled;
      /* Acting on the row is the acknowledgement; the conversion notice has
         done its job and must not outlive it. */
      entry.notice = null;
      state.revision += 1;
      return entry;
    }));
  }

  async delete(
    libraryId: string,
    custodyReferenced: LibraryCustodyProbe = () => false,
    now = Date.now()
  ) {
    return this.queue.enqueue(() =>
      this.deleteSerial(libraryId, custodyReferenced, now)
    );
  }

  private async deleteSerial(
    libraryId: string,
    custodyReferenced: LibraryCustodyProbe,
    now: number
  ) {
    const tombstone = await this.file.mutate((state) => {
      const entry = requireLiveEntry(state, libraryId);
      entry.enabled = false;
      entry.tombstoneAt = now;
      state.revision += 1;
      return entry;
    });
    await this.faults.afterTombstone?.(libraryId);
    await this.collectTombstone(tombstone.libraryId, custodyReferenced);
  }

  resumeDeletions(
    custodyReferenced: LibraryCustodyProbe = () => false
  ) {
    return this.queue.enqueue(() => this.resumeDeletionsSerial(custodyReferenced));
  }

  private async resumeDeletionsSerial(
    custodyReferenced: LibraryCustodyProbe
  ) {
    if (!this.libraryRoot()) return;
    for (const entry of this.file.snapshot().entries) {
      if (entry.tombstoneAt === null) {
        await this.collectSuperseded(entry, custodyReferenced);
        continue;
      }
      /* A tombstone whose object directory is already gone has nothing left to
         collect: re-walking every past deletion at every launch was pure cost. */
      if (!(await exists(this.objectPath(entry.libraryId)))) continue;
      await this.collectTombstone(entry.libraryId, custodyReferenced);
    }
  }

  /**
   * Keeps the active generation plus the {@link RETAINED_SUPERSEDED_GENERATIONS}
   * most recently imported others. Bytes go before the manifest does: a crash in
   * between leaves the manifest over-promising for one launch and the next pass
   * picks the same generations and finishes the job, whereas the reverse order
   * would leak directories nothing ever looks at again.
   */
  private async collectSuperseded(
    entry: ManagedSkillsLibraryEntry,
    custodyReferenced: LibraryCustodyProbe
  ) {
    const libraryId = entry.libraryId;
    const superseded = entry.generations
      .filter((item) => item.generationId !== entry.activeGenerationId)
      .sort((left, right) =>
        right.importedAt - left.importedAt ||
        (left.generationId < right.generationId ? 1 : -1))
      .slice(RETAINED_SUPERSEDED_GENERATIONS);
    const collected: string[] = [];
    for (const generation of superseded) {
      /* A turn holding this generation keeps reading it until it releases; the
         next pass, which the release itself triggers, collects it then. */
      if (await custodyReferenced(generation.packageDirectory)) continue;
      await rm(this.contentPath(libraryId, generation.generationId), { recursive: true, force: true });
      collected.push(generation.generationId);
    }
    if (!collected.length) return;
    await this.file.mutate((state) => {
      const live = state.entries.find(
        (item) => item.libraryId === libraryId && item.tombstoneAt === null
      );
      if (!live) return;
      const remaining = live.generations.filter((item) => !collected.includes(item.generationId));
      if (remaining.length === live.generations.length) return;
      live.generations = remaining;
      state.revision += 1;
    });
    const retired = this.retired.get(libraryId) ?? new Set<string>();
    for (const generationId of collected) retired.add(generationId);
    this.retired.set(libraryId, retired);
  }

  /**
   * Drops a collected tombstone from the folder manifest. Only the synchronization
   * pass may call this, and only once the cloud head carries the same tombstone —
   * a locally forgotten deletion would be resurrected by the next downlink.
   */
  forgetCollectedTombstone(libraryId: string) {
    return this.queue.enqueue(async () => {
      const entry = this.file.snapshot().entries.find((item) => item.libraryId === libraryId);
      if (!entry || entry.tombstoneAt === null) return false;
      if (await exists(this.objectPath(libraryId))) return false;
      await this.file.mutate((state) => {
        const tombstone = state.entries.find((item) => item.libraryId === libraryId);
        if (!tombstone || tombstone.tombstoneAt === null) return;
        state.entries = state.entries.filter((item) => item.libraryId !== libraryId);
        delete state.projections?.[libraryId];
        state.revision += 1;
      });
      return true;
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
    await this.file.closeAndFlush();
  }

  private async collectTombstone(
    libraryId: string,
    custodyReferenced: LibraryCustodyProbe
  ) {
    const entry = this.file.snapshot().entries.find((item) => item.libraryId === libraryId);
    if (!entry || entry.tombstoneAt === null) return;
    let custodyBlocked = false;
    for (const generation of entry.generations) {
      if (await custodyReferenced(generation.packageDirectory)) { custodyBlocked = true; continue; }
      await rm(this.contentPath(libraryId, generation.generationId), { recursive: true, force: true });
    }
    if (custodyBlocked) return;
    /* The object directory outlives its generations by exactly one step: quarantined
       copies and the directory itself are the last residue of a deleted Skill, and
       the user's folder should show no trace of it once the bytes are gone. */
    await rm(this.objectPath(libraryId), { recursive: true, force: true });
    this.retired.delete(libraryId);
    await this.faults.afterGc?.(libraryId);
  }
}

function requireLiveEntry(state: Store, libraryId: string) {
  const entry = state.entries.find(
    (item) => item.libraryId === libraryId && item.tombstoneAt === null
  );
  if (!entry) {
    throw statusError(409, "Skill library entry 不存在");
  }
  return entry;
}

function generationOf(digest: string, importedAt: number, sourceRevision: string) {
  return {
    generationId: randomUUID(),
    digest,
    packageDirectory: digest.slice("sha256:".length),
    importedAt,
    sourceRevision,
  };
}

function provenanceOf(source: ImportLibraryCandidate["source"], sourceIdentity: string, importedAt: number) {
  return source.kind === "adopted"
    ? { kind: "adopted" as const, agent: source.agent, sourcePath: source.sourcePath, sourceIdentity, importedAt }
    : { kind: "local-folder" as const, sourcePath: source.sourcePath, sourceIdentity, importedAt };
}

function refreshImportedFacts(
  entry: ManagedSkillsLibraryEntry,
  candidate: ImportLibraryCandidate,
  digest: `sha256:${string}`,
  sourceIdentity: string,
  importedAt: number
) {
  entry.displayName = candidate.skill.displayName;
  entry.description = candidate.skill.description;
  entry.requires = candidate.skill.requires;
  entry.enabled = true;
  entry.tombstoneAt = null;
  entry.notice = null;
  entry.provenance = provenanceOf(candidate.source, sourceIdentity, importedAt);
  /* Origin records acquisition identity only. Projection custody was retired
     and must never leak back into a restored Library entry. */
  entry.origin = candidate.source.kind === "adopted"
    ? originOf(candidate.source, sourceIdentity, digest)
    : null;
}

function originOf(
  source: Extract<ImportLibraryCandidate["source"], { kind: "adopted" }>,
  sourceIdentity: string,
  digest: string
) {
  return {
    agent: source.agent,
    sourcePath: source.sourcePath,
    sourceIdentity,
    digest,
  };
}

function assertNamesDoNotConflict(_entries: readonly ManagedSkillsLibraryEntry[], candidates: readonly ImportLibraryCandidate[]) {
  const seen = new Map<string, string | null>();
  for (const candidate of candidates) {
    if (seen.has(candidate.skill.name) && seen.get(candidate.skill.name) !== candidate.skill.digest) {
      throw statusError(409, `Conflicting Skill generations selected: ${candidate.skill.name}`);
    }
    seen.set(candidate.skill.name, candidate.skill.digest);
  }
}

function privateSourceIdentity(path: string) {
  return createHash("sha256").update(path).digest("hex");
}

async function exists(path: string) {
  return access(path).then(() => true, () => false);
}

async function capQuarantines(directory: string, prefix: string) {
  const names = await readdir(directory).catch(() => [] as string[]);
  const stale = names
    .filter((name) => name.startsWith(prefix))
    .sort()
    .slice(0, -MAX_GENERATION_QUARANTINES);
  for (const name of stale) await rm(join(directory, name), { recursive: true, force: true });
}

function changedDuringImport() {
  return statusError(409, "Skill 来源或暂存字节在导入期间发生变化，请重新预览");
}
