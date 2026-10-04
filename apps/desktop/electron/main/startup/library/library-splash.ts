/**
 * [INPUT]: Depends on Electron BrowserWindow/nativeTheme, the main-process catalogs and the mirror opening progress numbers.
 * [OUTPUT]: Provides openLibrarySplash: a frameless progress window shown while a folder too large to defer is opened, or while a folder is copied to another volume — the latter with a Cancel button whose click main intercepts as a navigation (F-24).
 * [POS]: startup/library/ presentation leaf below library-runtime; it decides nothing about content and never fails a launch.
 */
import { app, BrowserWindow, nativeTheme } from "electron";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../shared/i18n/native";
import { windowBackgroundColor } from "../../window/native-theme";

export type LibrarySplash = { update(completed: number, total: number): void; close(): void };

const WIDTH = 380, HEIGHT = 140, CANCELLABLE_HEIGHT = 184;
/* The page has no preload and no IPC: its one action is a link main intercepts before any navigation happens. */
const CANCEL_URL = "bottega-splash:cancel";

/* One window, two jobs: opening a large folder, and carrying a folder to another volume. */
const COPY = {
  opening: { title: "settings.native.libraryOpeningTitle", progress: "settings.native.libraryOpeningProgress" },
  moving: { title: "settings.native.libraryMovingTitle", progress: "settings.native.libraryMovingProgress", counting: "settings.native.libraryMovingCounting",
    cancel: "settings.native.libraryMovingCancel", cancelling: "settings.native.libraryMovingCancelling" },
} as const;
export type LibrarySplashPurpose = keyof typeof COPY;

function page(locale: AppLocale, dark: boolean, total: number, purpose: LibrarySplashPurpose, cancellable: boolean) {
  /* The first paint has to be right without a stylesheet or a renderer bundle: this window exists
     precisely because neither is loaded yet. Colours mirror native-theme.ts so the two windows
     that follow each other on screen never disagree about light or dark. */
  const foreground = dark ? "#fafafa" : "#0a0a0a", muted = dark ? "#a1a1a1" : "#737373";
  const track = dark ? "#262626" : "#e5e5e5";
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8" />
<title>${escapeHtml(translate(locale, COPY[purpose].title))}</title>
<style>
  :root { color-scheme: ${dark ? "dark" : "light"}; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    background: ${windowBackgroundColor()}; color: ${foreground}; -webkit-user-select: none; cursor: default;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .mark { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
  .line { color: ${muted}; font-variant-numeric: tabular-nums; }
  progress { width: 236px; height: 4px; appearance: none; border: 0; }
  progress::-webkit-progress-bar { background: ${track}; border-radius: 999px; }
  progress::-webkit-progress-value { background: ${foreground}; border-radius: 999px; }
  /* The product's secondary button, drawn here because no stylesheet is loaded yet. */
  a.button { margin-top: 4px; padding: 4px 12px; border-radius: 6px; border: 1px solid ${track}; color: ${foreground};
    text-decoration: none; font-weight: 500; }
  a.button:hover { background: ${track}; }
  a.button[aria-disabled="true"] { color: ${muted}; pointer-events: none; }
</style></head><body>
  <div class="mark">Bottega</div>
  <div class="line" id="line">${escapeHtml(lineText(locale, purpose, 0, total))}</div>
  ${total > 0 ? `<progress id="bar" max="${total}" value="0"></progress>` : `<progress id="bar"></progress>`}
  ${cancellable ? `<a class="button" id="cancel" href="${CANCEL_URL}" onclick="this.setAttribute('aria-disabled','true')">${escapeHtml(translate(locale, COPY.moving.cancel))}</a>` : ""}
</body></html>`;
}

/* A move opens its window before the file count is known (F-24); until then it says so and the bar is indeterminate. */
function lineText(locale: AppLocale, purpose: LibrarySplashPurpose, completed: number, total: number) {
  const copy = COPY[purpose];
  return total === 0 && "counting" in copy ? translate(locale, copy.counting) : translate(locale, copy.progress, { completed, total });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
}

export async function openLibrarySplash(input: { locale: AppLocale; total: number; purpose?: LibrarySplashPurpose; onCancel?(): void }): Promise<LibrarySplash | null> {
  const purpose = input.purpose ?? "opening";
  const copy = COPY[purpose], cancellable = Boolean(input.onCancel) && "cancel" in copy;
  let cancelled = false;
  let window: BrowserWindow | undefined;
  try {
    window = new BrowserWindow({
      width: WIDTH, height: cancellable ? CANCELLABLE_HEIGHT : HEIGHT, show: false, frame: false, resizable: false, maximizable: false,
      minimizable: false, fullscreenable: false, center: true, alwaysOnTop: false, autoHideMenuBar: true,
      backgroundColor: windowBackgroundColor(),
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: false },
    });
    const surface = window;
    surface.webContents.on("will-navigate", (event, url) => {
      event.preventDefault();
      if (url !== CANCEL_URL || !cancellable || cancelled) return;
      cancelled = true;
      if ("cancelling" in copy) void surface.webContents.executeJavaScript(
        `(() => { const line = document.getElementById("line"); if (line) line.textContent = ${JSON.stringify(translate(input.locale, copy.cancelling))}; })()`).catch(() => undefined);
      input.onCancel?.();
    });
    await surface.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(input.locale, nativeTheme.shouldUseDarkColors, input.total, purpose, cancellable))}`);
    surface.show();
    return {
      update(completed, total) {
        if (surface.isDestroyed() || cancelled) return;
        const line = lineText(input.locale, purpose, completed, total);
        void surface.webContents.executeJavaScript(
          `(() => { const line = document.getElementById("line"); if (line) line.textContent = ${JSON.stringify(line)};
            const bar = document.getElementById("bar"); if (bar && ${total} > 0) { bar.max = ${total}; bar.value = ${completed}; } })()`
        ).catch(() => undefined);
        surface.setProgressBar(total > 0 ? Math.min(1, completed / total) : -1);
      },
      close() {
        if (surface.isDestroyed()) return;
        surface.setProgressBar(-1);
        surface.hide();
        /* Destroying the only window before the main one exists reads as "the session ended" to the
           presence lifecycle, which then quits mid-launch. Hidden costs nothing; the successor's
           creation is the one moment where leaving is free. */
        app.once("browser-window-created", () => { if (!surface.isDestroyed()) surface.destroy(); });
      },
    };
  } catch (cause) {
    console.warn(`[library] opening window unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    try { window?.destroy(); } catch { /* The window is already gone; startup continues without it. */ }
    return null;
  }
}
