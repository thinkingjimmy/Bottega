/**
 * [INPUT]: Depends on packaged/generated App GUI toolchain manifest and gate-specific slice/SBOM/NOTICE bytes
 * [OUTPUT]: Provides verified gate-specific real-byte receipt digests for one admitted gate set
 * [POS]: gui-build/pipeline release-metadata join; compiler receipts cannot invent parallel metadata identities
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AppGuiAdmissionGate } from "../admission";
import { canonicalDigest, sha256 } from "../metadata";

export async function loadReceiptMetadata(gates: readonly AppGuiAdmissionGate[]) {
  const root = metadataRoot();
  const manifestBytes = await readFile(join(root, "toolchain-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
  const sliceDigests = manifest.sliceDigests as Record<string, unknown> | undefined;
  if (manifest.schema !== "bottega.app-gui-toolchain/v1" || !sliceDigests) {
    throw new Error("App GUI toolchain manifest is invalid");
  }
  const evidence = [];
  for (const gate of [...gates].sort()) {
    const [sliceBytes, sbomBytes, noticesBytes] = await Promise.all([
      readFile(join(root, "slices", `${gate}.json`)),
      readFile(join(root, "slices", `${gate}.sbom.cdx.json`)),
      readFile(join(root, "slices", `${gate}.NOTICE.txt`)),
    ]);
    const slice = JSON.parse(sliceBytes.toString("utf8"));
    if (canonicalDigest(slice) !== sliceDigests[gate]) {
      throw new Error(`App GUI ${gate} slice differs from the toolchain manifest`);
    }
    if (sha256(sbomBytes) !== slice.runtimeSbomDigest || sha256(noticesBytes) !== slice.noticesDigest) {
      throw new Error(`App GUI ${gate} release metadata differs from its slice`);
    }
    evidence.push({
      gate,
      sliceDigest: canonicalDigest(slice),
      sbomDigest: sha256(sbomBytes),
      noticesDigest: sha256(noticesBytes),
    });
  }
  return {
    transformManifestDigest: canonicalDigest({
      schema: "bottega.app-gui-transform-slice-set/v1",
      evidence: evidence.map(({ gate, sliceDigest }) => ({ gate, sliceDigest })),
    }),
    runtimeSbomSliceDigest: canonicalDigest({ schema: "bottega.app-gui-sbom-set/v1", evidence: evidence.map(({ gate, sbomDigest }) => ({ gate, sbomDigest })) }),
    runtimeNoticesSliceDigest: canonicalDigest({ schema: "bottega.app-gui-notice-set/v1", evidence: evidence.map(({ gate, noticesDigest }) => ({ gate, noticesDigest })) }),
  } as const;
}

function metadataRoot() {
  const explicit = process.env.BOTTEGA_APP_GUI_METADATA_ROOT;
  if (explicit) {
    if (!existsSync(join(explicit, "toolchain-manifest.json"))) {
      throw new Error("Explicit App GUI release metadata is unavailable");
    }
    return explicit;
  }
  const resourcesPath = typeof process.resourcesPath === "string"
    ? process.resourcesPath
    : "";
  const candidates = [
    resourcesPath && join(resourcesPath, "app-gui-toolchain"),
    resolve(process.cwd(), "resources/app-gui-toolchain"),
    resolve(process.cwd(), "apps/desktop/resources/app-gui-toolchain"),
    resolve(__dirname, "../../../../../resources/app-gui-toolchain"),
    resolve(__dirname, "../../resources/app-gui-toolchain"),
  ].filter(Boolean);
  const root = candidates.find((candidate) =>
    existsSync(join(candidate, "toolchain-manifest.json"))
  );
  if (!root) throw new Error("App GUI release metadata is unavailable");
  return root;
}
