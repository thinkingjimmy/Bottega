/**
 * [INPUT]: Depends on browser localStorage, receives incredible versioning of Sidebar layout JSON
 * [OUTPUT]: Provides SidebarLayout/SidebarGroups/SidebarView, size constants, loose parsing sequencing, synchronized submission and error reading of the function
 * [POS]: The Sidebar layout of the renderer borders the data to commit to synchronize to eliminate the pending state before the window closes
 */

export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;

export type SidebarView = "library" | "activity";

export type SidebarGroups = {
  projects: boolean;
  bases: boolean;
  chats: boolean;
};

export type SidebarLayout = {
  open: boolean;
  width: number;
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
  storage: SidebarStorage = window.localStorage
): SidebarLayout {
  try {
    return parseSidebarLayout(storage.getItem(STORAGE_KEY));
  } catch {
    return defaultLayout();
  }
}

export function writeSidebarLayout(
  layout: SidebarLayout,
  storage: SidebarStorage = window.localStorage
) {
  try {
    storage.setItem(STORAGE_KEY, serializeSidebarLayout(layout));
  } catch {
    // localStorage 不可用时保留当前会话状态，不阻断产品。
  }
}

export function commitSidebarLayout(
  current: SidebarLayout,
  patch: Partial<SidebarLayout>,
  storage: SidebarStorage = window.localStorage
) {
  const next = normalizeLayout({ ...current, ...patch });
  writeSidebarLayout(next, storage);
  return next;
}
