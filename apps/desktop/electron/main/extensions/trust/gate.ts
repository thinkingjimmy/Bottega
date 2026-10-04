/**
 * [INPUT]: Depends on the manifest schema, signed metadata source, persisted version floors and package/metadata verifiers.
 * [OUTPUT]: Provides ExtensionTrustGate, TrustSubject, createExtensionTrustGate, unprovisionedTrustGate and permissionsDigestOf.
 * [POS]: Shared install/launch verifier; only authenticated non-rollback metadata reaches durable acceptance, retaining revocations across restart.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type PackageSignature } from "@bottega/contracts/trust/signing";
import { HOST_PACKAGE_MANIFEST, hostPackageManifestSchema, type HostPackageManifest } from "../host/manifest";
import { digestCanonical } from "../registry/registry-canonical";
import type { TrustAnchorRead } from "./anchor";
import { fileTrustState } from "./state";
import { verifyPackage, verifyTrustMetadata, type TrustState, type TrustVerdict } from "./verifier";
import { trustMetadataSource } from "./metadata/source";

/** What is verified: a staged or installed host package, keyed by its staging digest or its generation. */
export type TrustSubject = Readonly<{
  key: string;
  signature: PackageSignature | null;
  /** The host-computed content digest of the staged files (the signature file excluded): the artifact digest a signature names. */
  contentDigest: string;
  packageRoot: string;
}>;
export interface ExtensionTrustGate { verify(subject: TrustSubject): Promise<TrustVerdict> }

/** The permissions a signature names: sha256 over the canonical JSON of the manifest's `permissions` object. */
export const permissionsDigestOf = (permissions: HostPackageManifest["permissions"]) => digestCanonical(permissions);

const UNPROVISIONED = { schema: "bottega.extension-trust/v1", state: "unprovisioned" } as const;

export function createExtensionTrustGate(input: {
  userData: string;
  anchor: TrustAnchorRead;
  now?: () => number | undefined;
  state?: TrustState & { flush?(): Promise<void> };
  fetch?: typeof fetch;
}): ExtensionTrustGate {
  if (input.anchor.diagnostic) console.warn(`[extension-trust] ${input.anchor.diagnostic}`);
  const now = input.now ?? (() => Date.now());
  /* Only the unpackaged test anchor may carry a test root; anchor.ts never returns that source from a packaged build. */
  const acceptTestRoot = input.anchor.source === "test-override";
  const source = trustMetadataSource({ anchor: input.anchor, userData: input.userData, fetch: input.fetch });
  let state = input.state ?? null;
  const cache = new Map<string, { verdict: TrustVerdict; until: number }>();
  return {
    async verify(subject) {
      /* An unsigned package is what every package is today: it reaches the person's local confirmation, never a refusal. */
      if (!subject.signature) return { status: "local-confirmation", reason: "unsigned" };
      const metadata = await source.read();
      const { snapshot, roots: rootUpdates } = metadata;
      state ??= fileTrustState(input.userData);
      const verified = verifyTrustMetadata({ anchor: input.anchor.anchor, rootUpdates, snapshot, state, acceptTestRoot });
      await state.flush?.();
      if ("verdict" in verified) return verified.verdict;
      await source.accept(metadata);
      const rootVersion = verified.metadata.root.signed.version, snapshotVersion = verified.metadata.current?.signed.version ?? 0;
      const at = now();
      const key = [subject.key, subject.contentDigest, digestCanonical({ metadata, signature: subject.signature })].join("|");
      const hit = cache.get(key);
      /* A cached trust answers only while the versions it was computed for still meet the shared floor: another package's newer
         snapshot (or root) may have raised it since, and then this older one is a rollback the verifier must refuse (review 0929-2 N01). */
      const floor = state?.read(), meetsFloor = !floor || (state?.readable !== false && rootVersion >= floor.rootVersion && snapshotVersion >= floor.snapshotVersion);
      if (hit && at !== undefined && Number.isFinite(at) && at < hit.until && (hit.verdict.status !== "trusted" || meetsFloor)) return hit.verdict;
      const manifestBytes = await readFile(join(subject.packageRoot, HOST_PACKAGE_MANIFEST));
      const manifest = hostPackageManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
      const verdict = verifyPackage({
        anchor: input.anchor.anchor, rootUpdates, snapshot, signature: subject.signature, artifactDigest: subject.contentDigest,
        manifest: manifestBytes, now: at, state, acceptTestRoot,
        expected: { kind: "extension", id: manifest.packageId, version: manifest.packageVersion, permissionsDigest: permissionsDigestOf(manifest.permissions) },
      });
      /* Any verdict may have raised the floor (a revoking snapshot does too); it is durable before admission or launch continues. */
      await state.flush?.();
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      if (verdict.status === "trusted") {
        cache.set(key, { verdict, until: Math.min(subject.signature.signed.expires, verified.metadata.current?.signed.expires ?? 0, verified.metadata.root.signed.expires) });
      } else if (verdict.status === "refused") {
        cache.set(key, { verdict, until: Number.POSITIVE_INFINITY });
      }
      return verdict;
    },
  };
}

/** The gate an unwired composition gets: every signed package reads as unprovisioned, so nothing is trusted or refused. */
export const unprovisionedTrustGate = (userData: string) =>
  createExtensionTrustGate({ userData, anchor: { anchor: UNPROVISIONED, source: "embedded" } });
