/**
 * [INPUT]: Depends on DurableJson upgrade hooks, SerialQueue, package copy/verify helpers, Node fs/path/crypto, and shared agent/import-outcome types
 * [OUTPUT]: Provides one serialized schema-v3 ManagedSkillsLibraryStore boundary for import/delete/GC filesystem effects, enabled/requires facts, immutable content generations, tombstone recovery, and idempotent imports
 * [POS]: Sole durable authority for adopted/local Skill bytes and user enablement; Agent home directories never receive library writes
 */

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  ManagedSkillAgent,
  ManagedSkillImportOutcome,
} from "../../../shared/unified-skills-ipc";
import { DurableJson, initializeDurableJsonOrQuarantine } from "../persistence/durable-json";
import { SerialQueue } from "../persistence/serial-queue";
import {
  copySkillDirectory,
  digestSkillFolder,
  type InspectedSkillFolder,
  verifyInspectedSkill,
} from "./package";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const provenanceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local-folder"), sourcePath: z.string().min(1), sourceIdentity: z.string().min(1), importedAt: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("adopted"), agent: z.enum(["codex", "claude", "kimi", "opencode"]), sourcePath: z.string().min(1), sourceIdentity: z.string().min(1), importedAt: z.number().int().nonnegative() }).strict(),
]);
const generationSchema = z.object({
  generationId: z.string().min(1),
  digest: digestSchema,
  packageDirectory: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.number().int().nonnegative(),
  /* 导入复核那一刻的来源 revision：候选超预算未哈希（digest=null）时，
     「已是最新还是有更新」只能靠它比。可选是为了旧库文件——缺席条目在
     一次同内容 no-op 导入时回填愈合，不必升 schemaVersion。 */
  sourceRevision: z.string().min(1).optional(),
}).strict();
const originSchema = z.object({
  agent: z.enum(["codex", "claude", "kimi", "opencode"]),
  sourcePath: z.string().min(1),
  sourceIdentity: z.string().min(1),
  digest: digestSchema,
}).strict();
const entrySchema = z.object({
  libraryId: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  requires: z.string().min(1).optional(),
  enabled: z.boolean(),
  tombstoneAt: z.number().int().nonnegative().nullable(),
  provenance: provenanceSchema,
  generations: z.array(generationSchema).min(1),
  activeGenerationId: z.string().min(1),
  origin: originSchema.nullable(),
}).strict();
const storeSchema = z.object({
  schemaVersion: z.literal(3),
  revision: z.number().int().nonnegative(),
  /* 已废除的引导标记：旧档可能还带着，容忍读入、永不再写。 */
  onboardingDismissed: z.boolean().optional(),
  entries: z.array(entrySchema),
}).strict();

type Store = z.infer<typeof storeSchema>;
export type ManagedSkillsLibraryEntry = z.infer<typeof entrySchema>;

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

export class ManagedSkillsLibraryStore {
  readonly root: string;
  readonly packagesRoot: string;
  private readonly stagingRoot: string;
  private readonly file: DurableJson<Store>;
  private readonly queue = new SerialQueue();

  constructor(
    userData: string,
    private readonly faults: ManagedSkillsLibraryFaults = {}
  ) {
    this.root = join(userData, "unified-skills");
    this.packagesRoot = join(this.root, "packages");
    this.stagingRoot = join(this.root, "staging");
    this.file = new DurableJson(join(this.root, "library.json"), storeSchema, () => ({
      schemaVersion: 3,
      revision: 0,
      entries: [],
    }));
  }

  async initialize(custody: LibraryCustodyProbe = () => false) {
    await this.queue.enqueue(async () => {
      await mkdir(this.packagesRoot, { recursive: true, mode: 0o700 });
      await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
      /* 旧代/损坏账本按不存在处理（预发布断代裁决）。packages/ 是内容寻址目录，
         孤儿代价只是磁盘字节；重导入同内容会校验后原地复用，不必随账本清扫。 */
      await initializeDurableJsonOrQuarantine(this.file, upgradeLibraryStore);
      await this.resumeDeletionsSerial(custody);
    });
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
    return join(this.packagesRoot, generation.packageDirectory, "skills", entry.name);
  }

  generationPath(libraryId: string, digest: string) {
    const entry = this.entry(libraryId);
    const generation = entry?.generations.find((item) => item.digest === digest);
    if (!entry || !generation) return null;
    return join(this.packagesRoot, generation.packageDirectory, "skills", entry.name);
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
    const current = this.file.snapshot();
    assertNamesDoNotConflict(current.entries, verified);

    const staged: Array<{
      temporary: string;
      destination: string;
      name: string;
      digest: `sha256:${string}`;
    }> = [];
    try {
      for (const candidate of verified) {
        const directory = candidate.skill.digest.slice("sha256:".length);
        const destination = join(this.packagesRoot, directory);
        if (await exists(destination)) {
          await assertStoredDigest(destination, candidate.skill.name, candidate.skill.digest);
          continue;
        }
        const temporary = join(this.stagingRoot, randomUUID());
        await mkdir(join(temporary, "skills"), { recursive: true, mode: 0o700 });
        const stagedSkillPath = join(temporary, "skills", candidate.skill.name);
        staged.push({
          temporary,
          destination,
          name: candidate.skill.name,
          digest: candidate.skill.digest,
        });
        await copySkillDirectory(
          candidate.skill.canonicalPath,
          stagedSkillPath,
          candidate.skill.digest
        );
        await this.faults.afterCandidateCopied?.(candidate.skill.canonicalPath, stagedSkillPath);
        if (await digestSkillFolder(stagedSkillPath) !== candidate.skill.digest) {
          throw changedDuringImport();
        }
      }
      for (const item of staged) {
        if (await exists(item.destination)) {
          await assertStoredDigest(item.destination, item.name, item.digest);
          await rm(item.temporary, { recursive: true, force: true });
          continue;
        }
        await rename(item.temporary, item.destination);
        await assertStoredDigest(item.destination, item.name, item.digest);
      }
      /* 结局在事实发生的这一行分类：建条目 / 追一代 / 什么也没做。
         renderer 的结果条只做把这份清单数一数的算术。 */
      return await this.file.mutate((state) => {
        const outcomes: Array<{ libraryId: string; name: string; outcome: ManagedSkillImportOutcome }> = [];
        for (const candidate of verified) {
          const sourceIdentity = privateSourceIdentity(candidate.source.sourcePath);
          /* name 是 Skill 身份的一部分：来源改名产生新条目，旧 binding 仍由旧条目管理。 */
          const existing = state.entries.find((item) =>
            item.provenance.sourceIdentity === sourceIdentity && item.name === candidate.skill.name
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
            const generation = generationOf(candidate.skill.digest, now, candidate.skill.revision);
            existing.generations.push(generation);
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
          const generation = generationOf(candidate.skill.digest, now, candidate.skill.revision);
          const entry: ManagedSkillsLibraryEntry = {
            libraryId: randomUUID(),
            name: candidate.skill.name,
            displayName: candidate.skill.displayName,
            description: candidate.skill.description,
            ...(candidate.skill.requires ? { requires: candidate.skill.requires } : {}),
            enabled: true,
            tombstoneAt: null,
            provenance: provenanceOf(candidate.source, sourceIdentity, now),
            generations: [generation],
            activeGenerationId: generation.generationId,
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
      await Promise.all(staged.map((item) => rm(item.temporary, { recursive: true, force: true })));
    }
  }

  setEnabled(libraryId: string, enabled: boolean) {
    return this.queue.enqueue(() => this.file.mutate((state) => {
      const entry = requireLiveEntry(state, libraryId);
      entry.enabled = enabled;
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
    for (const entry of this.file.snapshot().entries) {
      if (entry.tombstoneAt !== null) {
        await this.collectTombstone(entry.libraryId, custodyReferenced);
      }
    }
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
    const state = this.file.snapshot();
    const entry = state.entries.find((item) => item.libraryId === libraryId);
    if (!entry || entry.tombstoneAt === null) return;
    const directories = new Set(
      entry.generations.map((generation) => generation.packageDirectory)
    );
    let custodyBlocked = false;
    for (const directory of directories) {
      const shared = state.entries.some((candidate) =>
        candidate.libraryId !== libraryId &&
        candidate.generations.some(
          (generation) => generation.packageDirectory === directory
        )
      );
      const heldByCustody = !shared && (await custodyReferenced(directory));
      if (heldByCustody) {
        custodyBlocked = true;
        continue;
      }
      if (!shared) {
        await rm(join(this.packagesRoot, directory), {
          recursive: true,
          force: true,
        });
      }
    }
    if (custodyBlocked) return;
    await this.faults.afterGc?.(libraryId);
    await this.file.mutate((current) => {
      const tombstone = current.entries.find(
        (item) => item.libraryId === libraryId
      );
      if (!tombstone || tombstone.tombstoneAt === null) return;
      current.entries = current.entries.filter(
        (item) => item.libraryId !== libraryId
      );
      current.revision += 1;
    });
  }
}

function upgradeLibraryStore(raw: unknown): Store | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as { schemaVersion?: unknown; revision?: unknown; entries?: unknown };
  if (value.schemaVersion !== 2 || !Array.isArray(value.entries)) return undefined;
  return {
    schemaVersion: 3,
    revision: typeof value.revision === "number" ? value.revision : 0,
    entries: value.entries.map((candidate) => {
      if (!candidate || typeof candidate !== "object") return candidate;
      const entry = candidate as Record<string, unknown>;
      const { onboardingDismissed: _retired, ...rest } = entry;
      return {
        ...rest,
        enabled: true,
        tombstoneAt: null,
      };
    }) as Store["entries"],
  };
}

function requireLiveEntry(state: Store, libraryId: string) {
  const entry = state.entries.find(
    (item) => item.libraryId === libraryId && item.tombstoneAt === null
  );
  if (!entry) {
    throw Object.assign(new Error("Skill library entry 不存在"), {
      status: 409,
    });
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

function assertNamesDoNotConflict(
  entries: readonly ManagedSkillsLibraryEntry[],
  candidates: readonly ImportLibraryCandidate[]
) {
  const seen = new Map(entries.map((entry) => [entry.name, entry.provenance.sourceIdentity]));
  for (const candidate of candidates) {
    const identity = privateSourceIdentity(candidate.source.sourcePath);
    const owner = seen.get(candidate.skill.name);
    if (owner && owner !== identity) {
      throw Object.assign(new Error(`Skill 同名冲突：${candidate.skill.name}`), { status: 409 });
    }
    seen.set(candidate.skill.name, identity);
  }
}

function privateSourceIdentity(path: string) {
  return createHash("sha256").update(path).digest("hex");
}

async function exists(path: string) {
  return access(path).then(() => true, () => false);
}

async function assertStoredDigest(
  packageRoot: string,
  name: string,
  digest: `sha256:${string}`
) {
  if (await digestSkillFolder(join(packageRoot, "skills", name)) !== digest) {
    throw changedDuringImport();
  }
}

function changedDuringImport() {
  return Object.assign(new Error("Skill 来源或暂存字节在导入期间发生变化，请重新预览"), { status: 409 });
}
