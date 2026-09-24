/**
 * [INPUT]: Depends on zod, the canonical Agent backend schema, and the local usage source identities.
 * [OUTPUT]: Provides the portable DockLayout schema (native/Bottega App, system entry, two built-in Widget kinds), budgets, identity helpers, the item category projection, and the first-run default layout builder.
 * [POS]: shared/system-dock data model; the only shape that may enter the account-config dock-layout ciphertext. Machine facts (paths, PIDs, permissions, mode, displays) never live here.
 */

import { z } from "zod";
import { agentBackendIdSchema } from "../agent-schema";
import { USAGE_QUERY_TARGETS } from "../usage-ipc";

export const DOCK_LAYOUT_SCHEMA_VERSION = 1;
export const DOCK_LAYOUT_BUDGET = { items: 100, itemBytes: 8 * 1024, labelChars: 256 } as const;
export const SYSTEM_ENTRIES = ["system.finder", "system.downloads", "system.trash"] as const;
export type SystemEntryId = (typeof SYSTEM_ENTRIES)[number];

const id = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const label = z.string().max(DOCK_LAYOUT_BUDGET.labelChars).nullable();
/* A locally resolvable reference only means something on the installation that minted it (INV-05/06). */
export const localAppRefSchema = z.object({ originInstallationId: z.string().min(1).max(128), localRef: z.string().min(1).max(512) }).strict();
const nativeAppSchema = z.object({ id, kind: z.literal("native-app"), platform: z.literal("darwin"),
  bundleIdentifier: z.string().min(1).max(255).nullable(), localApp: localAppRefSchema.nullable(), label }).strict()
  .refine((item) => item.bundleIdentifier !== null || item.localApp !== null, { message: "native App needs a bundle identifier or an installation reference" });
const bottegaAppSchema = z.object({ id, kind: z.literal("bottega-app"), appId: z.string().min(1).max(256).nullable(),
  localApp: localAppRefSchema.nullable(), label }).strict()
  .refine((item) => item.appId !== null || item.localApp !== null, { message: "Bottega App needs a portable identity or an installation reference" });
const systemEntrySchema = z.object({ id, kind: z.literal("system"), entry: z.enum(SYSTEM_ENTRIES) }).strict();
const poolSelectionSchema = z.object({ poolId: z.string().min(1).max(256).nullable(), windowId: z.string().min(1).max(256).nullable() }).strict();
export const aiLimitsWidgetSchema = z.object({ type: z.literal("builtin.ai-limits"), configVersion: z.literal(1), standard: z.literal("compact"),
  selectedBackends: z.array(agentBackendIdSchema).max(16), selectionByBackend: z.partialRecord(agentBackendIdSchema, poolSelectionSchema) }).strict()
  .refine((value) => new Set(value.selectedBackends).size === value.selectedBackends.length, { message: "duplicate backend" });
export const aiActivityWidgetSchema = z.object({ type: z.literal("builtin.ai-activity"), configVersion: z.literal(1), standard: z.literal("compact"),
  source: z.enum(USAGE_QUERY_TARGETS), period: z.literal("today") }).strict();
const widgetSchema = z.object({ id, kind: z.literal("widget"), widget: z.union([aiLimitsWidgetSchema, aiActivityWidgetSchema]) }).strict();
export const dockItemSchema = z.union([nativeAppSchema, bottegaAppSchema, systemEntrySchema, widgetSchema]);
export const dockLayoutSchema = z.object({ schemaVersion: z.literal(DOCK_LAYOUT_SCHEMA_VERSION), initialized: z.boolean(),
  items: z.array(dockItemSchema).max(DOCK_LAYOUT_BUDGET.items), order: z.array(id).max(DOCK_LAYOUT_BUDGET.items) }).strict()
  .superRefine((layout, context) => {
    const ids = layout.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "duplicate item id" });
    if (layout.order.length !== ids.length || new Set(layout.order).size !== layout.order.length || layout.order.some((value) => !ids.includes(value)))
      context.addIssue({ code: "custom", message: "order must be a permutation of item ids" });
    const entries = layout.items.flatMap((item) => item.kind === "system" ? [item.entry] : []);
    if (new Set(entries).size !== entries.length) context.addIssue({ code: "custom", message: "system entries are singletons" });
    for (const item of layout.items) if (new TextEncoder().encode(JSON.stringify(item)).length > DOCK_LAYOUT_BUDGET.itemBytes)
      context.addIssue({ code: "custom", message: "item exceeds the per-item budget" });
    if (!layout.initialized && layout.items.length) context.addIssue({ code: "custom", message: "an uninitialized layout is empty" });
  });

export type LocalAppRef = z.infer<typeof localAppRefSchema>;
export type DockItem = z.infer<typeof dockItemSchema>;
export type DockLayout = z.infer<typeof dockLayoutSchema>;
export type AiLimitsWidget = z.infer<typeof aiLimitsWidgetSchema>;
export type AiActivityWidget = z.infer<typeof aiActivityWidgetSchema>;
export type DockWidget = AiLimitsWidget | AiActivityWidget;
export type DockItemCategory = "finder" | "app" | "trailing";
/** Draft item before an identity is minted. */
export type DockItemDraft = DockItem extends infer T ? T extends { id: string } ? Omit<T, "id"> : never : never;

export const UNINITIALIZED_LAYOUT: DockLayout = Object.freeze({ schemaVersion: 1, initialized: false, items: [], order: [] }) as DockLayout;

export function newDockItemId(random: () => string = () => crypto.randomUUID()): string {
  return random().replaceAll("-", "");
}
export function itemCategory(item: DockItem | DockItemDraft): DockItemCategory {
  if (item.kind === "system" && item.entry === "system.finder") return "finder";
  return item.kind === "native-app" || item.kind === "bottega-app" ? "app" : "trailing";
}
export function orderedItems(layout: DockLayout): DockItem[] {
  const byId = new Map(layout.items.map((item) => [item.id, item]));
  return layout.order.flatMap((itemId) => byId.get(itemId) ?? []);
}
/** Semantic identity used to detect singletons and duplicate pins; never a display name. */
export function semanticKey(item: DockItem | DockItemDraft): string | null {
  if (item.kind === "system") return item.entry;
  if (item.kind === "native-app") return item.bundleIdentifier ? `native:${item.bundleIdentifier}` : item.localApp ? `native-local:${item.localApp.originInstallationId}:${item.localApp.localRef}` : null;
  if (item.kind === "bottega-app") return item.appId ? `bottega:${item.appId}` : item.localApp ? `bottega-local:${item.localApp.originInstallationId}:${item.localApp.localRef}` : null;
  return null;
}
export function defaultLimitsWidget(backends: readonly z.infer<typeof agentBackendIdSchema>[]): AiLimitsWidget {
  return { type: "builtin.ai-limits", configVersion: 1, standard: "compact", selectedBackends: [...backends], selectionByBackend: {} };
}
export function defaultActivityWidget(): AiActivityWidget {
  return { type: "builtin.ai-activity", configVersion: 1, standard: "compact", source: "all", period: "today" };
}
/**
 * First initialization only (INV-07): Finder, imported Apps in their system order, then AI limits, Downloads and Trash.
 * Callers never apply this to an existing or deliberately cleared layout.
 */
export function buildDefaultLayout(input: { apps: readonly DockItemDraft[]; limitsBackends: readonly z.infer<typeof agentBackendIdSchema>[]; mint?: () => string }): DockLayout {
  const mint = input.mint ?? (() => newDockItemId());
  const drafts: DockItemDraft[] = [{ kind: "system", entry: "system.finder" }, ...input.apps.filter((app) => itemCategory(app) === "app"),
    { kind: "widget", widget: defaultLimitsWidget(input.limitsBackends) }, { kind: "system", entry: "system.downloads" }, { kind: "system", entry: "system.trash" }];
  const seen = new Set<string>();
  const items = drafts.flatMap((draft) => {
    const key = semanticKey(draft);
    if (key) { if (seen.has(key)) return []; seen.add(key); }
    return [{ ...draft, id: mint() } as DockItem];
  });
  return dockLayoutSchema.parse({ schemaVersion: 1, initialized: true, items, order: items.map((item) => item.id) });
}
export function parseDockLayout(value: unknown): { ok: true; layout: DockLayout } | { ok: false } {
  const result = dockLayoutSchema.safeParse(value);
  return result.success ? { ok: true, layout: result.data } : { ok: false };
}
