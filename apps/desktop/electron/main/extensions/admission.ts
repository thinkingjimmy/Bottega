/**
 * [INPUT]: Depends on two controlled adapters, source provenance and nail-dead conformance feed
 * [OUTPUT]: Provides admitAnyExtensionPackage/admitExtensionPackageWithAdapter with full evidence triad
 * [POS]: The only dispatch registry for extensions admission; The adapter is the only adapter that is not backed up
 */

import type { Sha256Digest } from "../../../shared/extensions-ipc";
import { ADMISSION_CONFORMANCE_CORPUS } from "./conformance/fixtures";
import {
  AGENT_PLUGIN_ADAPTER_ID,
  AGENT_PLUGIN_MCP_SCHEMA_1_0_0,
  AGENT_PLUGIN_SCHEMA_1_0_0,
  admitExtensionPackage,
  type ExtensionPackageAdmission,
} from "./manifest-adapter";
import { digestCanonical, type ExtensionSourceProvenance } from "./registry-store";
import {
  admitSkillRepoPackage,
  SKILL_REPO_ADAPTER_ID,
  SKILL_REPO_SCHEMA_ID,
} from "./skill-repo-adapter";

export type ExtensionAdapterId =
  | typeof AGENT_PLUGIN_ADAPTER_ID
  | typeof SKILL_REPO_ADAPTER_ID;

export type ExtensionAdmission = Readonly<{
  admission: ExtensionPackageAdmission;
  adapterId: ExtensionAdapterId;
  schemaDigest: Sha256Digest;
  validatorFixtureDigest: Sha256Digest;
}>;

export const VALIDATOR_FIXTURE_DIGEST = digestCanonical(
  ADMISSION_CONFORMANCE_CORPUS
);

export async function admitAnyExtensionPackage(
  root: string,
  source: ExtensionSourceProvenance,
  adapterId: ExtensionAdapterId
): Promise<ExtensionAdmission> {
  return admitExtensionPackageWithAdapter(adapterId, root, source);
}

export async function admitExtensionPackageWithAdapter(
  adapterId: ExtensionAdapterId,
  root: string,
  source: ExtensionSourceProvenance
): Promise<ExtensionAdmission> {
  const admission =
    adapterId === AGENT_PLUGIN_ADAPTER_ID
      ? await admitExtensionPackage(root)
      : await admitSkillRepoPackage(root, source);
  const schemaDigest = digestCanonical(
    adapterId === AGENT_PLUGIN_ADAPTER_ID
      ? { plugin: AGENT_PLUGIN_SCHEMA_1_0_0, mcp: AGENT_PLUGIN_MCP_SCHEMA_1_0_0 }
      : SKILL_REPO_SCHEMA_ID
  );
  return { admission, adapterId, schemaDigest, validatorFixtureDigest: VALIDATOR_FIXTURE_DIGEST };
}
