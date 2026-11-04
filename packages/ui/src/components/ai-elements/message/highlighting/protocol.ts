/**
 * [INPUT]: Depends on the Streamdown code plugin's highlight types
 * [OUTPUT]: Provides the code worker request and response protocol and plain-text fallback
 * [POS]: Shared serializable boundary between the highlighting client and worker
 */
import type { HighlightOptions, HighlightResult } from "@streamdown/code";

export type HighlightRequest = { id: number; options: HighlightOptions };
export type HighlightResponse =
  | { type: "ready"; languages: string[] }
  | { type: "result"; id: number; result: HighlightResult }
  | { type: "failure"; id: number; message: string };

export const plainTokens = (code: string): HighlightResult => ({
  tokens: code.split(/\r\n|\n|\r/).map(content => [{ content, offset: 0 }]),
});
