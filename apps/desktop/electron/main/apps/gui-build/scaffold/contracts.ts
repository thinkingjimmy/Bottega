/**
 * [INPUT]: Depends on Zod and SHA-256/path-bounded App GUI component metadata
 * [OUTPUT]: Provides strict component catalog, author mirror, origin manifest, and scaffold result contracts
 * [POS]: gui-build/scaffold validation leaf shared by the transactional scaffolder and tests
 */

import { z } from "zod";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as `sha256:${string}`);
const componentId = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
const relativeFile = z.string().regex(/^[a-z0-9][a-z0-9./-]{0,239}$/).refine((value) => !value.includes(".."));

export const componentCatalogSchema = z.object({
  schema: z.literal("bottega.app-gui-component-snapshot/v1"),
  snapshotDigest: digest,
  compatibleOriginSnapshots: z.array(digest).max(16),
  components: z.array(z.object({
    id: componentId,
    sourcePath: relativeFile,
    targetPath: z.string().regex(/^gui\/src\/components\/ui\/[a-z0-9-]+\.tsx$/),
    sha256: digest,
    license: z.literal("MIT"),
    exports: z.array(z.string().regex(/^[A-Z][A-Za-z0-9]*$/)).min(1).max(16),
  }).strict()).min(1).max(32),
}).strict();

export const componentAuthorMirrorSchema = z.object({
  schemaVersion: z.literal(1),
  primitives: z.literal("base-ui"),
  iconLibrary: z.enum(["lucide", "phosphor"]),
  aliases: z.object({
    components: z.literal("@/components"),
    lib: z.literal("@/lib"),
    ui: z.literal("@/components/ui"),
  }).strict(),
  components: z.array(componentId).max(32).default([]),
}).strict();

export const componentOriginEntrySchema = z.object({
  componentId,
  path: z.string().regex(/^gui\/src\/components\/ui\/[a-z0-9-]+\.tsx$/),
  originSnapshotDigest: digest,
  originFileDigest: digest,
  originBlobPath: z.string().regex(/^gui\/\.bottega\/origin-blobs\/sha256\/[a-f0-9]{64}$/),
}).strict();

export const componentOriginsSchema = z.object({
  schemaVersion: z.literal(1),
  componentSnapshotDigest: digest,
  files: z.array(componentOriginEntrySchema).max(32),
}).strict();

export type ComponentCatalog = z.infer<typeof componentCatalogSchema>;
export type ComponentOrigins = z.infer<typeof componentOriginsSchema>;
export type ComponentScaffoldConflict = Readonly<{
  componentId: string;
  reason: "unknown-component" | "unknown-origin" | "untracked-target" | "missing-base" | "concurrent-edits";
  baseDigest: `sha256:${string}` | null;
  currentDigest: `sha256:${string}` | null;
  upstreamDigest: `sha256:${string}` | null;
  diff: string;
}>;
export type ComponentScaffoldResult =
  | Readonly<{
      status: "ready";
      added: readonly string[];
      updated: readonly string[];
      retained: readonly string[];
      /** 从 components.json 移除的组件：origins 条目与 origin blob 一起消失，源码保留。 */
      removed: readonly string[];
    }>
  | Readonly<{ status: "conflict"; conflicts: readonly ComponentScaffoldConflict[] }>;
