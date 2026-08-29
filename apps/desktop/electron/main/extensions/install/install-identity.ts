/**
 * [INPUT]: Depends on canonical Registry digest, resource-scope keys, staged source provenance, and admitted manifests
 * [OUTPUT]: Provides install/source identities, component namespaces, display labels, adapter validation, and migration IDs
 * [POS]: Pure identity policy shared by Extension install preflight and durable replay
 */

import type { ProductResourceScope } from "../../../../shared/product-resource-scope";
import { productResourceScopeKey } from "../../../../shared/product-resource-scope";
import type { ExtensionAdapterId } from "../admission";
import { digestCanonical } from "../registry-store";
import type { ExtensionPackageAdmission } from "../manifest-adapter";
import type { StagedExtensionSource } from "./source";

export function migrationId(operationId: string, appId: string) {
  return `extension-migration:${operationId}:${appId}`;
}

export function asAdapterId(value: string): ExtensionAdapterId {
  if (value === "agent-plugins-1.0.0" || value === "skill-repo-1.0.0") return value;
  throw new Error(`未知 extension adapter：${value}`);
}

export function displayNameOf(
  admission: ExtensionPackageAdmission,
  source: StagedExtensionSource["provenance"]
) {
  const manifestName = admission.manifest.name;
  if (typeof manifestName === "string" && manifestName.trim()) return manifestName;
  const skill = admission.components.find((item) => item.kind === "skill");
  if (skill?.kind === "skill") return skill.name;
  return source.normalizedUrl.replace(/\/$/, "").split("/").at(-1)!.replace(/\.git$/, "");
}

export function sourceIdentityOf(source: StagedExtensionSource["provenance"]) {
  return digestCanonical([source.normalizedUrl, source.subdirectory]);
}

export function installIdentityOf(
  scope: ProductResourceScope,
  source: StagedExtensionSource["provenance"]
) {
  return digestCanonical([
    productResourceScopeKey(scope),
    source.normalizedUrl,
    source.subdirectory,
  ]);
}

export function namespaceOf(source: StagedExtensionSource["provenance"]) {
  const path = source.normalizedUrl.replace(/^https:\/\//, "");
  return source.subdirectory ? `${path}/${source.subdirectory}` : path;
}
