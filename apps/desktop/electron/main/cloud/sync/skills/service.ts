/**
 * [INPUT]: Admitted sync lifecycle, catalog subscriptions, revision-bound Skill snapshots, projection receipts and original intents.
 * [OUTPUT]: Change-driven catalog reads, integrity-checked generation reuse, slug convergence, tombstone and interrupted publication recovery.
 * [POS]: Skills participant in the existing desktop sync pass; owns no independent timer or consent.
 */
import { join } from "node:path";
import { digestSkillFolder } from "../../../skills-management/package";
import { SkillDigestCacheStore } from "../../../skills-management/orchestration/digest-cache";
import { normalizeSkillSlug } from "@ai-chat/cloud-protocol/skills/identity";
import { randomUUID } from "node:crypto";
import { canonicalJson, protocolHeader, type CloudBuildConfig, type CloudFunctionResult } from "@ai-chat/cloud-protocol";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { openSkillHead, sealSkillHead } from "@ai-chat/cloud-protocol/skills/encrypted";
import type { EncryptedSkillHead, SkillFacts, RemoteSkillGeneration } from "@ai-chat/cloud-protocol/skills/model";
import type { ManagedSkillsLibraryEntry, ManagedSkillsLibraryStore } from "../../../skills-management/library-store";
import type { AccountTransport } from "../../runtime/transport";
import { SkillContentSync } from "./content";
import { SkillSyncState, skillHash } from "./state";
export const localSkillFacts = (entry: ManagedSkillsLibraryEntry): SkillFacts => ({ version: 1, slug: entry.name,
  displayName: entry.displayName, description: entry.description, ...(entry.requires ? { requires: entry.requires } : {}),
  enabled: entry.enabled, activeGenerationId: entry.activeGenerationId, tombstoneAt: entry.tombstoneAt });
const equal = (a: SkillFacts | null, b: SkillFacts | null) => {
  const content = (value: SkillFacts | null) => value ? (({ sourceDeviceId: _source, ...facts }) => facts)(value) : null;
  return canonicalJson(content(a)) === canonicalJson(content(b));
};
/* The wire admits `.` and `:` in an id; a folder object name does not
   (library/paths.ts). A head minted by a client with a laxer alphabet must be
   skipped, not allowed to abort every later Skill in the same pass. */
const folderSafeId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
class UnusableSkillIdentity extends Error {
  constructor(readonly libraryId: string) { super("SKILL_IDENTITY_UNUSABLE"); }
}
const localHash = (entry: ManagedSkillsLibraryEntry) => skillHash([localSkillFacts(entry), entry.generations.map(g => [g.generationId, g.digest])]);
function changes(before: SkillFacts, after: SkillFacts, onto: SkillFacts): SkillFacts {
  const result = { ...onto };
  for (const key of ["displayName", "description", "requires", "enabled", "activeGenerationId", "tombstoneAt"] as const) {
    if (before[key] === after[key]) continue;
    if (key === "requires" && after[key] === undefined) delete result.requires;
    else Object.assign(result, { [key]: after[key] });
  }
  return result;
}
type Ports = { userData: string; config: CloudBuildConfig; store: ManagedSkillsLibraryStore; files: EncryptedBlobTransfer;
  crypto(): FileCipherPort; transport: Pick<AccountTransport, "query" | "mutate" | "watchSkillsCatalog">; current(): void; changed(): Promise<void>; wake?(): void };
export class DesktopSkillsSync {
  readonly state: SkillSyncState;
  /* One unnameable identity would otherwise re-log on every 30-60s pass forever; only a change in the skipped set is news. */
  private reportedUnusable = "";
  private readonly content: SkillContentSync;
  private catalogRevision: number | null = null;
  private catalog: { revision: number; heads: Map<string, EncryptedSkillHead> } | null = null;
  private detachCatalog: (() => void) | null = null;
  private closed = false;
  /* Answers "is this generation still the bytes we published" from the directory
     listing; a full SHA-256 of every known generation on every pass was the
     single most expensive thing this participant did. */
  private readonly digests: SkillDigestCacheStore;
  constructor(private readonly input: Ports) {
    const crypto = input.crypto(); this.state = new SkillSyncState(input.userData, [crypto.scope, crypto.session.userId]);
    this.content = new SkillContentSync({ ...input, state: this.state, header: () => this.header() });
    this.digests = new SkillDigestCacheStore(join(this.state.root, "generation-digests.json"));
  }
  private header() {
    const crypto = this.input.crypto(); this.input.current();
    return { ...protocolHeader(this.input.config), expectedUserId: crypto.session.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  }
  private async generations(libraryId: string) {
    const values: RemoteSkillGeneration[] = []; let afterId: string | null = null;
    do {
      this.input.current(); const page: CloudFunctionResult<"skills/generations:page"> = await this.input.transport.query("skills/generations:page", { ...this.header(), libraryId, afterId });
      values.push(...page.items); afterId = page.cursor;
      if (values.length > 10_000) throw new Error("SKILL_GENERATION_LIMIT");
    } while (afterId !== null);
    return values;
  }
  private async heads() {
    if (!this.detachCatalog && this.input.transport.watchSkillsCatalog) {
      this.detachCatalog = this.input.transport.watchSkillsCatalog(this.header(), value => {
        if (this.closed) return;
        if (this.catalogRevision !== value.revision) {
          this.catalogRevision = value.revision; this.input.wake?.();
        }
      }, () => { this.catalogRevision = null; this.catalog = null; this.input.wake?.(); });
    }
    if (this.catalogRevision === null || !this.detachCatalog) {
      this.catalogRevision = (await this.input.transport.query("skills/sync:catalog", this.header())).revision;
      this.input.current();
    }
    const revision = this.catalogRevision;
    if (this.catalog?.revision === revision) return new Map(this.catalog.heads);
    const heads = new Map<string, EncryptedSkillHead>(); let afterId: string | null = null;
    do {
      const page: CloudFunctionResult<"skills/sync:page"> = await this.input.transport.query("skills/sync:page", { ...this.header(), afterId });
      this.input.current();
      for (const head of page.items) heads.set(head.libraryId, head);
      afterId = page.cursor; if (heads.size > 10_000) throw new Error("SKILL_CATALOG_LIMIT");
    } while (afterId !== null);
    const current = await this.input.transport.query("skills/sync:catalog", this.header());
    this.input.current();
    if (current.revision !== revision) { this.catalogRevision = current.revision; throw new Error("SKILL_CATALOG_CHANGED"); }
    this.catalog = { revision, heads };
    return new Map(heads);
  }
  async flush(signal: AbortSignal) {
    await this.state.initialize(); await this.digests.ready(); this.input.current();
    // Settle local publication before comparing any local facts with a newer cloud head.
    const applied = this.input.store.snapshot().projections ?? {};
    for (const [id, { projection }] of this.state.projections()) {
      await this.state.save(id, entry => {
        if (projection && applied[id] === projection.id) {
          entry.head = projection.head; entry.facts = projection.facts;
          entry.generations = projection.generations; entry.pending = null;
        }
        entry.projection = null;
      });
    }
    const heads = await this.heads();
    const before = this.input.store.snapshot().revision, failures: unknown[] = [], unusable: string[] = [];
    const attempt = async (id: string, head: EncryptedSkillHead | null) => {
      try { await this.reconcile(id, head, signal); }
      catch (error) {
        this.input.current();
        /* An identity this build cannot name as a folder object is one Skill's
           problem; letting it abort the pass would strand every other Skill. */
        if (error instanceof UnusableSkillIdentity) unusable.push(error.libraryId);
        else failures.push(error);
      }
    };
    for (const local of this.input.store.snapshot().entries) {
      this.input.current(); signal.throwIfAborted();
      const alias = this.state.alias(local.libraryId);
      if (alias && this.input.store.entryIncludingTombstone(alias)) { heads.delete(local.libraryId); continue; }
      await attempt(local.libraryId, heads.get(local.libraryId) ?? null);
      heads.delete(local.libraryId);
    }
    for (const head of heads.values()) {
      if (head.tombstone || head.activeGenerationDigest === null || this.input.store.entryIncludingTombstone(head.libraryId)) continue;
      this.input.current();
      await attempt(head.libraryId, head);
    }
    const skipped = canonicalJson([...unusable].sort());
    if (unusable.length && skipped !== this.reportedUnusable) {
      console.warn(`skills-sync: skipped ${unusable.length} Skills whose identity this build cannot store`, unusable);
    }
    this.reportedUnusable = skipped;
    await this.digests.flush();
    if (this.input.store.snapshot().revision !== before) await this.input.changed();
    if (failures.length) throw failures[0];
    return this.input.store.snapshot().entries.length;
  }
  private async freeze(local: ManagedSkillsLibraryEntry, head: EncryptedSkillHead | null, facts: SkillFacts, before: SkillFacts | null, signal: AbortSignal) {
    const crypto = this.input.crypto(), slugKey = head?.slugKey ?? await crypto.skillSlugKey!(normalizeSkillSlug(local.name), signal);
    const generation = local.generations.find(item => item.generationId === facts.activeGenerationId);
    const encrypted = await sealSkillHead({ libraryId: local.libraryId, operationId: randomUUID(), slugKey, revision: (head?.revision ?? 0) + 1,
      activeGenerationDigest: facts.activeGenerationId === null ? null : generation?.digest.slice(7) ?? head?.activeGenerationDigest ?? null,
      tombstone: facts.tombstoneAt !== null }, { ...facts, sourceDeviceId: before?.activeGenerationId === facts.activeGenerationId ? before.sourceDeviceId ?? crypto.session.deviceId : crypto.session.deviceId }, crypto, signal);
    await this.state.save(local.libraryId, entry => { entry.pending = { head: encrypted, facts, before, sourceFacts: localSkillFacts(local),
      generationId: facts.activeGenerationId, sourceHash: localHash(local), receipt: null }; });
  }
  private async receipt(id: string, signal: AbortSignal) {
    const pending = this.state.get(id).pending!;
    if (!pending.receipt) {
      const receipt = await this.input.transport.mutate("skills/sync:apply", { ...this.header(), head: pending.head, generationId: pending.generationId });
      this.input.current(); signal.throwIfAborted();
      if (receipt.operationId !== pending.head.operationId || receipt.ciphertextHash !== skillHash({ head: pending.head, generationId: pending.generationId })) throw new Error("SKILL_RECEIPT_CHANGED");
      await this.state.save(id, entry => { entry.pending!.receipt = receipt; });
    }
    return this.state.get(id).pending!;
  }
  private async reconcile(id: string, initial: EncryptedSkillHead | null, signal: AbortSignal) {
    let head = initial;
    for (let attempt = 0; attempt < 5; attempt++) {
      this.input.current(); signal.throwIfAborted();
      try {
        let snapshot = this.input.store.snapshot();
        let local = snapshot.entries.find(entry => entry.libraryId === id) ?? null, record = this.state.get(id);
        if (record.head && (!head || record.head.libraryId === head.libraryId && record.head.revision > head.revision)) head = record.head;
        let wanted: SkillFacts | null = null;
        if (record.pending) {
          const pending = await this.receipt(id, signal), receipt = pending.receipt!;
          head = head?.libraryId === receipt.head.libraryId && head.revision > receipt.head.revision ? head : receipt.head;
          const remote = await openSkillHead(head, this.input.crypto(), signal);
          // An applied operation is already included in the head history; replay only edits made after it was frozen.
          wanted = receipt.status === "applied" ? remote : pending.before ? changes(pending.before, pending.facts, remote) : remote;
          if (local) wanted = changes(pending.sourceFacts, localSkillFacts(local), wanted);
        }
        if (!head && local && local.tombstoneAt === null) {
          const slugKey = await this.input.crypto().skillSlugKey!(normalizeSkillSlug(local.name), signal);
          head = await this.input.transport.query("skills/sync:slug", { ...this.header(), slugKey });
          if (!head) { await this.freeze(local, null, { ...localSkillFacts(local), activeGenerationId: null }, null, signal); continue; }
        }
        if (!head) return;
        const remote = await openSkillHead(head, this.input.crypto(), signal);
        if (!folderSafeId(head.libraryId) || (remote.activeGenerationId !== null && !folderSafeId(remote.activeGenerationId))) {
          throw new UnusableSkillIdentity(head.libraryId);
        }
        if (head.tombstone) {
          if (!local || local.tombstoneAt !== null) {
            await this.state.save(id, value => { value.head = head; value.facts = remote; value.pending = null; value.projection = null; });
            /* The cloud now carries the same tombstone, so the local marker has
               nothing left to tell anyone: drop it rather than re-walk it forever. */
            if (local) await this.input.store.forgetCollectedTombstone(id);
            return;
          }
          if (!record.head || local.generations.some(generation => !record.generations.includes(generation.generationId) && !Object.values(record.digests).includes(generation.digest))) {
            const nextId = this.state.alias(id) ?? randomUUID(); await this.state.setAlias(id, nextId);
            const generations = this.localGenerations(local).map(generation => ({ ...generation,
              generationId: skillHash([nextId, generation.generationId]) }));
            const restoredFacts = { ...localSkillFacts(local), activeGenerationId: skillHash([nextId, local.activeGenerationId]) };
            await this.input.store.applySynchronized({ libraryId: nextId, replaceId: id, facts: restoredFacts, generations,
              expectedRevision: snapshot.revision });
            await this.reconcile(nextId, null, signal); return;
          }
          await this.project(local, snapshot.revision, head, remote, remote, [], signal); return;
        }
        if (local?.tombstoneAt !== null && local && record.head && !record.pending) {
          await this.freeze(local, head, localSkillFacts(local), record.facts, signal); continue;
        }
        const targetId = head.libraryId;
        if (local && local.name !== remote.slug) throw new Error("SKILL_SLUG_CHANGED");
        // Cloud-only discovery can meet a local offline import before that import reached the catalog pass.
        local ??= snapshot.entries.find(entry => entry.tombstoneAt === null && entry.name === remote.slug) ?? null;
        if (!wanted) wanted = record.facts && local ? changes(record.facts, localSkillFacts(local), remote) : remote;
        wanted = { ...wanted };
        if (!local && remote.activeGenerationId && head.activeGenerationDigest) {
          await this.input.store.applySynchronized({ libraryId: targetId, facts: remote, metadataOnly: true,
            expectedRevision: snapshot.revision, generations: [{ generationId: remote.activeGenerationId,
              digest: `sha256:${head.activeGenerationDigest}`, importedAt: 0, sourcePath: "" }] });
          snapshot = this.input.store.snapshot();
          local = snapshot.entries.find(entry => entry.libraryId === targetId) ?? null;
          await this.input.changed();
        }
        if (local && record.head?.libraryId === targetId && record.head.revision === head.revision &&
          !record.pending && !record.projection && local.libraryId === targetId && record.observedHash === localHash(local) &&
          equal(record.facts, remote) && equal(localSkillFacts(local), remote) && await this.intact(local)) {
          this.input.current(); signal.throwIfAborted();
          if (this.input.store.snapshot().revision !== snapshot.revision) throw new Error("SKILL_LOCAL_CHANGED");
          return;
        }
        const generations = (await this.generations(targetId)).filter(generation => folderSafeId(generation.generationId)), downloaded = [];
        const digests = { ...this.state.get(targetId).digests };
        const localById = new Map(local?.generations.map(generation => [generation.generationId, generation]) ?? []);
        const retired = await this.retired(targetId, generations, localById);
        for (const generation of generations) {
          /* Local retention already collected this one; the account keeps the same
             number and will stop listing it, and downloading it back in the meantime
             would only be undone by the next collection pass. */
          if (retired.has(generation.generationId) && generation.generationId !== remote.activeGenerationId) continue;
          const manifest = digests[generation.generationId] ? undefined : await this.content.inspect(generation, signal);
          if (manifest) digests[generation.generationId] = `sha256:${manifest.digest}`;
          const known = localById.get(generation.generationId);
          if (known && local) {
            const path = this.input.store.generationPath(local.libraryId, known.digest);
            if (path && known.digest === digests[generation.generationId] && await digestSkillFolder(path, this.digests).catch(() => null) === known.digest) continue;
          }
          const content = await this.content.download(generation, signal, manifest);
          downloaded.push({ generationId: generation.generationId, digest: `sha256:${content.manifest.digest}`,
            importedAt: content.manifest.importedAt, sourcePath: content.root });
        }
        const byDigest = new Map(Object.entries(digests).map(([generationId, digest]) => [digest, generationId]));
        const downloadedIds = new Set(downloaded.map(generation => generation.generationId));
        const available = [...(local && local.tombstoneAt === null ? this.localGenerations(local).filter(generation => !downloadedIds.has(generation.generationId) &&
          (!byDigest.has(generation.digest) || byDigest.get(generation.digest) === generation.generationId)) : []), ...downloaded];
        const active = available.find(generation => generation.generationId === remote.activeGenerationId);
        if (remote.activeGenerationId !== null && (!active || active.digest.slice(7) !== head.activeGenerationDigest)) throw new Error("SKILL_ACTIVE_GENERATION_CHANGED");
        const remoteIds = new Set(generations.map(generation => generation.generationId));
        // A restored old generation is already in the remote union. Only a previously unpublished generation can become a new local intent.
        if (local && !remoteIds.has(local.activeGenerationId) && (!record.facts || remote.activeGenerationId === null)) wanted.activeGenerationId = local.activeGenerationId;
        if (wanted.activeGenerationId === null && local) wanted.activeGenerationId = local.activeGenerationId;
        const desired = local?.generations.find(generation => generation.generationId === wanted!.activeGenerationId);
        if (desired && byDigest.has(desired.digest)) wanted.activeGenerationId = byDigest.get(desired.digest)!;
        if (wanted.activeGenerationId === null) return;
        if (local && local.libraryId !== targetId) await this.state.setAlias(local.libraryId, targetId);
        await this.project(local, snapshot.revision, head, remote, wanted, available, signal, [...remoteIds]);
        /* Staging has served its only purpose: the Store owns these bytes now. */
        for (const generation of downloaded) await this.content.discard(generation.sourcePath);
        if (local && local.libraryId !== targetId) {
          await this.state.setAlias(local.libraryId, targetId);
          await this.state.save(local.libraryId, value => { value.pending = null; value.projection = null; });
        }
        await this.state.save(targetId, value => { value.digests = digests; });
        id = targetId; local = this.input.store.entryIncludingTombstone(id)!; record = this.state.get(id);
        if (local.tombstoneAt === null) for (const generation of local.generations) if (!remoteIds.has(generation.generationId) && !byDigest.has(generation.digest)) {
          await this.content.publish(local, generation, signal); remoteIds.add(generation.generationId); byDigest.set(generation.digest, generation.generationId);
          await this.state.save(id, value => { value.generations = [...remoteIds]; value.digests[generation.generationId] = generation.digest; });
        }
        if (equal(localSkillFacts(local), remote)) return;
        await this.freeze(local, head, localSkillFacts(local), remote, signal);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "SKILL_LOCAL_CHANGED") throw error;
      }
    }
    throw new Error("SKILL_HEAD_CHANGED");
  }
  private async intact(local: ManagedSkillsLibraryEntry) {
    const record = this.state.get(local.libraryId);
    for (const generation of local.generations) {
      if (!record.generations.includes(generation.generationId) || record.digests[generation.generationId] !== generation.digest) return false;
      const path = this.input.store.generationPath(local.libraryId, generation.digest);
      if (!path || await digestSkillFolder(path, this.digests).catch(() => null) !== generation.digest) return false;
    }
    return true;
  }
  /**
   * The generations local retention (skills-management/library-store.ts) collected
   * and the account still lists, persisted per Skill so the decision survives a
   * restart. Anything the account has swept, or that came back locally, leaves the
   * set: it is a skip list for this catalog page, never a tombstone.
   */
  private async retired(libraryId: string, listed: readonly RemoteSkillGeneration[], local: ReadonlyMap<string, unknown>) {
    const remote = new Set(listed.map(generation => generation.generationId));
    const known = this.state.get(libraryId).retired;
    const retired = new Set([...known, ...this.input.store.retiredGenerations(libraryId)]
      .filter(generationId => remote.has(generationId) && !local.has(generationId)));
    if (retired.size !== known.length || known.some(generationId => !retired.has(generationId))) {
      await this.state.save(libraryId, entry => { entry.retired = [...retired]; });
    }
    return retired;
  }
  private localGenerations(entry: ManagedSkillsLibraryEntry) {
    return entry.generations.map(generation => {
      const sourcePath = this.input.store.generationPath(entry.libraryId, generation.digest);
      if (!sourcePath) throw new Error("SKILL_GENERATION_UNAVAILABLE");
      return { generationId: generation.generationId, digest: generation.digest, importedAt: generation.importedAt, sourcePath };
    });
  }
  private async project(local: ManagedSkillsLibraryEntry | null, revision: number, head: EncryptedSkillHead, facts: SkillFacts, wanted: SkillFacts,
    generations: Parameters<ManagedSkillsLibraryStore["applySynchronized"]>[0]["generations"], signal: AbortSignal, remoteIds: string[] = []) {
    const projectionId = randomUUID();
    await this.state.save(head.libraryId, entry => { entry.projection = { id: projectionId, head, facts, generations: remoteIds }; });
    this.input.current(); signal.throwIfAborted();
    await this.input.store.applySynchronized({ libraryId: head.libraryId, facts: wanted, generations, expectedRevision: revision, projectionId,
      ...(local && local.libraryId !== head.libraryId ? { replaceId: local.libraryId } : {}) });
    this.input.current();
    await this.state.save(head.libraryId, entry => { entry.head = head; entry.facts = facts; entry.pending = null; entry.projection = null;
      entry.generations = remoteIds; entry.observedHash = localHash(this.input.store.entryIncludingTombstone(head.libraryId)!); });
  }
  close() { this.closed = true; this.detachCatalog?.(); this.detachCatalog = null; this.catalog = null; return this.state.close(); }
}
