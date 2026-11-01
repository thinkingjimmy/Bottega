/**
 * [INPUT]: Native source-relative references and the complete immutable document member set.
 * [OUTPUT]: Source-bound project/blob resource resolution without filesystem access.
 * [POS]: Native Canvas/Slides resource closure shared by structural checks and snapshot rendering.
 */
import { designResourceTarget } from "../documents/resources/references";
export function nativeResourceTarget(path: string, reference: string, files: ReadonlySet<string>): string | null {
  const blob = /^\/_blob\/([a-f0-9]{32})(?:[?#].*)?$/.exec(reference);
  if (blob) {
    const matches = [...files].filter(path => path.startsWith("assets/" + blob[1] + "."));
    if (matches.length !== 1) throw new Error("Native uploaded resource is missing or ambiguous");
    return matches[0]!;
  }
  if (reference.startsWith("project/")) return designResourceTarget("canvas.json", reference.slice(8));
  if (/^slides\/[^/]+\.html$/.test(path)) {
    if (reference.startsWith("../")) throw new Error("Slides resources are relative to the deck root");
    return designResourceTarget("deck.json", reference);
  }
  const target = designResourceTarget(path, reference);
  if (target?.endsWith("support.js") && /^(?:\.\/)?support\.js$/.test(reference) && !files.has(target)) return "@runtime/support.js";
  return target;
}
