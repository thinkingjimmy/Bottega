/**
 * [INPUT]: Depends on zod and the contracts' canonical JSON.
 * [OUTPUT]: Provides the extension signing formats: SIGNING_DOMAINS and signingBytes (the exact bytes a key signs), the root (production or test, never both), package-signature and snapshot documents, EXTENSION_SIGNATURE_FILE (where a package carries its signature), and the embedded trust anchor (unprovisioned or provisioned with a root).
 * [POS]: The one definition the offline signing tool and the host verifier share, so what is signed and what is verified can never drift; the verifier itself (Node crypto) lives in the private host.
 */
import { z } from "zod";
import { canonicalJson } from "../core/canonical-json";

/* One domain line per role: a signature made for one role can never verify as another's (a manifest replayed as a snapshot). */
export const SIGNING_DOMAINS = Object.freeze({
  root: "bottega.extension-trust.root/v1",
  package: "bottega.extension-trust.package/v1",
  snapshot: "bottega.extension-trust.snapshot/v1",
} as const);
export type SigningRole = keyof typeof SIGNING_DOMAINS;

/** The bytes a key signs: the role's domain line, a newline, then the canonical JSON of the signed payload. */
export function signingBytes(role: SigningRole, signed: unknown): Uint8Array {
  return new TextEncoder().encode(`${SIGNING_DOMAINS[role]}\n${canonicalJson(signed)}`);
}

/** sha256 of the key's raw 32-byte Ed25519 public key, lowercase hex. */
const keyIdSchema = z.string().regex(/^[0-9a-f]{64}$/);
const base64url = (bytes: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((bytes * 4) / 3)}}$`));
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const epochMs = z.number().int().positive();
const signaturesSchema = z.array(z.object({ keyId: keyIdSchema, sig: base64url(64) }).strict()).min(1).max(16);
const roleSchema = z.object({ keyIds: z.array(keyIdSchema).min(1).max(16), threshold: z.number().int().min(1).max(16) }).strict()
  .refine((role) => role.threshold <= role.keyIds.length, "threshold exceeds the role's keys");

/** The offline root: who may sign packages and snapshots. A rotation is version N+1, signed by the old root and the new one. */
export const rootSignedSchema = z.object({
  type: z.literal("root"),
  /* A test root exists only for test mode; a packaged build refuses one, and no rotation changes a root's environment. */
  environment: z.enum(["production", "test"]),
  version: z.number().int().min(1),
  expires: epochMs,
  keys: z.record(keyIdSchema, z.object({ scheme: z.literal("ed25519"), public: base64url(32) }).strict()),
  roles: z.object({ root: roleSchema, publisher: roleSchema, timestamp: roleSchema }).strict(),
}).strict();
export const rootDocumentSchema = z.object({ signed: rootSignedSchema, signatures: signaturesSchema }).strict();
export type RootDocument = z.infer<typeof rootDocumentSchema>;

/**
 * Where a package carries its signature: beside bottega.extension.json. The host strips it when staging, so it is never package
 * content, never runtime-visible, and outside the content digest it signs.
 */
export const EXTENSION_SIGNATURE_FILE = "bottega.signature.json";

/** A publisher's signature over one package: what it is, the exact bytes, and the permissions it asks for. */
export const packageSignedSchema = z.object({
  type: z.literal("package"),
  publisher: z.string().min(1).max(128),
  keyId: keyIdSchema,
  kind: z.enum(["extension", "app"]),
  id: z.string().min(1).max(128),
  version: z.string().min(1).max(64),
  artifactDigest: digestSchema,
  manifestDigest: digestSchema,
  permissionsDigest: digestSchema,
  contractRange: z.string().min(1).max(64),
  signedAt: epochMs,
  expires: epochMs,
}).strict().refine((signed) => signed.expires > signed.signedAt, "expires must follow signedAt");
export const packageSignatureSchema = z.object({ signed: packageSignedSchema, signatures: signaturesSchema }).strict();
export type PackageSignature = z.infer<typeof packageSignatureSchema>;

/** The online timestamp / revocation snapshot: monotonic, short-lived, and the keys and artifacts no longer trusted. */
export const snapshotSignedSchema = z.object({
  type: z.literal("snapshot"),
  version: z.number().int().min(1),
  expires: epochMs,
  revokedKeyIds: z.array(keyIdSchema).max(1024),
  revokedArtifacts: z.array(digestSchema).max(4096),
  publisherMetadataHash: digestSchema,
}).strict();
export const snapshotDocumentSchema = z.object({ signed: snapshotSignedSchema, signatures: signaturesSchema }).strict();
export type SnapshotDocument = z.infer<typeof snapshotDocumentSchema>;

/**
 * The host's embedded trust anchor (resources/extension-trust/root.json). Until the key ceremony it is `unprovisioned`, and every
 * verification answers "local confirmation only": never a silent pass.
 */
export const extensionTrustAnchorSchema = z.discriminatedUnion("state", [
  z.object({ schema: z.literal("bottega.extension-trust/v1"), state: z.literal("unprovisioned") }).strict(),
  z.object({ schema: z.literal("bottega.extension-trust/v1"), state: z.literal("provisioned"), root: rootDocumentSchema }).strict(),
]);
export type ExtensionTrustAnchor = z.infer<typeof extensionTrustAnchorSchema>;
