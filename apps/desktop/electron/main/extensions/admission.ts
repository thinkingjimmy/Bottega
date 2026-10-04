/**
 * [INPUT]: Depends on the three frozen adapters (Agent Plugins, skill-repo, Bottega host package), source provenance, and the pinned conformance corpus
 * [OUTPUT]: Provides admitExtensionPackageWithAdapter with the full evidence triad (admission, schema digest, validator fixture digest), ExtensionAdapterId, and VALIDATOR_FIXTURE_DIGEST
 * [POS]: The only admission dispatch point for extensions; every adapter is selected by explicit id, never guessed from package contents
 */

import type { Sha256Digest } from "../../../shared/ipc/settings/extensions-ipc";
import { ADMISSION_CONFORMANCE_CORPUS } from "./conformance/fixtures";
import {
  AGENT_PLUGIN_ADAPTER_ID,
  AGENT_PLUGIN_MCP_SCHEMA_1_0_0,
  AGENT_PLUGIN_SCHEMA_1_0_0,
  admitExtensionPackage,
  type ExtensionPackageAdmission,
} from "./manifest-adapter";
import { digestCanonical } from "./registry/registry-canonical";
import type { ExtensionSourceProvenance } from "./registry/registry-schema";
import {
  admitSkillRepoPackage,
  SKILL_REPO_ADAPTER_ID,
  SKILL_REPO_SCHEMA_ID,
} from "./skills/skill-repo-adapter";
import { admitHostPackage, HOST_PACKAGE_ADAPTER_ID, HOST_PACKAGE_SCHEMA_ID } from "./host/manifest";

function unknownAdapter(adapterId: never): never {
  throw new Error(`unknown extension adapter ${String(adapterId)}`);
}

export type ExtensionAdapterId =
  | typeof AGENT_PLUGIN_ADAPTER_ID
  | typeof SKILL_REPO_ADAPTER_ID
  | typeof HOST_PACKAGE_ADAPTER_ID;

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
  /* Exhaustive by id: a new family must be added here, never fall into another family's branch. */
  const admission =
    adapterId === AGENT_PLUGIN_ADAPTER_ID ? await admitExtensionPackage(root)
      : adapterId === SKILL_REPO_ADAPTER_ID ? await admitSkillRepoPackage(root, source)
        : adapterId === HOST_PACKAGE_ADAPTER_ID ? await admitHostPackage(root)
          : unknownAdapter(adapterId);
  const schemaDigest = digestCanonical(
    adapterId === AGENT_PLUGIN_ADAPTER_ID
      ? { plugin: AGENT_PLUGIN_SCHEMA_1_0_0, mcp: AGENT_PLUGIN_MCP_SCHEMA_1_0_0 }
      : adapterId === SKILL_REPO_ADAPTER_ID ? SKILL_REPO_SCHEMA_ID : HOST_PACKAGE_SCHEMA_ID
  );
  return { admission, adapterId, schemaDigest, validatorFixtureDigest: VALIDATOR_FIXTURE_DIGEST };
}
