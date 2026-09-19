/**
 * [INPUT]: Host CSS custom properties and resolved light/dark mode.
 * [OUTPUT]: Closed artifact theme token names and message type.
 * [POS]: Lightweight shared viewer theme contract without vendor runtime imports.
 */
export const ARTIFACT_THEME_TOKENS = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring", "blue", "orange", "green", "red", "purple", "yellow", "viz-series-1", "viz-series-2", "viz-series-3", "viz-series-4", "viz-series-5", "viz-series-6", "font-size-base"] as const;
export type ArtifactTheme = { mode: "light" | "dark"; tokens: Record<string, string> };
