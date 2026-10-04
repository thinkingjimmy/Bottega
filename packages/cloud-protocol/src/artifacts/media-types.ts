/**
 * [INPUT]: None; pure functions over an artifact's kind, media type and leading bytes.
 * [OUTPUT]: Provides artifactExtension (the one MIME → extension table, then the kind, then `bin`) and sniffImageMime (magic bytes
 *           of png, jpeg, gif and webp).
 * [POS]: The shared artifact file-type contract (OPT-42): desktop snapshot paths and admission, and Web downloads, read the same table,
 *        so a PNG is never stored as `.img`/`.bin` or downloaded as `.image`. SVG has no magic bytes and is never sniffed as an
 *        image: it is admitted as its own text kind (`svg`) and only rendered inside the sandboxed artifact frame.
 */

const BY_MIME: Readonly<Record<string, string>> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg",
  "application/pdf": "pdf", "text/csv": "csv", "text/markdown": "md", "text/html": "html", "application/x-tar": "tar",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
const BY_KIND: Readonly<Record<string, string>> = {
  "html-fragment": "html", "html-document": "html", "static-site": "tar", markdown: "md", svg: "svg",
  pdf: "pdf", docx: "docx", pptx: "pptx", xlsx: "xlsx", csv: "csv",
};

export function artifactExtension(artifact: { kind: string; mime?: string }) {
  return BY_MIME[(artifact.mime ?? "").split(";")[0]!.trim().toLowerCase()] ?? BY_KIND[artifact.kind] ?? "bin";
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
  bytes.length >= at + prefix.length && prefix.every((value, index) => bytes[at + index] === value);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** The raster image a file's bytes really are, or null; admission refuses an image whose bytes disagree with its extension. */
export function sniffImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}
