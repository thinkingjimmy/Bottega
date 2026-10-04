/**
 * [INPUT]: Depends only on the host platform identity.
 * [OUTPUT]: Provides independent background-entry and macOS display-selection capabilities.
 * [POS]: Presence platform policy; Agent runtime admission and login-item registration remain separate.
 */
export function presenceCapabilities(platform: NodeJS.Platform) {
  return { background: ["darwin", "win32", "linux"].includes(platform), displayModeSelection: platform === "darwin" };
}
