/**
 * [INPUT]: Node Ed25519 verification, canonical signed contracts and monotonic trust state.
 * [OUTPUT]: verifyTrustMetadata and verifyPackage authenticate rotation, freshness, rollback floors (including missing snapshots) and exact package bytes; verdicts never grant capabilities.
 * [POS]: Trust verification boundary; authenticated metadata advances durable floors before package admission.
 */
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import {
  extensionTrustAnchorSchema, packageSignatureSchema, rootDocumentSchema, signingBytes, snapshotDocumentSchema,
  type RootDocument, type SigningRole,
} from "@bottega/contracts/trust/signing";

/** The longest a revocation snapshot may claim to be fresh (3-delivery §8: 24 h at most). */
export const MAX_SNAPSHOT_LIFETIME_MS = 24 * 60 * 60 * 1000;

export type RefusalReason = "signature-malformed" | "root-invalid" | "root-test-environment" | "root-expired" | "root-rollback" | "publisher-not-authorised" | "signature-invalid"
  | "signature-expired" | "identity-mismatch" | "artifact-digest-mismatch" | "manifest-digest-mismatch" | "permissions-mismatch" | "snapshot-invalid"
  | "snapshot-rollback" | "snapshot-lifetime" | "key-revoked" | "artifact-revoked";
/* "unsigned" is the gate's answer for a package with no signature file; the verifier itself never sees one. */
export type LocalConfirmationReason = "unprovisioned" | "unsigned" | "state-unreadable" | "clock-unavailable" | "snapshot-missing" | "snapshot-expired";
export type TrustVerdict =
  /* A trusted signature says who published these exact bytes. It grants nothing: permissions are admission's decision. */
  | { status: "trusted"; publisher: string; keyId: string; rootVersion: number; snapshotVersion: number; permissionGranted: false }
  | { status: "refused"; reason: RefusalReason }
  | { status: "local-confirmation"; reason: LocalConfirmationReason };

export type TrustVersions = { rootVersion: number; snapshotVersion: number };
/** The monotonic floor: the highest root and snapshot versions this host has accepted. `readable: false` (a corrupt file) fails closed. */
export type TrustState = { read(): TrustVersions; advance(next: TrustVersions): void; readable?: boolean };
export function memoryTrustState(initial: TrustVersions = { rootVersion: 0, snapshotVersion: 0 }): TrustState {
  let current = { ...initial };
  return { read: () => ({ ...current }),
    advance: (next) => { current = { rootVersion: Math.max(current.rootVersion, next.rootVersion), snapshotVersion: Math.max(current.snapshotVersion, next.snapshotVersion) }; } };
}

export type VerifyPackageInput = {
  /** The embedded anchor (resources/extension-trust/root.json), as read. */
  anchor: unknown;
  /** Newer roots, oldest first: each must be version N+1, signed by the previous root and by itself. */
  rootUpdates: readonly unknown[];
  /** The latest timestamp / revocation snapshot, or null when none is available (offline). */
  snapshot: unknown | null;
  signature: unknown;
  /* The host-computed content digest of the staged files (the Registry's contentDigest), so a directory and a .tgz of the same
     files verify alike and every later load checks the same digest. */
  artifactDigest: string;
  manifest: Uint8Array;
  /** What the host is being asked to admit: the signature must name exactly this. */
  expected: { kind: "extension" | "app"; id: string; version: string; permissionsDigest: string };
  /** Milliseconds since the epoch; undefined or not finite when the clock cannot be trusted. */
  now: number | undefined;
  state: TrustState;
  /** Only a development run (test mode) may trust a test root; a packaged build passes false. */
  acceptTestRoot: boolean;
  maxSnapshotLifetimeMs?: number;
};

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const digestOf = (bytes: Uint8Array) => `sha256:${sha256(bytes)}`;
const refuse = (reason: RefusalReason): TrustVerdict => ({ status: "refused", reason });
const localConfirmation = (reason: LocalConfirmationReason): TrustVerdict => ({ status: "local-confirmation", reason });

/** A root's keys, each checked against its keyId (sha256 of the raw public key); null when any key lies about its id. */
function rootKeys(root: RootDocument): Map<string, KeyObject> | null {
  const keys = new Map<string, KeyObject>();
  for (const [keyId, entry] of Object.entries(root.signed.keys)) {
    const raw = Buffer.from(entry.public, "base64url");
    if (raw.length !== 32 || sha256(raw) !== keyId) return null;
    keys.set(keyId, createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: "der", type: "spki" }));
  }
  return keys;
}
/** How many distinct keys of `allowed` produced a valid signature over `signed` in `role`'s domain. */
function validSigners(role: SigningRole, signed: unknown, signatures: readonly { keyId: string; sig: string }[], keys: Map<string, KeyObject>, allowed: readonly string[]) {
  const bytes = signingBytes(role, signed), seen = new Set<string>();
  for (const { keyId, sig } of signatures) {
    const key = keys.get(keyId);
    if (!key || !allowed.includes(keyId) || seen.has(keyId)) continue;
    if (verify(null, bytes, key, Buffer.from(sig, "base64url"))) seen.add(keyId);
  }
  return seen;
}
const meets = (role: SigningRole, signed: unknown, signatures: readonly { keyId: string; sig: string }[], keys: Map<string, KeyObject>, rule: { keyIds: string[]; threshold: number }) =>
  validSigners(role, signed, signatures, keys, rule.keyIds).size >= rule.threshold;

/** The embedded root, then each rotation in order; null when any link is not the next version signed by both the old and new root. */
function trustedRoot(anchorRoot: RootDocument, updates: readonly unknown[]): { root: RootDocument; keys: Map<string, KeyObject> } | null {
  let root = anchorRoot, keys = rootKeys(root);
  if (!keys || !meets("root", root.signed, root.signatures, keys, root.signed.roles.root)) return null;
  for (const raw of updates) {
    const next = rootDocumentSchema.safeParse(raw);
    if (!next.success || next.data.signed.version !== root.signed.version + 1) return null;
    const nextKeys = rootKeys(next.data);
    if (!nextKeys) return null;
    /* The previous root's keys authorise the rotation; the new root's own keys prove it can sign. */
    if (!meets("root", next.data.signed, next.data.signatures, keys, root.signed.roles.root)) return null;
    if (!meets("root", next.data.signed, next.data.signatures, nextKeys, next.data.signed.roles.root)) return null;
    if (next.data.signed.environment !== root.signed.environment) return null;
    root = next.data; keys = nextKeys;
  }
  return { root, keys };
}

export function verifyTrustMetadata(input: Pick<VerifyPackageInput, "anchor" | "rootUpdates" | "snapshot" | "state" | "acceptTestRoot">) {
  const anchor = extensionTrustAnchorSchema.safeParse(input.anchor);
  const fail = (verdict: TrustVerdict) => ({ verdict } as const);
  if (!anchor.success) return fail(refuse("root-invalid"));
  /* Until the key ceremony there is nothing to verify against, and that must never read as a pass (T15). */
  if (anchor.data.state === "unprovisioned") return fail(localConfirmation("unprovisioned"));
  const chain = trustedRoot(anchor.data.root, input.rootUpdates);
  if (!chain) return fail(refuse("root-invalid"));
  if (chain.root.signed.environment === "test" && !input.acceptTestRoot) return fail(refuse("root-test-environment"));
  const floor = input.state.read();
  if (chain.root.signed.version < floor.rootVersion) return fail(refuse("root-rollback"));
  const snapshot = input.snapshot === null ? null : snapshotDocumentSchema.safeParse(input.snapshot);
  if (snapshot && !snapshot.success) return fail(refuse("snapshot-invalid"));
  const current = snapshot?.success ? snapshot.data : null;
  if (!current && floor.snapshotVersion > 0) return fail(refuse("snapshot-rollback"));
  if (current) {
    if (!meets("snapshot", current.signed, current.signatures, chain.keys, chain.root.signed.roles.timestamp)) return fail(refuse("snapshot-invalid"));
    if (current.signed.version < floor.snapshotVersion) return fail(refuse("snapshot-rollback"));
  }
  /* Authenticated, non-rollback metadata raises the floor before the package is decided, even when that very metadata refuses it
     (a root that drops the publisher, a snapshot that revokes it): otherwise replaying the older, still-valid version trusts it again. */
  if (input.state.readable !== false) {
    input.state.advance({ rootVersion: chain.root.signed.version, snapshotVersion: current?.signed.version ?? floor.snapshotVersion });
  }
  return { metadata: { ...chain, current } } as const;
}

export function verifyPackage(input: VerifyPackageInput): TrustVerdict {
  const verified = verifyTrustMetadata(input);
  if ("verdict" in verified) return verified.verdict;
  const { current, ...chain } = verified.metadata;
  const signature = packageSignatureSchema.safeParse(input.signature);
  if (!signature.success) return refuse("signature-malformed");

  /* Everything that needs no clock comes first, so a missing snapshot or an unknown time never hides a bad package. */
  const signed = signature.data.signed, roles = chain.root.signed.roles;
  if (!roles.publisher.keyIds.includes(signed.keyId)) return refuse("publisher-not-authorised");
  if (validSigners("package", signed, signature.data.signatures, chain.keys, [signed.keyId]).size === 0) return refuse("signature-invalid");
  if (signed.kind !== input.expected.kind || signed.id !== input.expected.id || signed.version !== input.expected.version) return refuse("identity-mismatch");
  if (signed.artifactDigest !== input.artifactDigest) return refuse("artifact-digest-mismatch");
  if (signed.manifestDigest !== digestOf(input.manifest)) return refuse("manifest-digest-mismatch");
  if (signed.permissionsDigest !== input.expected.permissionsDigest) return refuse("permissions-mismatch");
  if (current) {
    if (current.signed.revokedKeyIds.includes(signed.keyId)) return refuse("key-revoked");
    if (current.signed.revokedArtifacts.includes(signed.artifactDigest)) return refuse("artifact-revoked");
  }

  const now = input.now;
  if (now === undefined || !Number.isFinite(now)) return localConfirmation("clock-unavailable");
  if (chain.root.signed.expires <= now) return refuse("root-expired");
  if (signed.expires <= now) return refuse("signature-expired");
  if (!current) return localConfirmation("snapshot-missing");
  if (current.signed.expires <= now) return localConfirmation("snapshot-expired");
  if (current.signed.expires - now > (input.maxSnapshotLifetimeMs ?? MAX_SNAPSHOT_LIFETIME_MS)) return refuse("snapshot-lifetime");
  /* An unreadable floor cannot rule out a rollback: everything above passed, but it is still only a local confirmation. */
  if (input.state.readable === false) return localConfirmation("state-unreadable");

  return { status: "trusted", publisher: signed.publisher, keyId: signed.keyId, rootVersion: chain.root.signed.version,
    snapshotVersion: current.signed.version, permissionGranted: false };
}
