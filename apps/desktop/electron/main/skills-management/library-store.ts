/**
 * [INPUT]: Depends on DurableJson, copy/limited copy of the package, Node fs/path/crypto and shared digest/agent type
 * [OUTPUT]: Provides ManagedSkillsLibraryStore: name cannot be changed|Adopted provenance, revised content address generations, indefinite binding, authentication and onboarding
 * [POS]: The author of the book, "Skilled Management" and "Durable Single Writer"The name change creates new entries, source paths and copy failures are left only in the main
 */

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ManagedSkillAgent } from "../../../shared/unified-skills-ipc";
import { DurableJson } from "../persistence/durable-json";
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
}).strict();
const originSchema = z.object({
  agent: z.enum(["codex", "claude", "kimi", "opencode"]),
  sourcePath: z.string().min(1),
  sourceIdentity: z.string().min(1),
  digest: digestSchema,
  state: z.enum(["imported-source", "managed-projection"]),
  bindingId: z.string().min(1).nullable(),
}).strict();
const entrySchema = z.object({
  libraryId: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  provenance: provenanceSchema,
  generations: z.array(generationSchema).min(1),
  activeGenerationId: z.string().min(1),
  origin: originSchema.nullable(),
}).strict();
const storeSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  onboardingDismissed: z.boolean(),
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
}>;

export class ManagedSkillsLibraryStore {
  readonly root: string;
  readonly packagesRoot: string;
  private readonly stagingRoot: string;
  private readonly file: DurableJson<Store>;

  constructor(
    userData: string,
    private readonly faults: ManagedSkillsLibraryFaults = {}
  ) {
    this.root = join(userData, "unified-skills");
    this.packagesRoot = join(this.root, "packages");
    this.stagingRoot = join(this.root, "staging");
    this.file = new DurableJson(join(this.root, "library.json"), storeSchema, () => ({
      schemaVersion: 1,
      revision: 0,
      onboardingDismissed: false,
      entries: [],
    }));
  }

  async initialize() {
    await mkdir(this.packagesRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
    await this.file.initialize();
  }

  snapshot() {
    return this.file.snapshot();
  }

  entry(libraryId: string) {
    return this.file.snapshot().entries.find((item) => item.libraryId === libraryId) ?? null;
  }

  packagePath(entry: ManagedSkillsLibraryEntry) {
    const generation = entry.generations.find((item) => item.generationId === entry.activeGenerationId);
    if (!generation) throw new Error("Skill active generation 不存在");
    return join(this.packagesRoot, generation.packageDirectory, "skills", entry.name);
  }

  async importCandidates(candidates: readonly ImportLibraryCandidate[], now = Date.now()) {
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
      return await this.file.mutate((state) => {
        const changed: ManagedSkillsLibraryEntry[] = [];
        for (const candidate of verified) {
          const sourceIdentity = privateSourceIdentity(candidate.source.sourcePath);
          /* name 是 Skill 身份的一部分：来源改名产生新条目，旧 binding 仍由旧条目管理。 */
          const existing = state.entries.find((item) =>
            item.provenance.sourceIdentity === sourceIdentity && item.name === candidate.skill.name
          );
          if (existing) {
            const active = existing.generations.find((item) => item.generationId === existing.activeGenerationId)!;
            if (active.digest === candidate.skill.digest) {
              changed.push(existing);
              continue;
            }
            const generation = generationOf(candidate.skill.digest, now);
            existing.generations.push(generation);
            existing.activeGenerationId = generation.generationId;
            existing.displayName = candidate.skill.displayName;
            existing.description = candidate.skill.description;
            existing.provenance = provenanceOf(candidate.source, sourceIdentity, now);
            /* 未撤销 binding 的 origin 是恢复入口，重新导入只能增加 generation，不能换掉它。 */
            if (candidate.source.kind === "adopted" && !existing.origin?.bindingId) {
              existing.origin = originOf(candidate.source, sourceIdentity, candidate.skill.digest);
            }
            changed.push(existing);
            continue;
          }
          const generation = generationOf(candidate.skill.digest, now);
          const entry: ManagedSkillsLibraryEntry = {
            libraryId: randomUUID(),
            name: candidate.skill.name,
            displayName: candidate.skill.displayName,
            description: candidate.skill.description,
            provenance: provenanceOf(candidate.source, sourceIdentity, now),
            generations: [generation],
            activeGenerationId: generation.generationId,
            origin: candidate.source.kind === "adopted"
              ? originOf(candidate.source, sourceIdentity, candidate.skill.digest)
              : null,
          };
          state.entries.push(entry);
          changed.push(entry);
        }
        state.revision += 1;
        return changed;
      });
    } finally {
      await Promise.all(staged.map((item) => rm(item.temporary, { recursive: true, force: true })));
    }
  }

  markOriginManaged(libraryId: string, bindingId: string) {
    return this.file.mutate((state) => {
      const entry = requireEntry(state, libraryId);
      if (!entry.origin) throw new Error("只有收编来源可以接管原路径");
      entry.origin.state = "managed-projection";
      entry.origin.bindingId = bindingId;
      state.revision += 1;
    });
  }

  markOriginRestored(libraryId: string) {
    return this.file.mutate((state) => {
      const entry = requireEntry(state, libraryId);
      if (!entry.origin) return;
      entry.origin.state = "imported-source";
      entry.origin.bindingId = null;
      state.revision += 1;
    });
  }

  dismissOnboarding() {
    return this.file.mutate((state) => {
      state.onboardingDismissed = true;
      state.revision += 1;
    });
  }

  closeAndFlush() {
    return this.file.closeAndFlush();
  }
}

function generationOf(digest: string, importedAt: number) {
  return {
    generationId: randomUUID(),
    digest,
    packageDirectory: digest.slice("sha256:".length),
    importedAt,
  };
}

function provenanceOf(source: ImportLibraryCandidate["source"], sourceIdentity: string, importedAt: number) {
  return source.kind === "adopted"
    ? { kind: "adopted" as const, agent: source.agent, sourcePath: source.sourcePath, sourceIdentity, importedAt }
    : { kind: "local-folder" as const, sourcePath: source.sourcePath, sourceIdentity, importedAt };
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
    state: "imported-source" as const,
    bindingId: null,
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

function requireEntry(state: Store, libraryId: string) {
  const entry = state.entries.find((item) => item.libraryId === libraryId);
  if (!entry) throw new Error("Skill 库条目不存在");
  return entry;
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
