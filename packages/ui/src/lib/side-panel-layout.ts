/**
 * [INPUT]: Depends on browser localStorage and the available ChatView container width; tolerates untrusted/malformed versioned JSON
 * [OUTPUT]: Provides side-panel width constants, defaultSidePanelWidth/resolveSidePanelGeometry, versioned parse/serialize functions, and read/commit persistence
 * [POS]: Renderer's persistence boundary for the Chat side panel's horizontal layout; persists the user's preferred width while always guaranteeing the main column its 360px minimum
 */

export const CHAT_MAIN_COLUMN_MIN_WIDTH = 360;
const SIDE_PANEL_DEFAULT_VIEWPORT_RATIO = 0.42;
export const SIDE_PANEL_MIN_WIDTH = 320;
export const SIDE_PANEL_MAX_WIDTH = 1024;
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

export type SidePanelStorage = Pick<Storage, "getItem" | "setItem">;


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
  key: string,
  storage?: SidePanelStorage,
  viewportWidth: number = window.innerWidth
): SidePanelLayout {
  try {
    return parseSidePanelLayout((storage ?? window.localStorage).getItem(key), viewportWidth);
  } catch {
    return { width: defaultSidePanelWidth(viewportWidth) };
  }
}

function writeSidePanelLayout(
  key: string,
  layout: SidePanelLayout,
  storage?: SidePanelStorage
) {
  try {
    (storage ?? window.localStorage).setItem(key, serializeSidePanelLayout(layout));
  } catch {
    // A blocked storage backend must never interrupt the current conversation.
  }
}

export function commitSidePanelLayout(
  key: string,
  current: SidePanelLayout,
  patch: Partial<SidePanelLayout>,
  storage?: SidePanelStorage
) {
  const next = normalizeLayout({ ...current, ...patch });
  writeSidePanelLayout(key, next, storage);
  return next;
}
