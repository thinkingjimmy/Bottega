/**
 * [INPUT]: Depends on the browser localStorage, receives incredible versioning third-party layout JSON with ChatView available width
 * [OUTPUT]: Provides third-order size/dynamic constant, default values/dynamic geometry, parse sequencing and synchronous submission functions
 * [POS]: The renderer's Chat is horizontal layout data boundaries, perpetuating user preferences and giving the second row 360px minimum width priority
 */

export const CHAT_MAIN_COLUMN_MIN_WIDTH = 360;
export const SIDE_PANEL_DEFAULT_VIEWPORT_RATIO = 0.42;
export const SIDE_PANEL_MIN_WIDTH = 320;
export const SIDE_PANEL_MAX_WIDTH = 960;
export const SIDE_PANEL_TRANSITION_MS = 200;

export type SidePanelLayout = {
  width: number;
};

export type SidePanelGeometry = {
  width: number;
  minWidth: number;
  maxWidth: number;
};

type StoredSidePanelLayout = {
  version: 1;
  layout: SidePanelLayout;
};

type SidePanelStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "ai-chat.side-panel-layout.v1";

function clampPreferredWidth(width: number) {
  return Math.min(
    SIDE_PANEL_MAX_WIDTH,
    Math.max(SIDE_PANEL_MIN_WIDTH, Math.round(width))
  );
}

export function defaultSidePanelWidth(viewportWidth: number) {
  const safeViewportWidth = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : 0;
  return clampPreferredWidth(
    safeViewportWidth * SIDE_PANEL_DEFAULT_VIEWPORT_RATIO
  );
}

export function resolveSidePanelGeometry(
  containerWidth: number,
  preferredWidth: number
): SidePanelGeometry {
  const safeContainerWidth = Number.isFinite(containerWidth)
    ? Math.max(0, Math.floor(containerWidth))
    : 0;
  const maxWidth = Math.min(
    SIDE_PANEL_MAX_WIDTH,
    Math.max(0, safeContainerWidth - CHAT_MAIN_COLUMN_MIN_WIDTH)
  );
  const minWidth = Math.min(SIDE_PANEL_MIN_WIDTH, maxWidth);
  return {
    width: Math.min(maxWidth, Math.max(minWidth, preferredWidth)),
    minWidth,
    maxWidth,
  };
}

function normalizeLayout(layout: SidePanelLayout): SidePanelLayout {
  return { width: clampPreferredWidth(layout.width) };
}

export function parseSidePanelLayout(
  raw: string | null,
  viewportWidth: number
): SidePanelLayout {
  const fallback = { width: defaultSidePanelWidth(viewportWidth) };
  if (!raw) return fallback;

  try {
    const stored = JSON.parse(raw) as Partial<StoredSidePanelLayout>;
    if (
      stored.version !== 1 ||
      typeof stored.layout?.width !== "number" ||
      !Number.isFinite(stored.layout.width)
    ) {
      return fallback;
    }
    return normalizeLayout(stored.layout);
  } catch {
    return fallback;
  }
}

export function serializeSidePanelLayout(layout: SidePanelLayout) {
  return JSON.stringify({
    version: 1,
    layout: normalizeLayout(layout),
  } satisfies StoredSidePanelLayout);
}

export function readSidePanelLayout(
  storage: SidePanelStorage = window.localStorage,
  viewportWidth: number = window.innerWidth
): SidePanelLayout {
  try {
    return parseSidePanelLayout(storage.getItem(STORAGE_KEY), viewportWidth);
  } catch {
    return { width: defaultSidePanelWidth(viewportWidth) };
  }
}

export function writeSidePanelLayout(
  layout: SidePanelLayout,
  storage: SidePanelStorage = window.localStorage
) {
  try {
    storage.setItem(STORAGE_KEY, serializeSidePanelLayout(layout));
  } catch {
    // localStorage 不可用时保留当前会话状态，不阻断聊天。
  }
}

export function commitSidePanelLayout(
  current: SidePanelLayout,
  patch: Partial<SidePanelLayout>,
  storage: SidePanelStorage = window.localStorage
) {
  const next = normalizeLayout({ ...current, ...patch });
  writeSidePanelLayout(next, storage);
  return next;
}
