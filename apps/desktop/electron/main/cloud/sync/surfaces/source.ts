/**
 * [INPUT]: The AppStore record and sealed generation artifacts, the compiled-v3 verifier and the Base GUI grant projection.
 * [OUTPUT]: SurfaceIntent (pending / none / unsupported / compiled with verified files and owner-granted capabilities) and appSurfaceSource(apps). Retires a disabled App GUI without deleting its retained generation.
 * [POS]: What the surface publisher may publish for an App right now; reads only sealed, re-verified bytes and never a manifest wish.
 */
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { APP_SURFACE_CAPABILITIES, type AppSurfaceManifest } from "@ai-chat/cloud-protocol/surfaces/manifest";
import type { PluginSurfaceDefinition } from "@ai-chat/cloud-protocol/surfaces/plugin/model";
import type { AppStore } from "../../../apps/store/app-store";
import { verifyCompiledV3Artifact } from "../../../apps/gui-build/pipeline/seal";

export type SurfaceFile = { path: string; mime: string; bytes: number; sha256: string; read(): Promise<Uint8Array> };
export type SurfaceIntent =
  | { kind: "pending" }                // no active generation yet (installing, rebuilding): publish nothing, retire nothing
  | { kind: "none" }                   // the active generation has no GUI
  | { kind: "unsupported" }            // a static (non-compiled) GUI
  | { kind: "compiled"; generationId: string; artifactDigest: string; files: SurfaceFile[];
      sdkSlice: AppSurfaceManifest["sdkSlice"]; grantedCapabilities: AppSurfaceManifest["grantedCapabilities"]; hostActions: string[]; plugin?: PluginSurfaceDefinition };
export type SurfaceSource = { intent(appId: string): Promise<SurfaceIntent> };
export type PluginSurfaceSource = SurfaceSource & { list(): readonly {id:string}[]; onChanged(listener:()=>void):()=>void; catalog(): import("@ai-chat/cloud-protocol/surfaces/plugin/catalog").RemotePluginCatalog };
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm" };
// Built-in navigation needs no grant; everything else must have been granted by the person on this computer.
const BUILT_IN_HOST_ACTIONS = new Set(["open-data", "open-data-view"]);

export function appSurfaceSource(apps: Pick<AppStore, "get" | "artifactRoot" | "baseGuiGrantProjection">,
  verify: (root: string) => Promise<Pick<Awaited<ReturnType<typeof verifyCompiledV3Artifact>>, "receipt">> = verifyCompiledV3Artifact): SurfaceSource {
  return {
    async intent(appId) {
      const record = apps.get(appId), active = record?.generationBinding.active;
      if (!record || !active) return { kind: "pending" };
      if (!record.enabled) return { kind: "none" };
      const generation = record.generations.find(item => item.generationId === active.generationId);
      if (!generation) return { kind: "pending" };
      if (record.manifest?.kind !== "base" || !record.manifest.gui) return { kind: "none" };
      if (generation.contentLayoutVersion !== 3 || !record.manifest.gui.build) return { kind: "unsupported" };
      const root = apps.artifactRoot(appId, generation.generationId), verified = await verify(root);
      const receipt = verified.receipt, compatibility = receipt.compatibility, grants = apps.baseGuiGrantProjection(appId, generation.generationId);
      const granted = new Set([...(grants?.hostActions ?? [])]);
      const required = compatibility.hostActions.kind === "none" ? [] : compatibility.hostActions.required;
      return {
        kind: "compiled", generationId: generation.generationId, artifactDigest: receipt.runtimeGuiDigest,
        files: receipt.files.map(file => ({ path: file.path, mime: MIME[extname(file.path).toLowerCase()] ?? "application/octet-stream", bytes: file.bytes, sha256: file.sha256,
          read: async () => new Uint8Array(await readFile(join(root, "runtime/gui", file.path))) })),
        sdkSlice: { data: compatibility.dataSdk.kind !== "none", preferences: compatibility.preferences.kind !== "none", workspace: compatibility.workspace.kind !== "none" },
        grantedCapabilities: (grants?.capabilities ?? []).filter((value): value is AppSurfaceManifest["grantedCapabilities"][number] =>
          (APP_SURFACE_CAPABILITIES as readonly string[]).includes(value)),
        hostActions: required.filter(action => BUILT_IN_HOST_ACTIONS.has(action) || granted.has(action as never)),
      };
    },
  };
}
