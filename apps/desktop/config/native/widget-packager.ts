/**
 * [INPUT]: Dependency-free Widget source, pinned compiler inputs and an explicit Darwin ARM64 build target.
 * [OUTPUT]: A sealed bottega-plugin archive with deterministic package, revision and toolchain digests.
 * [POS]: Standalone official Widget packaging entry, reusing the production plugin compiler and archive codec.
 */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { unifiedPluginDistributionSchema, unifiedPluginManifestSchema, unifiedPluginRevisionId } from "@bottega/contracts/plugins/platform";
import { compileUnifiedPlugin } from "../../electron/main/plugins/engineering/compiler/kernel";
import { inventoryPluginTree, pluginBytesHash, pluginHash } from "../../electron/main/plugins/engineering/snapshot";
import { freezeCloudPluginPacket } from "../../electron/main/cloud/widgets/plugins/codec";
import { WIDGET_CATALOG_LIMITS } from "../../shared/system-dock/widgets/catalog/distribution";
import { validateOfficialWidgetManifest } from "../../shared/system-dock/widgets/catalog/manifest";

const require = createRequire(import.meta.url);
async function packageVersion(name: string): Promise<string> {
  let directory = dirname(require.resolve(name));
  while (directory !== dirname(directory)) {
    const manifest = await readFile(join(directory, "package.json"), "utf8").then(value => JSON.parse(value), () => null);
    if (manifest?.name === name) return manifest.version;
    directory = dirname(directory);
  }
  throw new Error("Compiler package metadata is missing: " + name);
}
const target = { platform: "darwin", arch: "arm64", nodeMajor: 24, sdkVersion: 1 } as const;
export async function buildWidgetArchive(input: { source: string; output: string; toolchainSourceDigest: string; lockfile: string }) {
  const source = await realpath(input.source);
  const manifest = unifiedPluginManifestSchema.parse(JSON.parse(await readFile(join(source, "bottega.plugin.json"), "utf8")));
  validateOfficialWidgetManifest(manifest);
  const stage = await realpath(await mkdtemp(join(tmpdir(), "bottega-widget-build-")));
  try {
    const frozen = join(stage, "frozen"), sealed = join(stage, "sealed");
    const sources = await inventoryPluginTree(source);
    if (sources.length > 64 || sources.reduce((sum, file) => sum + file.bytes, 0) > WIDGET_CATALOG_LIMITS.archive)
      throw new Error("Widget source exceeds its build budget");
    for (const file of sources) {
      const bytes = await readFile(join(source, file.path));
      if (pluginBytesHash(bytes) !== file.sha256) throw new Error("Widget source changed during build");
      await mkdir(dirname(join(frozen, file.path)), { recursive: true });
      await writeFile(join(frozen, file.path), bytes);
    }
    const compiled = await compileUnifiedPlugin({ sourceRoot: frozen, outputRoot: sealed, manifest });
    await writeFile(join(sealed, "bottega.plugin.json"), JSON.stringify(compiled.manifest) + "\n");
    const files = (await inventoryPluginTree(sealed)).map(file => ({
      ...file, role: file.path.startsWith("runtime/ui/") ? "runtime" as const : "metadata" as const,
    }));
    const identity = {
      pluginId: manifest.id, sourceDigest: pluginHash([]), manifestDigest: pluginHash(compiled.manifest),
      lockDigest: pluginBytesHash(Buffer.alloc(0)), dependencyDigest: pluginHash([]), contentDigest: pluginHash(files),
      toolchainDigest: pluginHash({
        source: input.toolchainSourceDigest, lock: pluginBytesHash(await readFile(input.lockfile)),
        esbuild: require("esbuild").version, tailwind: await packageVersion("@tailwindcss/node"), css: await packageVersion("tailwindcss"),
        oxide: await packageVersion("@tailwindcss/oxide"), node: process.version, target,
      }),
      target, dataContract: manifest.dataContract,
    };
    const distribution = unifiedPluginDistributionSchema.parse({
      ...identity, format: "bottega-plugin/v1", schemaVersion: 1, manifest: compiled.manifest,
      revisionId: unifiedPluginRevisionId(identity), files,
    });
    await writeFile(join(sealed, "plugin-package.json"), JSON.stringify(distribution) + "\n");
    const packet = await freezeCloudPluginPacket(sealed, target);
    await writeFile(input.output, packet.bytes, { flag: "wx" });
    return {
      pluginId: manifest.id, version: manifest.version, revisionId: distribution.revisionId, packageDigest: packet.reference,
      archiveSha256: pluginBytesHash(packet.bytes), bytes: packet.bytes.length, toolchainDigest: distribution.toolchainDigest,
      dataContract: distribution.dataContract, target, sourceDigest: pluginHash(sources),
      contributionIds: manifest.contributions.map(value => value.id),
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
