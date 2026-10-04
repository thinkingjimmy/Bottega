/**
 * [INPUT]: Extension admission, source provenance, scope, trust and migration identity contracts.
 * [OUTPUT]: ExtensionSourceFetcher, ExtensionAffectedApp, ExtensionAppMigrationPort, ExtensionCapabilityDiff, ExtensionInstallPreflight, HeldPreflight, ExtensionInstallRequest.
 * [POS]: Extension installation contracts; mutable authorization remains in installer.ts.
 */
import type { ExtensionPackageGenerationRef, Sha256Digest } from "../../../../shared/ipc/settings/extensions-ipc";
import { type ProductResourceScope } from "../../../../shared/product/product-resource-scope";
import { type ExtensionAdapterId, type ExtensionAdmission } from "../admission";
import type { ExtensionPackageAdmission } from "../manifest-adapter";
import { type ExtensionCapabilityDisclosure } from "./disclosure";
import { fetchExtensionSource, type ExtensionSourceRequest, type StagedExtensionSource } from "./source";
import { type TrustVerdict } from "./trust-admission";

export type ExtensionSourceFetcher = typeof fetchExtensionSource;

export type ExtensionAffectedApp = Readonly<{
  appId: string;
  appGenerationId: string;
}>;

export type ExtensionAppMigrationPort = Readonly<{
  /** Include every retained generation: an App may still depend on an older update. */
  boundApps(
    refs: readonly ExtensionPackageGenerationRef[]
  ): readonly ExtensionAffectedApp[];
  /** 为该 App 幂等起新 pending 代；migrationId 稳定且可重放。 */
  migrate(appId: string, migrationId: string): Promise<void>;
}>;

export type ExtensionCapabilityDiff = Readonly<{
  previousGenerationId: string;
  added: readonly string[];
  removed: readonly string[];
  requiresReauthorization: boolean;
}>;

export type ExtensionInstallPreflight = Readonly<{
  preflightId: string;
  contentDigest: Sha256Digest;
  installIdentity: string;
  scope: ProductResourceScope;
  sourceIdentity: string;
  projectLifecycleRevision: number | null;
  scopeRevision: number;
  componentNamespace: string;
  adapterId: ExtensionAdapterId;
  source: StagedExtensionSource["provenance"];
  admission: ExtensionPackageAdmission;
  disclosure: ExtensionCapabilityDisclosure;
  files: StagedExtensionSource["files"];
  /** null = 首装；非 null 即同一 install identity 的新一代 */
  capabilityDiff: ExtensionCapabilityDiff | null;
  affectedApps: readonly ExtensionAffectedApp[];
  /** A host package's verdict: trusted or local confirmation (a refusal never reaches a preflight); null for the other families. */
  trust: TrustVerdict | null;
}>;

export type HeldPreflight = ExtensionInstallPreflight & {
  packageRoot: string;
  operationId: string;
  evidence: ExtensionAdmission;
  expectedActiveGenerationRef: ExtensionPackageGenerationRef | null;
  signature: StagedExtensionSource["signature"];
};

export type ExtensionInstallRequest = ExtensionSourceRequest & Readonly<{
  scope: ProductResourceScope;
  expectedProjectLifecycleRevision: number | null;
  expectedScopeRevision: number;
}>;
