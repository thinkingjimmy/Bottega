/**
 * [INPUT]: First-party Widget manifests, a shared surface entry, and the unified plugin compiler.
 * [OUTPUT]: Four immutable, offline Widget distributions with verified package descriptors.
 * [POS]: Build-time assembler shared by local and packaged macOS builds.
 */
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unifiedPluginManifestSchema, unifiedPluginDistributionSchema, unifiedPluginRevisionId } from "@bottega/contracts/plugins/platform";
import { compileUnifiedPlugin } from "../../electron/main/plugins/engineering/compiler/kernel";
import { inventoryPluginTree, pluginHash, pluginBytesHash } from "../../electron/main/plugins/engineering/snapshot";
import { OFFICIAL_WIDGETS, officialWidgetIds } from "../../shared/system-dock/widgets/catalog/official";
import { validateOfficialWidgetManifest } from "../../shared/system-dock/widgets/catalog/manifest";

export async function buildBundledWidgets(desktop: string, watch: (path: string) => void, emit: (path: string, bytes: Buffer) => void) {
  const resources = resolve(desktop, "resources/plugins/bundled");
  const entry = join(resources, "host-card.js");
  watch(entry);
  const card = await readFile(entry);
  for (const id of officialWidgetIds) {
    const { directory } = OFFICIAL_WIDGETS[id];
    const declaration = join(resources, directory + ".json");
    watch(declaration);
    const manifest = unifiedPluginManifestSchema.parse(JSON.parse(await readFile(declaration, "utf8")));
    if (manifest.id !== id) throw new Error("Bundled Widget identity differs from its build directory");
    const widget = validateOfficialWidgetManifest(manifest, true);
    const stage = await realpath(await mkdtemp(join(tmpdir(), "bottega-widget-bundle-")));
    try {
      const source = join(stage, "source"), output = join(stage, "output");
      await mkdir(source);
      await writeFile(join(source, widget.entry), card);
      const compiled = await compileUnifiedPlugin({ sourceRoot: source, outputRoot: output, manifest });
      await writeFile(join(output, "bottega.plugin.json"), JSON.stringify(compiled.manifest) + "\n");
      const files = (await inventoryPluginTree(output)).map(file => ({
        ...file, role: file.path.startsWith("runtime/ui/") ? "runtime" as const : "metadata" as const,
      }));
      const identity = {
        pluginId: id, sourceDigest: pluginHash([]), manifestDigest: pluginHash(compiled.manifest),
        lockDigest: pluginBytesHash(Buffer.alloc(0)), dependencyDigest: pluginHash([]),
        toolchainDigest: pluginHash({ compiler: "bundled-widgets/v1", node: 24 }), contentDigest: pluginHash(files),
        target: { platform: "darwin" as const, arch: process.arch as "arm64" | "x64", nodeMajor: 24, sdkVersion: 1 as const },
        dataContract: manifest.dataContract,
      };
      const descriptor = unifiedPluginDistributionSchema.parse({
        format: "bottega-plugin/v1", schemaVersion: 1, ...identity,
        revisionId: unifiedPluginRevisionId(identity), manifest: compiled.manifest, files,
      });
      await writeFile(join(output, "plugin-package.json"), JSON.stringify(descriptor) + "\n");
      for (const file of await inventoryPluginTree(output)) {
        emit("official-plugins/" + directory + "/" + file.path, await readFile(join(output, file.path)));
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
}
