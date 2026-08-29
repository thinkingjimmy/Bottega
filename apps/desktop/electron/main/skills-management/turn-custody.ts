/**
 * [INPUT]: Depends on frozen EffectiveSkillSnapshot identities, Library v3, Extension Registry strong refs, Node filesystem clone primitives, and skills-runtime failure envelopes
 * [OUTPUT]: Provides SkillsTurnCustodyStore with per-turn identity/ref/runtime-root ownership, exact Extension-holder queries, current-enabled double checks, COW materialization, bounded SKILL.md reads, and custody-aware GC probes
 * [POS]: Resource owner between snapshot composition and use_skill; builtin tool leases only reference a custody id and never own generation or filesystem resources
 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ProductFailureError,
  skillsRuntimeFailure,
} from "../../../shared/product-failure";
import type { ExtensionRegistryStore } from "../extensions/registry-store";
import type {
  EffectiveSkillEntry,
  EffectiveSkillSnapshot,
} from "./effective-snapshot";
import type { ManagedSkillsLibraryStore } from "./library-store";
import { digestSkillFolder } from "./package";

export const USE_SKILL_INLINE_BYTE_LIMIT = 32_768;

type Custody = {
  custodyId: string;
  requestId: string;
  conversationId: string;
  ownerId: string;
  runtimeRoot: string | null;
  accepting: boolean;
  activeCalls: number;
  drainWaiters: Array<() => void>;
  entries: ReadonlyMap<string, EffectiveSkillEntry>;
  extensionRefs: Array<Extract<EffectiveSkillEntry["generationRef"], { kind: "extension" }>>;
};

export class SkillsTurnCustodyStore {
  readonly root: string;
  private readonly custodies = new Map<string, Custody>();
  private readonly materializing = new Map<string, Promise<string>>();

  constructor(
    userData: string,
    private readonly library: ManagedSkillsLibraryStore,
    private readonly registry: ExtensionRegistryStore
  ) {
    this.root = join(userData, "skills-runtime");
  }

  async initialize() {
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async reserveRuntimeRoot(requestId: string) {
    const root = join(this.root, requestKey(requestId));
    await mkdir(root, { recursive: false, mode: 0o700 });
    return root;
  }

  async begin(input: Readonly<{
    requestId: string;
    conversationId: string;
    ownerId?: string;
    snapshot: EffectiveSkillSnapshot;
    runtimeRoot: string | null;
  }>) {
    const expectedOwnerId = skillsTurnOwnerId(input.requestId);
    if (input.ownerId && input.ownerId !== expectedOwnerId) {
      throw new Error("Prepared Skills ref owner 与 request identity 不一致");
    }
    const custodyId = expectedOwnerId;
    if (this.custodies.has(custodyId)) return custodyId;
    const ownerId = custodyId;
    const extensionRefs = input.snapshot.entries
      .filter((entry) => entry.available && entry.generationRef.kind === "extension")
      .map((entry) => entry.generationRef as Extract<EffectiveSkillEntry["generationRef"], { kind: "extension" }>);
    let created: typeof extensionRefs = [];
    try {
      const acquired = await this.registry.acquireGenerationRefs(
        extensionRefs.map((generation) => generation.package),
        ownerId
      );
      const createdKeys = new Set(
        acquired.created.map(
          (ref) => `${ref.packageGenerationId}\0${ref.recordDigest}`
        )
      );
      created = extensionRefs.filter((generation) =>
        createdKeys.has(
          `${generation.package.packageGenerationId}\0${generation.package.recordDigest}`
        )
      );
      this.custodies.set(custodyId, {
        custodyId,
        requestId: input.requestId,
        conversationId: input.conversationId,
        ownerId,
        runtimeRoot: input.runtimeRoot,
        accepting: true,
        activeCalls: 0,
        drainWaiters: [],
        entries: new Map(
          input.snapshot.entries
            .filter((entry) => entry.available)
            .map((entry) => [entry.slug, entry])
        ),
        extensionRefs,
      });
      return custodyId;
    } catch (cause) {
      await this.registry.releaseGenerationRefs(
        created.map((generation) => generation.package),
        ownerId
      ).catch(() => undefined);
      if (input.runtimeRoot) {
        await rm(input.runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
      }
      throw cause;
    }
  }

  async use(custodyId: string | undefined, name: string) {
    const custody = custodyId ? this.custodies.get(custodyId) : undefined;
    const entry = custody?.entries.get(name);
    if (!custody || !custody.accepting || !entry || !entry.channels.includes("use-skill")) {
      throw runtimeFailure("ref-invalid");
    }
    if (!this.currentlyEnabled(entry)) throw runtimeFailure("ref-invalid");
    if (!custody.runtimeRoot) throw runtimeFailure("unavailable");
    custody.activeCalls += 1;
    try {
      const path = await this.materialize(custody, entry);
      if (!this.currentlyEnabled(entry)) throw runtimeFailure("ref-invalid");
      const content = await readFile(join(path, "SKILL.md"));
      const text = content.toString("utf8");
      return content.byteLength <= USE_SKILL_INLINE_BYTE_LIMIT
        ? { name: entry.slug, path, content: text }
        : {
            name: entry.slug,
            path,
            preview: content.subarray(0, USE_SKILL_INLINE_BYTE_LIMIT).toString("utf8"),
          };
    } finally {
      custody.activeCalls -= 1;
      if (custody.activeCalls === 0) {
        for (const resolve of custody.drainWaiters.splice(0)) resolve();
      }
    }
  }

  referencesPackageDirectory(packageDirectory: string) {
    for (const custody of this.custodies.values()) {
      for (const entry of custody.entries.values()) {
        if (entry.generationRef.kind !== "library") continue;
        const generationRef = entry.generationRef;
        const stored = this.library.entryIncludingTombstone(
          generationRef.libraryId
        );
        const generation = stored?.generations.find(
          (item) => item.generationId === generationRef.generationId
        );
        if (generation?.packageDirectory === packageDirectory) return true;
      }
    }
    return false;
  }

  /**
   * Manual snapshots never create ambient projection bindings. Their strong
   * Registry refs are the authoritative evidence that a prepared/live turn
   * still holds an exact Extension generation.
   */
  holdersOfInstall(installIdentity: string) {
    const holders: Array<{ requestId: string; conversationId: string }> = [];
    for (const custody of this.custodies.values()) {
      const holds = custody.extensionRefs.some((entry) =>
        this.registry.generationProjection(entry.package)?.installIdentity ===
        installIdentity
      );
      if (holds) {
        holders.push({
          requestId: custody.requestId,
          conversationId: custody.conversationId,
        });
      }
    }
    return holders;
  }

  async release(custodyId: string | undefined) {
    const custody = custodyId ? this.custodies.get(custodyId) : undefined;
    if (!custody) return;
    custody.accepting = false;
    if (custody.activeCalls > 0) {
      await new Promise<void>((resolve) => custody.drainWaiters.push(resolve));
    }
    if (custody.runtimeRoot) {
      await rm(custody.runtimeRoot, { recursive: true, force: true });
    }
    for (const generation of [...custody.extensionRefs].reverse()) {
      await this.registry.releaseGenerationRef(generation.package, custody.ownerId);
    }
    this.custodies.delete(custody.custodyId);
    await this.library.resumeDeletions((directory) =>
      this.referencesPackageDirectory(directory)
    );
  }

  async shutdown() {
    for (const custodyId of [...this.custodies.keys()]) {
      await this.release(custodyId);
    }
    await rm(this.root, { recursive: true, force: true });
  }

  private currentlyEnabled(entry: EffectiveSkillEntry) {
    if (entry.generationRef.kind === "library") {
      const stored = this.library.entry(entry.generationRef.libraryId);
      return Boolean(
        stored?.enabled
      );
    }
    if (entry.generationRef.kind === "extension") {
      return this.registry.isComponentEnabled(
        entry.generationRef.componentInstanceIdentity
      );
    }
    return entry.enabled;
  }

  private materialize(custody: Custody, entry: EffectiveSkillEntry) {
    const key = `${custody.custodyId}\0${entry.slug}`;
    const running = this.materializing.get(key);
    if (running) return running;
    const task = this.materializeOnce(custody, entry).finally(() => {
      if (this.materializing.get(key) === task) this.materializing.delete(key);
    });
    this.materializing.set(key, task);
    return task;
  }

  private async materializeOnce(custody: Custody, entry: EffectiveSkillEntry) {
    const root = custody.runtimeRoot!;
    const target = join(root, entry.slug);
    if (await exists(target)) {
      if ((await observedDigest(entry, target)) !== entry.digest) {
        throw runtimeFailure("changed-during-read");
      }
      return target;
    }
    const source = dirname(entry.path);
    if ((await observedDigest(entry, source)) !== entry.digest) {
      throw runtimeFailure("changed-during-read");
    }
    const staging = join(root, `.staging-${entry.slug}-${randomUUID()}`);
    try {
      await cloneDirectory(source, staging);
      if ((await observedDigest(entry, staging)) !== entry.digest) {
        throw runtimeFailure("changed-during-read");
      }
      await rename(staging, target);
      return target;
    } catch (cause) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (await exists(target)) return target;
      if (cause instanceof ProductFailureError) throw cause;
      throw runtimeFailure("unavailable");
    }
  }
}

async function cloneDirectory(source: string, target: string) {
  await mkdir(target, { recursive: false, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    const stat = await lstat(from);
    if (stat.isSymbolicLink()) throw runtimeFailure("changed-during-read");
    if (stat.isDirectory()) {
      await cloneDirectory(from, to);
      continue;
    }
    if (!stat.isFile()) throw runtimeFailure("unavailable");
    await copyFile(from, to, constants.COPYFILE_FICLONE);
    await chmod(to, 0o400);
  }
}

async function exists(path: string) {
  return lstat(path).then(() => true, () => false);
}

function requestKey(requestId: string) {
  return createHash("sha256").update(requestId).digest("hex").slice(0, 32);
}

export function skillsTurnOwnerId(requestId: string) {
  return `skills-turn:${requestKey(requestId)}`;
}

async function observedDigest(entry: EffectiveSkillEntry, directory: string) {
  if (entry.generationRef.kind !== "filesystem") {
    return digestSkillFolder(directory);
  }
  const content = await readFile(join(directory, "SKILL.md"));
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function runtimeFailure(code: Parameters<typeof skillsRuntimeFailure>[0]) {
  return new ProductFailureError(skillsRuntimeFailure(code));
}
