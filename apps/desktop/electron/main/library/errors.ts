/**
 * [INPUT]: Depends on nothing beyond the standard Error shape.
 * [OUTPUT]: Provides LibraryError with a stable code and the owning computer's name, plus the readers that recover both from any thrown value.
 * [POS]: Shared folder-failure vocabulary between the folder lifetime, startup recovery and the localized settings boundary.
 */
export const LIBRARY_ERROR_CODES = [
  "missing",
  "locked",
  "identity-changed",
  "control-invalid",
  "already-configured",
  "root-changed",
  "owned-elsewhere",
] as const;
export type LibraryErrorCode = (typeof LIBRARY_ERROR_CODES)[number];

export class LibraryError extends Error {
  override name = "LibraryError";
  /** `host` names the computer a refused folder belongs to; it is the one value the copy for that code interpolates. */
  constructor(readonly code: LibraryErrorCode, message = `LIBRARY_${code.replaceAll("-", "_").toUpperCase()}`, readonly host: string | null = null) {
    super(message);
  }
}

/* The code is the whole contract: LibraryLockedError carries one too, while an
   errno or a Zod failure carries an unrelated string and must stay untranslated. */
export function libraryErrorCode(error: unknown): LibraryErrorCode | null {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && (LIBRARY_ERROR_CODES as readonly string[]).includes(code)
    ? (code as LibraryErrorCode)
    : null;
}

export function libraryErrorHost(error: unknown): string {
  const host = (error as { host?: unknown } | null | undefined)?.host;
  return typeof host === "string" ? host : "";
}
