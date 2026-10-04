/**
 * [INPUT]: Surface intents, owner-only retained receipts, verified encrypted transfer, crypto and ciphertext custody.
 * [OUTPUT]: DesktopSurfacePublisher.publish(appId) and publishSubject(plugin): publish owner-bound compiled GUI generations (seal, upload, prepare, attach, commit; each frozen blob's upload attempt is persisted, so a terminal upload id is never sent again, review 0929-full F05), marks a static
 *           GUI unsupported, retires a removed GUI, and does nothing when the remote head already names the same thing.
 * Upload identities bind retained ciphertext to its authenticated session and device, including reauthentication.
 * [POS]: Shared App/plugin producer. Rollback verifies a retained plaintext manifest and CAS-activates its original ciphertext; no long-lived local ciphertext cache.
 */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, hashBytes, hashCanonical, type FileProgress } from "@ai-chat/cloud-protocol";
import { prepareEncryptedFile } from "@ai-chat/cloud-protocol/blobs/encrypted/client";
import { ciphertextFileDescriptor, type EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { EncryptedFileDescriptor, FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { FrozenFileJournal } from "@ai-chat/cloud-protocol/blobs/encrypted/journal";
import type { EncryptedBusinessHeader } from "@ai-chat/cloud-protocol/spaces";
import { surfaceFunctions } from "@ai-chat/cloud-protocol/surfaces/functions";
import { APP_SURFACE_FILE_MIME, APP_SURFACE_LIMITS, encodeAppSurfaceManifest, type AppSurfaceHead, type AppSurfaceManifest } from "@ai-chat/cloud-protocol/surfaces/manifest";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../../runtime/transport/transport";
import { appCiphertextDirectory, appCiphertextJournal } from "../../../apps/share/package/custody/ciphertext";
import { durableReplaceFile } from "../../../persistence/durable-json";
import { pluginSurfaceFunctions } from "@ai-chat/cloud-protocol/surfaces/plugin/functions";
import { pluginSurfaceOwnerId, encodePluginSurfaceManifest, type PluginSurfaceSubject, type PluginSurfaceHead } from "@ai-chat/cloud-protocol/surfaces/plugin/model";
import type { SurfaceIntent, SurfaceSource } from "./source";
import { surfacePublicationIdentity, verifyRetainedSurface, verifySurfaceIntentFiles, type PublishedSurface } from "./retained";

export type SurfacePublication = "current" | "published" | "marked" | "pending" | "too-large";
type UploadAttempts = { current(blobId: string): Promise<number>; renew(blobId: string): Promise<void> };
type Input = { source: SurfaceSource; userData: string; scope: SyncScope; transport: Pick<AccountTransport, "query" | "mutate">;
  files: Pick<EncryptedBlobTransfer, "uploadFile"|"readFile">; crypto(): FileCipherPort; header(): EncryptedBusinessHeader; progress?(): (value: FileProgress) => void };

export class DesktopSurfacePublisher {
  // Journal writes for one generation are serialized; the custody journal requires a single writer.
  private chain: Promise<unknown> = Promise.resolve();
  private verified = new Map<string,string>();
  constructor(private readonly input: Input) {}

  async publishSubject(subject: PluginSurfaceSubject, signal: AbortSignal) {
    if (subject.ownerDeviceId !== this.input.crypto().session.deviceId) throw new Error("owner-required");
    return this.publish(subject.id, signal, subject);
  }
  async publish(appId: string, signal: AbortSignal, subject?: PluginSurfaceSubject): Promise<SurfacePublication> {
    const intent = await this.input.source.intent(appId); signal.throwIfAborted();
    if (intent.kind === "pending") return "pending";
    const head = await this.head(appId, subject); signal.throwIfAborted();
    const revision = head?.revision ?? 0;
    if (intent.kind === "none") {
      if (!head || head.state === "retired") return "current";
      await this.mark(appId, revision, "retired", subject); return "marked";
    }
    if (intent.kind === "unsupported") {
      if (head?.state === "unsupported") return "current";
      await this.mark(appId, revision, "unsupported", subject); return "marked";
    }
    if (head?.state === "published" && head.generationId === intent.generationId) {
      await this.verify(appId,intent,head,signal,subject); return "current";
    }
    const bytes = intent.files.reduce((sum, file) => sum + file.bytes, 0);
    if (intent.files.length > APP_SURFACE_LIMITS.files || bytes > APP_SURFACE_LIMITS.totalBytes || intent.files.some(file => file.bytes > APP_SURFACE_LIMITS.fileBytes))
      return "too-large";
    const retained = subject ? pluginSurfaceFunctions["surfaces/plugins:retained"].result.parse(await this.input.transport.query("surfaces/plugins:retained",{...this.input.header(),subject,generationId:intent.generationId})) :
      surfaceFunctions["surfaces/generations:retained"].result.parse(await this.input.transport.query("surfaces/generations:retained",{...this.input.header(),appId,generationId:intent.generationId}));
    signal.throwIfAborted();
    if(retained){
      if(retained.state!=="published")throw new Error("surface-generation-changed");
      await this.verify(appId,intent,retained,signal,subject);
      if(subject)await this.input.transport.mutate("surfaces/plugins:commit",{...this.input.header(),subject,generationId:intent.generationId,expectedRevision:revision});
      else await this.input.transport.mutate("surfaces/generations:commit",{...this.input.header(),appId,generationId:intent.generationId,expectedRevision:revision});
      return "published";
    }
    await this.upload(appId, intent, revision, signal, subject);
    return "published";
  }

  private receiptKey(head:PublishedSurface) {
    return hashCanonical([this.input.scope,this.input.header().encryptedSpace,this.input.crypto().session.deviceId,head.manifest]);
  }
  private remember(appId:string,intent:Extract<SurfaceIntent,{kind:"compiled"}>,head:PublishedSurface,subject?:PluginSurfaceSubject) {
    if(this.verified.size>=128)this.verified.delete(this.verified.keys().next().value!);
    this.verified.set(this.receiptKey(head),surfacePublicationIdentity(appId,intent,subject));
  }
  private async verify(appId:string,intent:Extract<SurfaceIntent,{kind:"compiled"}>,head:PublishedSurface,signal:AbortSignal,subject?:PluginSurfaceSubject) {
    if(head.generationId!==intent.generationId || head.artifactDigest!==intent.artifactDigest)throw new Error("surface-generation-changed");
    const identity=surfacePublicationIdentity(appId,intent,subject),known=this.verified.get(this.receiptKey(head));
    if(known){if(known!==identity)throw new Error("surface-generation-changed");await verifySurfaceIntentFiles(intent,signal);return;}
    await verifyRetainedSurface(head,identity,intent,this.input.files,this.input.crypto(),signal);signal.throwIfAborted();
    this.remember(appId,intent,head,subject);
  }

  private async head(appId: string, subject?: PluginSurfaceSubject): Promise<AppSurfaceHead | PluginSurfaceHead | null> {
    if (subject) return pluginSurfaceFunctions["surfaces/plugins:head"].result.parse(await this.input.transport.query("surfaces/plugins:head", { ...this.input.header(), subject }));
    return surfaceFunctions["surfaces/generations:head"].result.parse(await this.input.transport.query("surfaces/generations:head", { ...this.input.header(), appId }));
  }
  private async mark(appId: string, expectedRevision: number, state: "unsupported" | "retired", subject?: PluginSurfaceSubject) {
    if (subject) { await this.input.transport.mutate("surfaces/plugins:mark", { ...this.input.header(), subject, expectedRevision, state: "retired" }); return; }
    await this.input.transport.mutate("surfaces/generations:mark", { ...this.input.header(), appId, expectedRevision, state });
  }
  private async upload(appId: string, intent: Extract<SurfaceIntent, { kind: "compiled" }>, expectedRevision: number, signal: AbortSignal, subject?: PluginSurfaceSubject) {
    const { scope, userData, transport } = this.input, crypto = this.input.crypto(), header = this.input.header(), generationId = intent.generationId;
    const kind = subject ? "plugin" as const : "app" as const, ownerId = subject ? pluginSurfaceOwnerId(subject) : appId;
    if (subject && !intent.plugin) throw new Error("PLUGIN_SURFACE_DECLARATION_MISSING");
    const custody = hashCanonical(["surface", scope, subject ?? appId, generationId]);
    const journal = appCiphertextJournal(userData, scope, ownerId, custody, work => this.serial(work), kind);
    const seal = (key: string, bytes: Uint8Array, mime: string, domain?: "app-surface-generation" | "plugin-surface-generation") => prepareEncryptedFile({ key, operationId: key,
      owner: { kind, id: ownerId }, ownerGeneration: generationId, ...(domain ? { domain } : {}), source: { sha256: hashBytes(bytes), bytes: bytes.byteLength, mime },
      priority: "background" }, { bytes: bytes.byteLength, mime, read: async (offset, length) => bytes.slice(offset, offset + length) }, crypto, journal, signal);
    // Operation ids follow the business id grammar (no "/"), so each file is keyed by its ordinal within the generation.
    const key = (ordinal: number | "manifest") => hashCanonical(["surface-file", subject ?? appId, generationId, ordinal]);
    const files: AppSurfaceManifest["files"] = [];
    for (const [ordinal, file] of intent.files.entries()) {
      signal.throwIfAborted();
      const bytes = await file.read();
      if (bytes.byteLength !== file.bytes || `sha256:${hashBytes(bytes)}` !== file.sha256) throw new Error("APP_SURFACE_SOURCE_CHANGED");
      files.push({ path: file.path, mime: file.mime, bytes: file.bytes, sha256: file.sha256, file: await seal(key(ordinal), bytes, APP_SURFACE_FILE_MIME) });
    }
    const manifest: AppSurfaceManifest = { schema: "bottega.app-surface/v1", appId, generationId, artifactDigest: intent.artifactDigest, entry: "index.html",
      layout: "compiled-v3", sdkSlice: intent.sdkSlice, grantedCapabilities: intent.grantedCapabilities, hostActions: intent.hostActions, files };
    const bytes = subject ? encodePluginSurfaceManifest({ schema: "bottega.plugin-surface/v1", subject, generationId, artifactDigest: intent.artifactDigest,
      entry: "index.html", layout: "compiled-v3", plugin: intent.plugin!, files }) : encodeAppSurfaceManifest(manifest);
    const manifestFile = await seal(key("manifest"), bytes, "application/json", subject ? "plugin-surface-generation" : "app-surface-generation");
    const generation = { generationId, artifactDigest: intent.artifactDigest, fileCount: files.length, byteSize: files.reduce((sum,file) => sum + file.bytes,0),
      manifest: {blobId:manifestFile.blobId,sha256:manifestFile.sha256,bytes:manifestFile.bytes,mime:"application/json" as const} };
    if (subject) await transport.mutate("surfaces/plugins:prepare", {...header,subject,generation});
    else await transport.mutate("surfaces/generations:prepare", {...header,generation:{...generation,appId,layout:"compiled-v3"}});
    const all: [EncryptedFileDescriptor, string, "app-surface-file" | "app-surface-generation"][] = [
      ...files.map((file, ordinal) => [file.file, key(ordinal), "app-surface-file"] as [EncryptedFileDescriptor, string, "app-surface-file"]),
      [manifestFile, key("manifest"), "app-surface-generation"]];
    const attempts = this.uploadAttempts(appCiphertextDirectory(userData, scope, ownerId, custody, kind));
    for (const [ordinal, [descriptor, fileKey, contentKind]] of all.entries()) {
      signal.throwIfAborted();
      await this.uploadOnce(header, descriptor, journal, fileKey, subject ? contentKind === "app-surface-file" ? "plugin-surface-file" : "plugin-surface-generation" : contentKind, signal, attempts, crypto.session);
      if (subject) await transport.mutate("surfaces/plugins:attach", {...header,subject,generationId,ordinal,file:ciphertextFileDescriptor(descriptor)});
      else await transport.mutate("surfaces/generations:attach", { ...header, appId, generationId, ordinal, file: ciphertextFileDescriptor(descriptor) });
    }
    const committed = subject ? await transport.mutate("surfaces/plugins:commit", {...header,subject,generationId,expectedRevision}) :
      await transport.mutate("surfaces/generations:commit", { ...header, appId, generationId, expectedRevision });
    if(committed?.state==="published")this.remember(appId,intent,committed,subject);
    // The generation is rooted in the cloud; its local ciphertext custody is no longer needed.
    await this.serial(() => rm(appCiphertextDirectory(userData, scope, ownerId, custody, kind), { recursive: true, force: true }));
  }
  /*
   * One retry per round with a fresh upload id when a session expired or failed, like the Skills publisher. The attempt is persisted per
   * frozen blob and renewed before any retry (review 0929-full F05): the service keeps a terminal receipt per id, so a terminal id is never
   * sent again, in this round or after a restart; a later round starts from the next attempt.
   */
  private async uploadOnce(header: EncryptedBusinessHeader, descriptor: EncryptedFileDescriptor, journal: FrozenFileJournal, fileKey: string,
    contentKind: "app-surface-file" | "app-surface-generation" | "plugin-surface-file" | "plugin-surface-generation", signal: AbortSignal, attempts: UploadAttempts, session: FileCipherPort["session"]) {
    for (let tries = 0; ; tries++) {
      const uploadId = hashCanonical(["app-surface-upload", canonicalJson(this.input.scope), session.sessionId, session.deviceId,
        descriptor.blobId, await attempts.current(descriptor.blobId)]);
      try { await this.input.files.uploadFile(header, uploadId, contentKind, descriptor, journal, fileKey, this.input.progress?.(), signal); return; }
      catch (error) {
        signal.throwIfAborted();
        const status = await this.input.transport.query("blobs/api:status", { ...header, uploadId }).catch(() => null) as { state?: string } | null;
        if (!status || !["expired", "failed", "cancelled"].includes(status.state ?? "")) throw error;
        await attempts.renew(descriptor.blobId);
        if (tries >= 1) throw error;
      }
    }
  }
  /* Each frozen blob's next upload attempt, beside the generation's ciphertext custody (removed with it after commit); written through the
     custody's single writer. */
  private uploadAttempts(directory: string): UploadAttempts {
    const path = join(directory, "upload-attempts.json");
    const read = async (): Promise<Record<string, number>> => {
      const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return "{}"; throw error; });
      const value = JSON.parse(text) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every(entry => Number.isSafeInteger(entry) && (entry as number) >= 0))
        throw new Error("APP_SURFACE_UPLOAD_ATTEMPTS_INVALID");
      return value as Record<string, number>;
    };
    return {
      current: async blobId => (await read())[blobId] ?? 0,
      renew: blobId => this.serial(async () => { const all = await read(); all[blobId] = (all[blobId] ?? 0) + 1; await durableReplaceFile(path, JSON.stringify(all)); }),
    };
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work); this.chain = next.catch(() => undefined); return next;
  }
}
