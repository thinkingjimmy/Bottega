/**
 * [INPUT]: Dock item projections, edge preferences, Zod and existing plugin surface requests.
 * [OUTPUT]: WidgetCatalogSnapshot with per-window live card assignments and bounded visibility requests for existing instances and host-owned defaults.
 * [POS]: Main-window read-only catalog presentation contract; it grants no layout mutation or source ownership.
 */
import { z } from "zod";
import type { DockBarItem } from "../../ipc";
import type { DockEdge } from "../../local-state";
export type WidgetCatalogSnapshot = Readonly<{
  revision: number;
  edge: DockEdge;
  privacyMask: boolean;
  officialDirectory?: boolean;
  liveCards: readonly string[];
  items: readonly DockBarItem[];
  defaults: readonly Readonly<{ definitionId: string; item: DockBarItem }>[];
}>;
export const widgetCatalogVisibilitySchema = z.object({
  itemIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)).max(100),
}).strict();
