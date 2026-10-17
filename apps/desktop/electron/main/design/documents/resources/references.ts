/**
 * [INPUT]: File-kind scanners and the strict document-local source path contract.
 * [OUTPUT]: Classified source spans and one safe resolver shared by validation/rendering.
 * [POS]: Resource graph boundary; navigation is validated but never recursively embedded.
 */
import { posix } from "node:path";
import { sourcePath } from "../model";
export async function designResourceReferences(text: string, path: string) {
  if (/\.(?:html|svg)$/i.test(path)) return (await import("./html")).htmlReferences(text);
  if (/\.css$/i.test(path)) return (await import("./css")).cssReferences(text);
  if (/\.[cm]?js$/i.test(path)) return (await import("./script")).scriptReferences(text);
  return [];
}
export function designResourceTarget(path: string, reference: string) {
  if (/^(?:data:|#)/i.test(reference)) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(reference)) throw new Error("Resources and navigation must stay inside the document");
  const clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]!);
  if (clean.includes("\\")) throw new Error("Resource path contains a backslash");
  const target = posix.normalize(posix.join(posix.dirname(path), clean));
  if (!sourcePath.safeParse(target).success || target.startsWith("../")) throw new Error("Resource is outside the document");
  return target;
}
