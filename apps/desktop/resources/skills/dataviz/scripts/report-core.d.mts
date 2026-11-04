/**
 * [INPUT]: Typed original palette evaluator functions and script identities.
 * [OUTPUT]: PaletteEngine and paletteReport declarations for the desktop entry.
 * [POS]: Type boundary for the shared report implementation; no runtime rules.
 */
export type PaletteEngine = {
  validate(palette: string[], options: { mode: string; surface: string; pairs: string }): { report: Array<[string, boolean | string, string]>; ok: boolean };
  validateOrdinal(palette: string[], options: { mode: string; surface: string }): { report: Array<[string, boolean | string, string]>; ok: boolean };
};
export function paletteReport(args: string[], engine: PaletteEngine, script: { version: string; gitBlob: string; sha256: string }): { exitStatus: number };
