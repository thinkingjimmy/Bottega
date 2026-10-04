/**
 * [INPUT]: Worker crypto, immutable Skills DTOs and original frozen operation identities.
 * [OUTPUT]: Authenticated private heads, generation manifests and server-safe head validation.
 * [POS]: Skills codecs; no filesystem, credentials, scheduler or second outbox.
 */
import { canonicalJson } from "../encryption/encoding";
import { assertCrypto, assertExpectedContext, assertExpectedScope, createSkillHeadContext, createSkillGenerationContext,
  decodeBase64url, encodeBase64url, hashEnvelope, parseEnvelope } from "../encryption";
import type { FileCipherPort } from "../blobs/encrypted/model";
import type { BlobTransfer } from "../blobs/transfer";
import { encryptedSkillHeadSchema, skillFactsSchema, skillManifestSchema, SKILL_LIMITS,
  type EncryptedSkillHead, type SkillFacts, type RemoteSkillGeneration } from "./model";
export const skillHeadContext = (head: EncryptedSkillHead) => createSkillHeadContext(head.encryptedSpace.scope, head.libraryId, head.operationId,
  { expectedRevision: head.revision - 1, slugKey: head.slugKey, activeGenerationDigest: head.activeGenerationDigest, tombstone: head.tombstone });
export function validateSkillHead(input: EncryptedSkillHead) {
  const head = encryptedSkillHeadSchema.parse(input), bytes = decodeBase64url(head.packet.envelope, 1, SKILL_LIMITS.bytes);
  assertCrypto(bytes.length === head.packet.ciphertextBytes && hashEnvelope(bytes) === head.packet.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, skillHeadContext(head));
  return head;
}
export async function sealSkillHead(identity: Omit<EncryptedSkillHead, "packet" | "encryptedSpace">, facts: SkillFacts,
  crypto: FileCipherPort, signal?: AbortSignal): Promise<EncryptedSkillHead> {
  const parsed = skillFactsSchema.parse(facts);
  assertCrypto(!!crypto.skillSlugKey && await crypto.skillSlugKey(parsed.slug, signal) === identity.slugKey);
  assertCrypto((parsed.tombstoneAt !== null) === identity.tombstone &&
    (parsed.activeGenerationId === null) === (identity.activeGenerationDigest === null));
  const head = { ...identity, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  const context = skillHeadContext(head as EncryptedSkillHead), plaintext = new TextEncoder().encode(canonicalJson(parsed));
  try {
    const packet = await crypto.run({ kind: "encrypt", context, plaintext }, signal, { priority: "background" });
    assertCrypto(packet.kind === "encrypted");
    return validateSkillHead({ ...head, packet: { envelope: encodeBase64url(packet.envelope), ciphertextHash: packet.ciphertextHash,
      ciphertextBytes: packet.envelope.byteLength } });
  } finally { plaintext.fill(0); }
}
export async function openSkillHead(raw: EncryptedSkillHead, crypto: FileCipherPort, signal?: AbortSignal) {
  const head = validateSkillHead(raw);
  assertExpectedScope(head.encryptedSpace.scope, crypto.scope);
  assertCrypto(head.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const opened = await crypto.run({ kind: "decrypt", expectedContext: skillHeadContext(head), envelope: decodeBase64url(head.packet.envelope, 1, 69_700) }, signal);
  assertCrypto(opened.kind === "decrypted");
  try {
    const facts = skillFactsSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext)));
    assertCrypto(!!crypto.skillSlugKey && await crypto.skillSlugKey(facts.slug, signal) === head.slugKey &&
      (facts.tombstoneAt !== null) === head.tombstone && (facts.activeGenerationId === null) === (head.activeGenerationDigest === null));
    return facts;
  } finally { opened.plaintext.fill(0); }
}
export async function readSkillManifest(generation: RemoteSkillGeneration, transfer: BlobTransfer, crypto: FileCipherPort, signal: AbortSignal) {
  const manifest = generation.manifest;
  assertCrypto(generation.state === "ready" && manifest?.domain === "skill-generation" && manifest.blobId === generation.manifestBlobId &&
    manifest.owner.kind === "skill" && manifest.owner.id === generation.libraryId && manifest.ownerGeneration === generation.generationId);
  assertExpectedScope(manifest.encryptedSpace.scope, crypto.scope);
  assertCrypto(manifest.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint && manifest.bytes <= SKILL_LIMITS.manifestBytes + 131_072);
  const chunks: Uint8Array[] = []; let index = 0, bytes = 0;
  const clear = () => { for (const chunk of chunks) chunk.fill(0); chunks.length = 0; };
  try {
    return await transfer.read(manifest.blobId, manifest.owner, {
      write: async envelope => {
        const part = manifest.parts[index];
        assertCrypto(part && part.partIndex === index && part.bytes === envelope.byteLength && hashEnvelope(envelope) === part.sha256);
        const expectedContext = createSkillGenerationContext(crypto.scope, generation.generationId, manifest.operationId,
          { libraryId: generation.libraryId, generationId: generation.generationId, blobId: manifest.blobId, manifestId: manifest.manifestId,
            chunkIndex: index++, chunkCount: manifest.chunkCount });
        const opened = await crypto.run({ kind: "decrypt", expectedContext, envelope }, signal, { priority: "background" });
        assertCrypto(opened.kind === "decrypted"); bytes += opened.plaintext.byteLength;
        if (bytes > SKILL_LIMITS.manifestBytes) { opened.plaintext.fill(0); assertCrypto(false); }
        chunks.push(opened.plaintext);
      },
      commit: async descriptor => {
        assertCrypto(index === manifest.chunkCount && descriptor.sha256 === manifest.sha256 && descriptor.bytes === manifest.bytes);
        const plaintext = new Uint8Array(bytes); let offset = 0;
        try {
          for (const chunk of chunks) { plaintext.set(chunk, offset); offset += chunk.length; }
          const result = skillManifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)));
          assertCrypto(result.libraryId === generation.libraryId && result.generationId === generation.generationId &&
            result.files.length === generation.fileCount && result.files.reduce((sum, file) => sum + file.file.bytes, 0) === generation.byteSize);
          return result;
        } finally { plaintext.fill(0); }
      }, abort: async () => clear(),
    }, undefined, signal);
  } finally { clear(); }
}
