/**
 * [INPUT]: Immutable local Skills, admitted file crypto, original file journal and private transfer ports.
 * [OUTPUT]: Verified encrypted generation publication that reuses the inspection's per-file hashes, and atomic private download staging that is discarded once published.
 * [POS]: Skills content adapter; the Library store alone publishes downloaded directories to the content folder.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashBlobSource, hashBytes, canonicalJson } from "@ai-chat/cloud-protocol";
import { prepareEncryptedFile } from "@ai-chat/cloud-protocol/blobs/encrypted/client";
import { ciphertextFileDescriptor, type EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { EncryptedBusinessHeader } from "@ai-chat/cloud-protocol/spaces";
import { readSkillManifest } from "@ai-chat/cloud-protocol/skills/encrypted";
import { skillManifestSchema, SKILL_LIMITS, type RemoteSkillGeneration, type SkillManifest } from "@ai-chat/cloud-protocol/skills/model";
import { inspectSkillFolder, digestSkillFolder } from "../../../skills-management/package";
import type { ManagedSkillsLibraryEntry, ManagedSkillsLibraryStore } from "../../../skills-management/library-store";
import { ensureDurableDirectory, syncDirectory } from "../../../persistence/durable-json";
import { localBlobSource } from "../../files/store";
import type { AccountTransport } from "../../runtime/transport";
import { SkillSyncState, skillHash } from "./state";
type Ports = { store: ManagedSkillsLibraryStore; state: SkillSyncState; files: EncryptedBlobTransfer; crypto(): FileCipherPort;
  header(): EncryptedBusinessHeader; transport: Pick<AccountTransport, "query" | "mutate">; current(): void };
export class SkillContentSync {
  constructor(private readonly input: Ports) {}
  async publish(entry: ManagedSkillsLibraryEntry, generation: ManagedSkillsLibraryEntry["generations"][number], signal: AbortSignal) {
    const { store, state, files, transport } = this.input, crypto = this.input.crypto(), header = this.input.header();
    const root = store.generationPath(entry.libraryId, generation.digest);
    if (!root) throw new Error("SKILL_GENERATION_UNAVAILABLE");
    const inspected = await inspectSkillFolder(root, { hashAll: true });
    if (!inspected.importable || inspected.skill.digest !== generation.digest || inspected.skill.name !== entry.name) throw new Error("SKILL_GENERATION_CHANGED");
    if (inspected.skill.files.length > SKILL_LIMITS.files || inspected.skill.bytes > SKILL_LIMITS.bytes) throw new Error("SKILL_SYNC_SIZE_LIMIT");
    const journal = state.journal([entry.libraryId, generation.generationId]), prepared: SkillManifest["files"] = [];
    for (const file of inspected.skill.files) {
      this.input.current(); signal.throwIfAborted();
      const path = join(root, file.path), source = await localBlobSource(path, "application/octet-stream");
      try {
        /* The inspection above already streamed every byte through a per-file sha256;
           reading the same file a second time only to hash it again doubled publish I/O. */
        const sha256 = file.sha256 ?? (await hashBlobSource(source.source, signal)).sha256;
        const key = skillHash(["skill-file", entry.libraryId, generation.generationId, file.path]);
        const descriptor = await prepareEncryptedFile({ key, operationId: key, owner: { kind: "skill", id: entry.libraryId }, ownerGeneration: generation.generationId,
          source: { sha256, bytes: source.source.bytes, mime: source.source.mime }, priority: "background" }, source.source, crypto, journal, signal);
        prepared.push({ path: file.path, file: descriptor, executable: Boolean((await lstat(path)).mode & 0o111) });
      } finally { await source.close(); }
    }
    const manifest = skillManifestSchema.parse({ version: 1, libraryId: entry.libraryId, generationId: generation.generationId,
      digest: generation.digest.slice(7), importedAt: generation.importedAt, files: prepared });
    const bytes = new TextEncoder().encode(canonicalJson(manifest)), key = skillHash(["skill-manifest", entry.libraryId, generation.generationId]);
    if (bytes.byteLength > SKILL_LIMITS.manifestBytes) throw new Error("SKILL_SYNC_SIZE_LIMIT");
    const descriptor = await prepareEncryptedFile({ key, operationId: key, owner: { kind: "skill", id: entry.libraryId }, ownerGeneration: generation.generationId,
      domain: "skill-generation", source: { sha256: hashBytes(bytes), bytes: bytes.length, mime: "application/json" }, priority: "background" },
    { bytes: bytes.length, mime: "application/json", read: async (offset, length) => bytes.slice(offset, offset + length) }, crypto, journal, signal);
    this.input.current();
    await transport.mutate("skills/generations:prepare", { ...header, generation: { libraryId: entry.libraryId, generationId: generation.generationId,
      manifestBlobId: descriptor.blobId, fileCount: prepared.length, byteSize: inspected.skill.bytes } });
    for (const [ordinal, file] of [...prepared.map(item => item.file), descriptor].entries()) {
      this.input.current();
      const manifest = ordinal === prepared.length, fileKey = manifest ? key : skillHash(["skill-file", entry.libraryId, generation.generationId, prepared[ordinal]!.path]);
      for (let attempt = 0;; attempt++) {
        const uploadId = skillHash([crypto.session.sessionId, file.blobId, state.uploadAttempt(file.blobId)]);
        try { await files.uploadFile(header, uploadId, manifest ? "skill-generation" : "skill-file", file, journal, fileKey, undefined, signal); break; }
        catch (error) {
          this.input.current(); signal.throwIfAborted();
          const status = await transport.query("blobs/api:status", { ...header, uploadId }).catch(() => null);
          if (!status || !["expired", "failed", "cancelled"].includes(status.state)) throw error;
          await state.renewUpload(file.blobId); if (attempt >= 1) throw error;
        }
      }
      this.input.current(); await transport.mutate("skills/generations:attach", { ...header, libraryId: entry.libraryId,
        generationId: generation.generationId, ordinal, file: ciphertextFileDescriptor(file) });
    }
    this.input.current(); await transport.mutate("skills/generations:commit", { ...header, libraryId: entry.libraryId, generationId: generation.generationId });
    await state.releaseFiles([entry.libraryId, generation.generationId], [...prepared.map(item => item.file.blobId), descriptor.blobId]);
    return manifest;
  }
  inspect(generation: RemoteSkillGeneration, signal: AbortSignal) {
    return readSkillManifest(generation, this.input.files, this.input.crypto(), signal);
  }
  async download(generation: RemoteSkillGeneration, signal: AbortSignal, verified?: SkillManifest) {
    const { state, files } = this.input, crypto = this.input.crypto();
    const manifest = verified ?? await readSkillManifest(generation, files, crypto, signal), digest = `sha256:${manifest.digest}`;
    const root = join(state.root, "downloads", skillHash([generation.libraryId, generation.generationId]));
    if (await digestSkillFolder(root).catch(() => null) === digest) return { manifest, root };
    const temporary = root + "." + randomUUID(); await ensureDurableDirectory(temporary);
    try {
      for (const entry of manifest.files) {
        this.input.current(); signal.throwIfAborted();
        const path = join(temporary, entry.path); await ensureDurableDirectory(dirname(path));
        const file = await open(path, "wx", entry.executable ? 0o700 : 0o600); let closed = false;
        const close = async () => { if (!closed) { closed = true; await file.close(); } };
        try {
          await files.readFile(entry.file, crypto, { write: async bytes => { await file.writeFile(bytes); },
            commit: async () => { await file.sync(); await close(); await syncDirectory(dirname(path)); return path; },
            abort: close }, undefined, signal, "background");
        } finally { await close(); }
      }
      if (await digestSkillFolder(temporary) !== digest) throw new Error("SKILL_GENERATION_CHANGED");
      const inspected = await inspectSkillFolder(temporary, { hashAll: true });
      if (!inspected.importable || inspected.skill.digest !== digest) throw new Error("SKILL_GENERATION_CHANGED");
      /* The previous staging copy is a byte-identical rehearsal of a generation the
         Store either already owns or is about to; keeping it doubled every Skill on
         disk forever. */
      await rm(root, { recursive: true, force: true });
      await mkdir(dirname(root), { recursive: true }); await rename(temporary, root); await syncDirectory(dirname(root));
      return { manifest, root };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  /** Staging exists only until the Store copies it into the user's folder. */
  discard(root: string) {
    return rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
