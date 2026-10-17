/**
 * [INPUT]: Complete source bytes and strict UTF-8 decoding.
 * [OUTPUT]: assertHtmlDocument, a pure complete-HTML boundary with no registration.
 * [POS]: Design source validation; independent of App installation, history and SDK grants.
 */
import { statusError } from "../../ipc/errors";

export function assertHtmlDocument(content: Buffer) {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw statusError(415, "Design source must be valid UTF-8");
  }
  if (hasDisallowedControl(source)) {
    throw statusError(415, "Design source contains binary controls");
  }
  const document = source.replace(/^\uFEFF?\s*/, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)+/, "")
    .replace(/^<!doctype\s+html\b[^>]*>\s*/i, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)+/, "");
  if (
    !/^<html\b[^>]*>/i.test(document) ||
    !/<\/html>\s*(?:<!--[\s\S]*?-->\s*)*$/i.test(document)
  ) {
    throw statusError(415, "Design source must be a complete HTML document");
  }
}

function hasDisallowedControl(source: string) {
  for (const character of source) {
    const code = character.charCodeAt(0);
    if (code === 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) {
      return true;
    }
  }
  return false;
}
