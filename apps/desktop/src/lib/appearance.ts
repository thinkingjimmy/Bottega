/**
 * [INPUT]: Depends on the browser localStorage and documentElement dataset
 * [OUTPUT]: Provides FontFamily/AppearancePreferences, versioning parsing sequencing, reading and writing with DOM application functions
 * [POS]: external boundaries of the renderer data set, isolating the persistence format from the React Provider
 */

export const FONT_FAMILIES = ["system", "maple-mono", "geist-sans"] as const;

export type FontFamily = (typeof FONT_FAMILIES)[number];

export type AppearancePreferences = {
  fontFamily: FontFamily;
};

type StoredAppearance = {
  version: 1;
  appearance: AppearancePreferences;
};

type AppearanceStorage = Pick<Storage, "getItem" | "setItem">;
type AppearanceRoot = Pick<HTMLElement, "dataset">;

const STORAGE_KEY = "ai-chat.appearance.v1";

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  fontFamily: "system",
};

const isFontFamily = (value: unknown): value is FontFamily =>
  FONT_FAMILIES.some((font) => font === value);

export function parseAppearance(raw: string | null): AppearancePreferences {
  if (!raw) return DEFAULT_APPEARANCE;

  try {
    const stored = JSON.parse(raw) as Partial<StoredAppearance>;
    if (stored.version !== 1 || !isFontFamily(stored.appearance?.fontFamily)) {
      return DEFAULT_APPEARANCE;
    }
    return { fontFamily: stored.appearance.fontFamily };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function serializeAppearance(appearance: AppearancePreferences) {
  return JSON.stringify({ version: 1, appearance } satisfies StoredAppearance);
}

export function readAppearance(
  storage: AppearanceStorage = window.localStorage
): AppearancePreferences {
  try {
    return parseAppearance(storage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeAppearance(
  appearance: AppearancePreferences,
  storage: AppearanceStorage = window.localStorage
) {
  try {
    storage.setItem(STORAGE_KEY, serializeAppearance(appearance));
  } catch {
    // localStorage 不可用时保留当前会话内的外观，不阻断产品。
  }
}

export function applyAppearance(
  appearance: AppearancePreferences,
  root: AppearanceRoot = document.documentElement
) {
  root.dataset.font = appearance.fontFamily;
}

export function initializeAppearance() {
  const appearance = readAppearance();
  applyAppearance(appearance);
  return appearance;
}
