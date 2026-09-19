/**
 * [INPUT]: Admitted account crypto/transport, frozen file journals and immutable artifact custody.
 * [OUTPUT]: Resumable encrypted upload with durable session renewal, exact references and verified remote bytes.
 * [POS]: Artifact adapter for the existing file transfer; owner-bound encryption is repeated for every Fork.
 */
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { protocolHeader, type BlobTransferPorts, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { frozenFileRecordSchema, type FileCipherPort, type FrozenFileJournal } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { prepareEncryptedFile } from "@ai-chat/cloud-protocol/blobs/encrypted/client";
import { EncryptedBlobTransfer, ciphertextFileDescriptor } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { describeArtifactFile } from "@ai-chat/cloud-protocol/artifacts/descriptor";
import type { AccountTransport } from "../../cloud/runtime/transport";
import { DurableJson } from "../../persistence/durable-json";
import type { SnapshotCustody } from "./snapshot-custody";
import type { ArtifactPublishTransport } from "./publish";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function lostUploadSession(error: unknown) {
  return error !== null && typeof error === "object" && "data" in error &&
    ["upload-not-found", "upload-expired", "upload-session-mismatch", "upload-id-reused"].includes(String(error.data));
}
async function mustRenewUpload(ports: BlobTransferPorts, uploadId: string, error: unknown, signal: AbortSignal) {
  if (lostUploadSession(error)) return true;
  try {
    const status = await ports.status(uploadId, signal);
    return ["cancelled", "expired", "failed"].includes(status.state) || status.state !== "ready" && status.expiresAt <= Date.now();
  } catch (statusError) { return lostUploadSession(statusError); }
}
function fileJournal(root: string): FrozenFileJournal {
  const schema = z.object({ value: frozenFileRecordSchema.nullable() }).strict();
  const records = new Map<string, Promise<DurableJson<z.infer<typeof schema>>>>();
  const record = (key: string) => {
    let result = records.get(key);
    if (!result) {
      result = (async () => { const value = new DurableJson(join(root, hash(key) + ".json"), schema, () => ({ value: null })); await value.initialize(); return value; })();
      records.set(key, result);
    }
    return result;
  };
  return { read: async key => (await record(key)).snapshot().value, write: async (key, value) =>
    (await record(key)).mutate(state => { state.value ??= value; return state.value; }) };
}
export function artifactCloudTransport(input: { root: string; custody: SnapshotCustody; config: CloudBuildConfig;
  crypto: FileCipherPort; filePorts: BlobTransferPorts; transport: Pick<AccountTransport, "query" | "mutate">; current(): void }): ArtifactPublishTransport {
  const crypto = input.crypto;
  const accountKey = hash([crypto.scope, crypto.keyPackageFingerprint, crypto.session.userId]);
  const header = { ...protocolHeader(input.config), expectedUserId: crypto.session.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  const stateFor = async (ref: unknown) => {
    const root = join(input.root, "transfers", accountKey, hash(ref));
    const identity = new DurableJson(join(root, "upload.json"), z.object({ uploadId: z.uuid() }).strict(), () => ({ uploadId: randomUUID() }));
    await identity.initialize(); return { root, identity, uploadId: identity.snapshot().uploadId };
  };
  return {
    accountKey,
    settled: async job => { await rm(join(input.root, "transfers", accountKey, hash(job.ref)), { recursive: true, force: true }); },
    publish: async (job, active, signal) => {
      input.current();
      const stored = await input.custody.read(job.ref), state = await stateFor(job.ref);
      const journal = fileJournal(state.root), key = hash(job.ref), transfer = new EncryptedBlobTransfer(input.filePorts);
      try {
        const descriptor = await prepareEncryptedFile({ key, operationId: key, owner: { kind: "chat", id: job.ref.chatId }, ownerGeneration: null,
          source: { bytes: stored.data.length, mime: job.fence.mime!, sha256: job.fence.sha256! } },
        { bytes: stored.data.length, mime: job.fence.mime!, read: async (offset, length) => new Uint8Array(stored.data.slice(offset, offset + length)) }, crypto, journal, signal);
        input.current(); if (!active()) return;
        for (let attempt = 0; ; attempt++) {
          try { await transfer.uploadFile(header, state.uploadId, "artifact", descriptor, journal, key, undefined, signal); break; }
          catch (error) {
            signal.throwIfAborted(); input.current();
            if (attempt > 0 || !active() || !await mustRenewUpload(input.filePorts, state.uploadId, error, signal)) throw error;
            signal.throwIfAborted(); input.current(); if (!active()) return;
            // Only the transport session changes; the frozen owner-bound ciphertext stays identical.
            state.uploadId = await state.identity.mutate(value => value.uploadId = randomUUID());
          }
        }
        input.current(); if (!active()) return;
        await input.transport.mutate("blobs/references:replaceArtifact", { ...header, owner: { kind: "chat", id: job.ref.chatId }, referenceId: job.ref.artifactId,
          blobs: [ciphertextFileDescriptor(descriptor)] });
      } finally {
        await transfer.close(); await state.identity.closeAndFlush();
        // Shutdown aborts local I/O. Explicit reference release owns remote cancellation.
        if (!active() && !signal.aborted) await input.filePorts.cancel(state.uploadId).catch(() => {});
      }
    },
    release: async (job, signal) => {
      signal.throwIfAborted(); input.current();
      await input.transport.mutate("blobs/references:replaceArtifact", { ...header, owner: { kind: "chat", id: job.ref.chatId }, referenceId: job.ref.artifactId, blobs: [] });
      const state = await stateFor(job.ref);
      try { await input.filePorts.cancel(state.uploadId).catch(() => {}); } finally { await state.identity.closeAndFlush(); }
    },
    download: async (ref, fence, signal) => {
      input.current();
      const manifest = await input.transport.query("blobs/references:describe", { ...header, owner: { kind: "chat", id: ref.chatId }, referenceId: ref.artifactId });
      if (!manifest) throw new Error("artifact-sync-pending");
      const descriptor = describeArtifactFile(fence, ref.chatId, manifest), transfer = new EncryptedBlobTransfer(input.filePorts);
      const chunks: Uint8Array[] = [];
      try {
        return await transfer.readFile(descriptor, crypto, { write: async bytes => { chunks.push(bytes); },
          commit: async () => { input.current(); const data = new Uint8Array(descriptor.bytes); let offset = 0;
            for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; } return data; },
          abort: async () => { for (const chunk of chunks) chunk.fill(0); chunks.length = 0; } }, undefined, signal);
      } finally { await transfer.close(); }
    },
  };
}
