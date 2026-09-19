/**
 * [INPUT]: Original native images, frozen field file commitments, unresolved operations and explicit in-flight operation identities.
 * [OUTPUT]: A read-only retention plan for original Base file journals; no filesystem mutation or automatic collection.
 * [POS]: Pure custody analysis used to prove release eligibility before any cleanup owner is connected.
 */
import type { BaseRow } from "../../../../../../shared/bases-ipc";
import type { EncryptedBaseField } from "@ai-chat/cloud-protocol/bases/encrypted";
import type { BaseSyncEnvelope, PendingBaseOperation } from "../model";
import type { BaseEncryptionFiles } from "./model";

export function baseCiphertextHashes(envelope: BaseSyncEnvelope) {
  return new Set([envelope.encryptionFiles, ...envelope.detachedCustody.map(value => value.encryptionFiles)]
    .flatMap(files => Object.values(files?.records ?? {}).map(record => record.hash)));
}

export function planBaseCiphertextRetention(envelope: BaseSyncEnvelope, rows: readonly BaseRow[], active: ReadonlySet<string> = new Set()): {
  files: BaseEncryptionFiles | undefined; released: ReadonlySet<string>;
} {
  const files = envelope.encryptionFiles; if (!files) return { files, released: new Set() };
  const images = new Set<string>(), operations = new Set(active), referencedFiles = new Set<string>();
  const native = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(native); return; }
    const item = value as Record<string, unknown>;
    if (item.kind === "attachment" && typeof item.blobId === "string") images.add(item.blobId);
    Object.values(item).forEach(native);
  };
  const fields = (values: readonly EncryptedBaseField[]) => {
    for (const field of values) for (const reference of field.references) {
      referencedFiles.add(reference.blobId);
    }
  };
  const pending = (operation: PendingBaseOperation) => {
    operations.add(operation.operationId); native(operation);
    if (operation.encryptedTransport) fields(operation.encryptedTransport.commit.fields);
  };
  native(rows); native(envelope.confirmed?.rows);
  for (const operation of envelope.pendingOperations) pending(operation);
  const dependencies = new Set(envelope.pendingOperations.flatMap(operation => operation.dependsOnOperationIds));
  for (const receipt of envelope.receipts) if (dependencies.has(receipt.operationId)) native(receipt.baseline);
  for (const candidate of envelope.conflictCandidates) {
    if (candidate.state === "unresolved" || candidate.receipt && !candidate.remoteResolved || candidate.copyRequest && !candidate.copiedTo) {
      pending(candidate.operation); native(candidate.currentValues); native(candidate.recoveryContext); native(candidate.receipt?.baseline);
    }
    for (const original of candidate.staleResolutions ?? []) pending(original);
  }
  for (const initial of [envelope.initialCiphertext, ...envelope.detachedInitialCiphertexts ?? []]) if (initial) fields(initial.initial.fields);
  // Detached records remain an independent durable root; their native images may also back a reviewed local copy.
  native(envelope.detachedCustody);
  const keptImages = Object.fromEntries(Object.entries(files.images).filter(([blobId, value]) =>
    images.has(blobId) || operations.has(value.descriptor.encryption.operationId) || referencedFiles.has(value.descriptor.blobId)));
  for (const image of Object.values(keptImages)) referencedFiles.add(image.descriptor.blobId);
  // An old unindexed record is unknown, never evidence of release.
  const records = Object.fromEntries(Object.entries(files.records).filter(([, value]) => !value.blobId || operations.has(value.operationId) || referencedFiles.has(value.blobId)));
  if (Object.keys(records).length === Object.keys(files.records).length && Object.keys(keptImages).length === Object.keys(files.images).length) return { files, released: new Set() };
  const retained = Object.keys(records).length || Object.keys(keptImages).length ? { records, images: keptImages } : undefined;
  const next = baseCiphertextHashes({ ...envelope, encryptionFiles: retained });
  return { files: retained, released: new Set([...baseCiphertextHashes(envelope)].filter(hash => !next.has(hash))) };
}
