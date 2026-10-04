/**
 * [INPUT]: Depends on packaged/generated App GUI toolchain manifest and gate-specific slice/SBOM/NOTICE bytes
 * [OUTPUT]: Provides verified gate-specific receipt digests and bounded, exact-identity Sketch and plugin SDK resources loaded only on demand
 * [POS]: gui-build/pipeline release-metadata join; compiler receipts cannot invent parallel metadata identities
 */

import { existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { APP_GUI_BUILD_BUDGET } from "../contracts";
import { PLUGIN_SKETCH_SOURCE_DIGEST, PLUGIN_SDK_SOURCE_DIGEST } from "../metadata";
import type { AppGuiAdmissionGate } from "../admission";
import { canonicalDigest, sha256 } from "../../support";

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


export type SketchModule = Readonly<{ runtime: string; styles: string; types: string }>;
export type PluginModule = Readonly<{ runtime: string; bootstrap: string; types: string }>;
const PRODUCT_MODULES = {
  sketch: { path: "modules/sketch.json", digest: PLUGIN_SKETCH_SOURCE_DIGEST, fields: ["runtime", "types", "styles"], schema: "bottega.sketch-module/v1" },
  plugin: { path: "modules/plugin.json", digest: PLUGIN_SDK_SOURCE_DIGEST, fields: ["runtime", "types", "bootstrap"], schema: "bottega.plugin-module/v1" },
} as const;
export const loadSketchModule = async (): Promise<SketchModule> => await loadProductModule("sketch") as SketchModule;
export const loadPluginModule = async (): Promise<PluginModule> => await loadProductModule("plugin") as PluginModule;
async function loadProductModule(name: keyof typeof PRODUCT_MODULES): Promise<Record<string, string>> {
  const root = metadataRoot(), contract = PRODUCT_MODULES[name];
  const manifest = JSON.parse(await readFile(join(root, "toolchain-manifest.json"), "utf8"));
  const expected = manifest.productModules?.[name];
  if (expected?.path !== contract.path) throw new Error("Product module resource manifest is unavailable");
  const file = await open(join(root, contract.path), "r");
  let bytes: Buffer;
  try {
    const info = await file.stat();
    const limit = APP_GUI_BUILD_BUDGET.generatedJsBytes + APP_GUI_BUILD_BUDGET.generatedCssBytes + 256 * 1024;
    if (!info.isFile() || info.size <= 0 || info.size > limit) throw new Error("Product module resource exceeds its fixed budget");
    const buffer = Buffer.alloc(info.size + 1); let offset = 0;
    while (offset < buffer.length) { const read = await file.read(buffer, offset, buffer.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
    if (offset !== info.size) throw new Error("Product module resource changed during its bounded read");
    bytes = buffer.subarray(0, offset);
  } finally { await file.close(); }
  if (sha256(bytes) !== expected.sha256) throw new Error("Product module resource digest differs from its toolchain manifest");
  const item = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  const fields: readonly string[] = contract.fields;
  if (!item || Object.keys(item).sort().join(",") !== [...fields, "schema", "sourceDigest"].sort().join(",") || item.schema !== contract.schema ||
      fields.some(field => typeof item[field] !== "string" || !item[field] || Buffer.byteLength(item[field] as string) >
        (field === "types" ? 64 * 1024 : field === "styles" ? APP_GUI_BUILD_BUDGET.generatedCssBytes : APP_GUI_BUILD_BUDGET.generatedJsBytes)) ||
      expected.sourceDigest !== contract.digest || item.sourceDigest !== contract.digest || sha256(Buffer.from(fields.map(field => item[field]).join(""))) !== contract.digest) {
    throw new Error("Product module resource identity differs from the fixed compiler snapshot");
  }
  return Object.fromEntries(fields.map(field => [field, item[field] as string]));
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
