/**
 * [INPUT]: Depends on strict schemas, canonical App manifests and the declared plugin operation catalog.
 * [OUTPUT]: Provides distinct plugin GUI manifests with required open/heartbeat admission and the immutable compiler manifest reader.
 * [POS]: GUI build source authority; a plugin never acquires App or Base identity by using the compiler.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PLUGIN_COMPOSER_OPERATIONS } from "@bottega/contracts/plugins/surface/contract";
import { APP_GUI_PRESET } from "../../../../../shared/app-gui/contracts";
import type { BaseAppManifest } from "../../../../../shared/ipc/apps/apps-ipc";
import { appManifestSchema } from "../../install/manifest-schema";
const identifier = z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/);
export const pluginGuiManifestSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("plugin"), id: identifier,
  name: z.string().min(1).max(120), summary: z.string().max(500), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  gui: z.object({entry: z.literal("gui/index.html"), capabilities: z.array(z.never()).max(0),
    build: z.object({preset: z.literal(APP_GUI_PRESET), entry: z.literal("src/main.tsx"), stylesheet: z.literal("src/styles.css"), iconLibrary: z.enum(["lucide", "phosphor"])}).strict()}).strict(),
  composer: z.object({id: identifier, title: z.string().min(1).max(80), icon: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)}).strict(),
  sourceFormat: z.object({id: identifier, version: z.number().int().positive(), readableVersions: z.array(z.number().int().positive()).min(1).max(64)}).strict(),
  operations: z.array(z.enum(PLUGIN_COMPOSER_OPERATIONS)).max(PLUGIN_COMPOSER_OPERATIONS.length).refine(value=>value.includes("plugin.open") && value.includes("plugin.heartbeat"), "Plugin bootstrap requires plugin.open and plugin.heartbeat"),
}).strict().superRefine((value, context) => {
  if (!value.sourceFormat.readableVersions.includes(value.sourceFormat.version)) context.addIssue({code:"custom",path:["sourceFormat"],message:"The writer must read its own source version"});
  if (new Set(value.operations).size !== value.operations.length) context.addIssue({code:"custom",path:["operations"],message:"Duplicate operation"});
});
export type PluginGuiManifest = z.infer<typeof pluginGuiManifestSchema>;
export type GuiBuildManifest = BaseAppManifest | PluginGuiManifest;
export type CompiledGuiBuildManifest = GuiBuildManifest & { gui: NonNullable<BaseAppManifest["gui"]> & { build: NonNullable<NonNullable<BaseAppManifest["gui"]>["build"]> } };
export const guiManifestFile = (manifest: GuiBuildManifest) => manifest.kind === "plugin" ? "plugin.json" : "app.json";
export async function readGuiBuildManifest(root: string): Promise<GuiBuildManifest> {
  const plugin = await readFile(join(root,"plugin.json"),"utf8").catch((error: NodeJS.ErrnoException) => {if(error.code === "ENOENT") return null; throw error;});
  if (plugin !== null) {
    const app = await readFile(join(root,"app.json")).catch((error:NodeJS.ErrnoException) => {if(error.code === "ENOENT") return null; throw error;});
    if(app) throw new Error("GUI source cannot declare both App and plugin identities");
    return pluginGuiManifestSchema.parse(JSON.parse(plugin));
  }
  const manifest = appManifestSchema.parse(JSON.parse(await readFile(join(root,"app.json"),"utf8")));
  if(manifest.kind !== "base") throw new Error("The compiled GUI requires an App or plugin GUI manifest");
  return manifest;
}
