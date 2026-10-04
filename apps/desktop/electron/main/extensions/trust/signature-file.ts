/**
 * [INPUT]: Depends on the contracts' package-signature schema and EXTENSION_SIGNATURE_FILE (@bottega/contracts/trust/signing).
 * [OUTPUT]: Provides takeSignatureFile (split the package-root signature file off a staged member list, parsed strictly), ExtensionSignatureFileError and SIGNATURE_FILE_MAX_BYTES.
 * [POS]: extensions/trust's one reader of bottega.signature.json, shared by both host-package stagers (local directory or .tgz, and the GitHub fetcher), so the signature is never package content: it is outside the content digest it signs and never reaches a host.
 */
import { EXTENSION_SIGNATURE_FILE, packageSignatureSchema, type PackageSignature } from "@bottega/contracts/trust/signing";

/** A signature envelope is a few KiB; anything larger is not one. */
export const SIGNATURE_FILE_MAX_BYTES = 64 * 1024;

export class ExtensionSignatureFileError extends Error {
  readonly name = "ExtensionSignatureFileError";
  readonly code = "extension-signature-malformed";
  constructor(detail: string) { super(`extension-signature-malformed: ${EXTENSION_SIGNATURE_FILE} ${detail}`); }
}

/** Parsed strictly: a package that ships a signature file that is not exactly a signature envelope is refused, never staged unsigned. */
export function parseSignatureFile(bytes: Uint8Array): PackageSignature {
  if (bytes.byteLength > SIGNATURE_FILE_MAX_BYTES) throw new ExtensionSignatureFileError(`exceeds ${SIGNATURE_FILE_MAX_BYTES} bytes`);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ExtensionSignatureFileError("is not UTF-8 JSON"); }
  const parsed = packageSignatureSchema.safeParse(raw);
  if (!parsed.success) throw new ExtensionSignatureFileError(`does not match the signature schema (${parsed.error.issues.map(issue => issue.path.join(".") || "document").join(", ")})`);
  return parsed.data;
}

/** The members to stage (the signature file removed) and the parsed signature, or null for an unsigned package. */
export function takeSignatureFile<M extends { path: string; bytes: Uint8Array }>(members: readonly M[]): { members: M[]; signature: PackageSignature | null } {
  const file = members.find(member => member.path === EXTENSION_SIGNATURE_FILE);
  return { members: members.filter(member => member !== file), signature: file ? parseSignatureFile(file.bytes) : null };
}
