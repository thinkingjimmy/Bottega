/**
 * [INPUT]: Zod and the shared bounded document paths and digests.
 * [OUTPUT]: Closed token, alias, source, component and three-way update contracts.
 * [POS]: Design-system data shared by the main owner and desktop/Web readers.
 */
import { z } from "zod";
import { digestSchema, sourcePath } from "../model";

export const systemName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
export const tokenKindSchema = z.enum(["color", "font-family", "font-size", "line-height", "font-weight", "letter-spacing", "spacing", "radius", "shadow"]);
export const systemThemeSchema = z.object({ id: systemName.max(32), name: z.string().min(1).max(80) }).strict();
export const systemTokenSchema = z.object({ name: systemName, kind: tokenKindSchema,
  values: z.record(systemName.max(32), z.string().min(1).max(1000)), usage: z.string().max(1000),
  sourceId: systemName, sourceKey: z.string().min(1).max(240),
  origins: z.record(systemName.max(32), z.object({ sourceId: systemName, sourceKey: z.string().min(1).max(240) }).strict()),
  override: z.boolean().optional() }).strict();
export const systemAliasSchema = z.object({ name: systemName, target: systemName, theme: systemName.max(32),
  usage: z.string().max(1000), sourceId: systemName, sourceKey: z.string().min(1).max(240), override: z.boolean().optional() }).strict();
export const systemFontSchema = z.object({ family: z.string().min(1).max(200), file: sourcePath, sourceId: systemName,
  definitionSourceId: systemName, sourceKey: z.string().min(1).max(240),
  weight: z.string().max(40), style: z.enum(["normal", "italic", "oblique"]) }).strict();
export const systemTokensSchema = z.object({ schemaVersion: z.literal(1), themes: z.array(systemThemeSchema).min(1).max(8),
  tokens: z.array(systemTokenSchema).max(512), fonts: z.array(systemFontSchema).max(32) }).strict();
export const systemAliasesSchema = z.object({ schemaVersion: z.literal(1), aliases: z.array(systemAliasSchema).max(512) }).strict();
export const systemSourceSchema = z.object({ id: systemName, path: sourcePath, capturedPath: sourcePath, digest: digestSchema,
  bytes: z.number().int().nonnegative().max(8 * 1024 * 1024),
  version: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("git"), commit: z.string().regex(/^[a-f0-9]{40,64}$/), workingTree: z.boolean() }).strict(),
    z.object({ kind: z.literal("digest"), digest: digestSchema }).strict(),
  ]), retained: z.boolean().optional() }).strict();
export const systemUnsyncedSchema = z.object({ path: sourcePath, kind: z.enum(["token", "component", "font", "asset", "source", "usage"]),
  name: z.string().max(240).optional(), reason: z.string().min(1).max(500) }).strict();
export const systemComponentSchema = z.object({ name: systemName, exportName: z.string().regex(/^(?:default|[A-Z][A-Za-z0-9_]*)$/),
  sourceId: systemName, entry: sourcePath, sourceDigest: digestSchema, closureDigest: digestSchema, closure: z.array(sourcePath).min(1).max(52),
  mode: z.enum(["static", "mounted"]), reason: z.string().max(500),
  preview: sourcePath.optional(), bundle: sourcePath.optional(), bundleDigest: digestSchema.optional(),
  evidence: z.object({ file: sourcePath, digest: digestSchema, styleDigest: digestSchema, width: z.number().int().positive(), height: z.number().int().positive(),
    runtime: z.literal("react@19.2.4"), compiler: z.literal("esbuild@0.28.1") }).strict().optional(),
  override: z.boolean().optional() }).strict();
export const systemComponentsSchema = z.object({ schemaVersion: z.literal(1), components: z.array(systemComponentSchema).max(128) }).strict();
export const systemBaselineSchema = z.object({ tokens: z.array(systemTokenSchema).max(512), aliases: z.array(systemAliasSchema).max(512),
  components: z.array(systemComponentSchema).max(128) }).strict();
export const systemSourcesSchema = z.object({ schemaVersion: z.literal(1), files: z.array(systemSourceSchema).max(52),
  baseline: systemBaselineSchema, unsynced: z.array(systemUnsyncedSchema).max(1024),
  requestDigest: digestSchema.optional() }).strict();
export const designSystemSchema = z.object({ tokens: systemTokensSchema, aliases: systemAliasesSchema,
  sources: systemSourcesSchema, components: systemComponentsSchema }).strict();
export const systemOverrideSchema = z.object({ token: systemName, theme: systemName.max(32), value: z.string().min(1).max(1000),
  usage: z.string().max(1000).optional() }).strict();
export const systemCompileSchema = z.object({ component: systemName, props: z.record(z.string().max(80), z.unknown()).optional() }).strict();
export type SystemToken = z.infer<typeof systemTokenSchema>;
export type SystemAlias = z.infer<typeof systemAliasSchema>;
export type SystemSource = z.infer<typeof systemSourceSchema>;
export type SystemComponent = z.infer<typeof systemComponentSchema>;
export type SystemUnsynced = z.infer<typeof systemUnsyncedSchema>;
export type DesignSystem = z.infer<typeof designSystemSchema>;
export type SystemEntry = SystemToken | SystemAlias | SystemComponent;
export type SystemChange = { key: string; family: "token" | "alias" | "component";
  kind: "added" | "changed" | "removed" | "conflict"; base: SystemEntry | null; current: SystemEntry | null; incoming: SystemEntry | null;
  requiresDecision: boolean };
export type SystemDifference = { sourceDigest: string; changes: SystemChange[]; unsynced: SystemUnsynced[] };
