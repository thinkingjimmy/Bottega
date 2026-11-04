/**
 * [INPUT]: Original JS palette validator exports.
 * [OUTPUT]: Exact evaluator and contrast function declarations for the trusted desktop build.
 * [POS]: Types only; original validation remains in validate_palette.js.
 */
import type { PaletteEngine } from './report-core.mjs';
export const validate: PaletteEngine['validate'];
export const validateOrdinal: PaletteEngine['validateOrdinal'];
export function contrast(a: string, b: string): number;
export function apca(text: string, background: string): number;
