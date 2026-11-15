/**
 * [INPUT]: Browser localStorage, versioned layout data, and the desktop sidebar width bounds and preference parser.
 * [OUTPUT]: Provides sidebar layout types, width bounds, and synchronous layout persistence with optional saved width learning.
 * [POS]: apps/desktop/src/lib/navigation/sidebar; Renderer's persistence boundary for Sidebar layout; commits synchronously so no pending write is lost when the window closes
 */

import {
  EMPTY_SIDEBAR_WIDTH_PREFERENCE,
  parseSidebarWidthPreference,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type SidebarWidthPreference,
} from "./sidebar-width";

export { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH };

const SIDEBAR_DEFAULT_WIDTH = 256;

export type SidebarView = "library" | "activity";

export type SidebarGroups = {
  projects: boolean;
  bases: boolean;
  chats: boolean;
};

export type SidebarLayout = {
  open: boolean;
  width: number;
  widthPreference: SidebarWidthPreference;
  view: SidebarView;
  groups: SidebarGroups;
};

type StoredSidebarLayout = {
  version: 1;
  layout: SidebarLayout;
};

type SidebarStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "ai-chat.sidebar-layout.v1";

export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = {
  open: true,
  width: SIDEBAR_DEFAULT_WIDTH,
  widthPreference: EMPTY_SIDEBAR_WIDTH_PREFERENCE,
  view: "library",
  groups: { projects: true, bases: true, chats: true },
};

const defaultLayout = (): SidebarLayout => ({
  ...DEFAULT_SIDEBAR_LAYOUT,
  groups: { ...DEFAULT_SIDEBAR_LAYOUT.groups },
});

function clampWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function normalizeLayout(layout: SidebarLayout): SidebarLayout {
  return {
    open: layout.open,
    width: clampWidth(Math.round(layout.width)),
    widthPreference: layout.widthPreference,
    view: layout.view === "activity" ? "activity" : "library",
    groups: {
      projects:
        typeof layout.groups?.projects === "boolean"
          ? layout.groups.projects
          : true,
      bases:
        typeof layout.groups?.bases === "boolean" ? layout.groups.bases : true,
      chats:
        typeof layout.groups?.chats === "boolean" ? layout.groups.chats : true,
    },
  };
}

export function parseSidebarLayout(raw: string | null): SidebarLayout {
  if (!raw) return defaultLayout();

  try {
    const stored = JSON.parse(raw) as Partial<StoredSidebarLayout>;
    if (
      stored.version !== 1 ||
      typeof stored.layout?.open !== "boolean" ||
      typeof stored.layout.width !== "number" ||
      !Number.isFinite(stored.layout.width)
    ) {
      return defaultLayout();
    }
    const layout = stored.layout as SidebarLayout;
    return normalizeLayout({
      ...layout,
      widthPreference: parseSidebarWidthPreference(layout.widthPreference),
      view: layout.view === "activity" ? "activity" : "library",
      groups: layout.groups ?? DEFAULT_SIDEBAR_LAYOUT.groups,
    });
  } catch {
    return defaultLayout();
  }
}

export function serializeSidebarLayout(layout: SidebarLayout) {
  return JSON.stringify({
    version: 1,
    layout: normalizeLayout(layout),
  } satisfies StoredSidebarLayout);
}

export function readSidebarLayout(
  storage?: SidebarStorage
): SidebarLayout {
  try {
    return parseSidebarLayout((storage ?? window.localStorage).getItem(STORAGE_KEY));
  } catch {
    return defaultLayout();
  }
}

function writeSidebarLayout(
  layout: SidebarLayout,
  storage?: SidebarStorage
) {
  try {
    (storage ?? window.localStorage).setItem(STORAGE_KEY, serializeSidebarLayout(layout));
  } catch {
    // Keep the in-memory layout when localStorage is unavailable.
  }
}

export function commitSidebarLayout(
  current: SidebarLayout,
  patch: Partial<SidebarLayout>,
  storage?: SidebarStorage
) {
  const next = normalizeLayout({ ...current, ...patch });
  writeSidebarLayout(next, storage);
  return next;
}
