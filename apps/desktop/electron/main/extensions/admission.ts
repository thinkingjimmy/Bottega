/**
 * [INPUT]: Depends on the two frozen adapters (Agent Plugins, skill-repo), source provenance, and the pinned conformance corpus
 * [OUTPUT]: Provides admitExtensionPackageWithAdapter with the full evidence triad (admission, schema digest, validator fixture digest), ExtensionAdapterId, and VALIDATOR_FIXTURE_DIGEST
 * [POS]: The only admission dispatch point for extensions; every adapter is selected by explicit id, never guessed from package contents
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
import { digestCanonical } from "./registry-canonical";
import type { ExtensionSourceProvenance } from "./registry-schema";
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
