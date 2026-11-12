/**
 * [INPUT]: Stable Widget identities, unified package descriptors, platform targets and Zod.
 * [OUTPUT]: Bounded catalog metadata, installation requests and card context shared by the desktop and Widget builder.
 * [POS]: Official Widget distribution contract. A catalog declaration carries no runtime authority.
 */
import { z } from "zod";
import { pluginDigestSchema, unifiedPluginTargetSchema } from "@bottega/contracts/plugins/platform";

export const OFFICIAL_WIDGETS = {
  "bottega-weather": { contributionId: "current", dataContract: "weather-v1", recoveryVersion: "1.0.1" },
  "bottega-ai-usage": { contributionId: "today", dataContract: "usage-v1", recoveryVersion: "1.0.0" },
} as const;
export type OfficialWidgetId = keyof typeof OFFICIAL_WIDGETS;
export const officialWidgetId = z.enum(["bottega-weather", "bottega-ai-usage"]);
export const isOfficialWidgetId = (id: string): id is OfficialWidgetId => officialWidgetId.safeParse(id).success;

export const WIDGET_CATALOG_LIMITS = {
  catalog: 1024 * 1024,
  archive: 32 * 1024 * 1024,
  preview: 512 * 1024,
};
const version = z.string().regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
export function compareWidgetVersions(a: string, b: string) {
  const first = version.parse(a).split(".").map(Number);
  const second = version.parse(b).split(".").map(Number);
  return first[0]! - second[0]! || first[1]! - second[1]! || first[2]! - second[2]!;
}
const asset = (limit: number) => z.object({
  url: z.string().min(1).max(2048),
  bytes: z.number().int().positive().max(limit),
  sha256: pluginDigestSchema,
}).strict();
const localized = (limit: number) => {
  const value = z.string().min(1).max(limit);
  return z.object({ en: value, "zh-CN": value, ja: value, fr: value, es: value }).strict();
};
export const widgetReleaseSchema = z.object({
  version, revisionId: pluginDigestSchema, packageDigest: pluginDigestSchema,
  minBottegaVersion: version, target: unifiedPluginTargetSchema,
  dataContract: z.enum(["weather-v1", "usage-v1"]),
  contributionIds: z.array(z.enum(["current", "today"])).length(1),
  archive: asset(WIDGET_CATALOG_LIMITS.archive),
}).strict();
export type WidgetRelease = z.infer<typeof widgetReleaseSchema>;
export const widgetDirectorySchema = z.object({
  format: z.literal("bottega-widget-catalog/v1"),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  packages: z.array(z.object({
    pluginId: officialWidgetId, publisherId: z.literal("bottega"),
    releases: z.array(widgetReleaseSchema).min(1).max(32),
  }).strict()).max(2),
  widgets: z.array(z.object({
    pluginId: officialWidgetId, contributionId: z.enum(["current", "today"]),
    name: localized(160), description: localized(512),
    preview: asset(WIDGET_CATALOG_LIMITS.preview).extend({ format: z.enum(["png", "webp"]) }),
  }).strict()).max(2),
}).strict().superRefine((catalog, context) => {
  const invalid = () => context.addIssue({ code: "custom", message: "Widget catalog identities conflict" });
  const packages = new Set(catalog.packages.map(value => value.pluginId));
  const widgets = new Set(catalog.widgets.map(value => value.pluginId));
  if (packages.size !== catalog.packages.length || widgets.size !== catalog.widgets.length ||
      packages.size !== widgets.size || [...widgets].some(id => !packages.has(id))) invalid();
  for (const widget of catalog.widgets) {
    if (widget.contributionId !== OFFICIAL_WIDGETS[widget.pluginId].contributionId) invalid();
  }
  for (const value of catalog.packages) {
    const keys = value.releases.map(release => JSON.stringify([release.version, release.target]));
    if (new Set(keys).size !== keys.length) invalid();
  }
});
export type WidgetDirectory = z.infer<typeof widgetDirectorySchema>;

export type WidgetDirectoryRow = Readonly<{
  pluginId: OfficialWidgetId;
  name: string;
  description: string;
  preview: string | null;
  status: "install" | "installed" | "update" | "repair" | "incompatible";
  installedVersion: string | null;
  version: string | null;
  reason?: "version" | "runtime" | "contract";
  minimum?: string;
}>;
export type WidgetDirectorySnapshot = Readonly<{
  state: "ready" | "unavailable";
  version: number | null;
  recovery?: readonly OfficialWidgetId[];
  rows: readonly WidgetDirectoryRow[];
}>;
export type WidgetInstallProgress = Readonly<{
  state: "downloading" | "verifying" | "installing" | "ready" | "failed" | "cancelled";
  bytes: number;
  total: number;
  error?: "download" | "verification" | "install";
}>;
const operationId = z.string().uuid();
export const widgetDirectoryRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("browse"), cached: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("review"), pluginId: officialWidgetId, itemId: z.string().min(8).max(128).optional() }).strict(),
  z.object({ kind: z.literal("accept"), reviewId: operationId }).strict(),
  z.object({ kind: z.literal("progress"), reviewId: operationId }).strict(),
  z.object({ kind: z.literal("cancel"), reviewId: operationId }).strict(),
  z.object({ kind: z.literal("repair"), pluginId: officialWidgetId }).strict(),
]);
export type WidgetDirectoryRequest = z.infer<typeof widgetDirectoryRequestSchema>;
export type WidgetDirectoryResponse =
  | { kind: "browse"; directory: WidgetDirectorySnapshot }
  | { kind: "review"; reviewId: string }
  | { kind: "repair"; repaired: boolean }
  | { kind: "progress"; progress: WidgetInstallProgress };

export type WidgetCardPresentation = Readonly<{
  view: "card" | "detail";
  size: "small" | "medium" | "large";
  edge: "bottom" | "left" | "right";
  locale: string;
}>;
