/**
 * [INPUT]: Inert fixed native references and canonical message strings.
 * [OUTPUT]: Shared reference fence encoding and plain instruction projection for copy/edit.
 * [POS]: Zod-free presentation grammar; parsing text never grants navigation or execution authority.
 */
import type { DesignReference } from "./design";
export const DESIGN_REFERENCE_LANGUAGE = "bottega-design-reference";
export const DESIGN_REFERENCE_MESSAGE_LIMIT = 131072;
export function encodeDesignReferenceMessage(name: string, reference: DesignReference) {
  if (!reference.native) return `@${name}`;
  const payload = JSON.stringify({ name, reference });
  if (payload.length > DESIGN_REFERENCE_MESSAGE_LIMIT) throw new Error("Design reference message exceeds its presentation budget");
  return `\n\n\`\`\`${DESIGN_REFERENCE_LANGUAGE}\n${payload}\n\`\`\`\n\n`;
}
export function designReferenceMessageText(content: string): string {
  return content.replace(/(^|\n)```bottega-design-reference\r?\n([^\r\n]+)\r?\n```(?=\r?\n|$)/g, (match, prefix: string, code: string) => {
    if (code.length > DESIGN_REFERENCE_MESSAGE_LIMIT) return match;
    try {
      const value = JSON.parse(code);
      if (typeof value?.name !== "string" || !value.name || value.name.length > 1000 || typeof value.reference?.native?.text !== "string" || value.reference.native.text.length > 10000) return match;
      return `${prefix}@${value.name}\n${value.reference.native.text}`;
    } catch { return match; }
  });
}
