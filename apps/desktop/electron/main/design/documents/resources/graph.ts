/**
 * [INPUT]: Current immutable manifest/files and the same syntax/resource resolver used by rendering.
 * [OUTPUT]: Rejects cyclic loaded dependencies without executing authored code or loading an editor.
 * [POS]: Shared current native/system source validation; navigation never loads a dependency.
 */
import type { DesignManifest, DesignReadSet } from "../model";
import { designResourceReferences, designResourceTarget } from "./references";
import { nativeResourceTarget } from "../../native/resources";
export async function validateLoadedGraph(manifest: DesignManifest, readSet: DesignReadSet) {
  const files = new Map(readSet.files.map(file => [file.path, file.data])), paths = new Set(files.keys());
  const active = new Set<string>(), checked = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    if (active.has(path)) throw new Error("Missing or cyclic loaded render dependency: " + path);
    if (checked.has(path) || path === "@runtime/support.js") return;
    const bytes = files.get(path);
    if (!bytes) throw new Error("Missing loaded render dependency: " + path);
    active.add(path);
    if (/\.(?:html|css|[cm]?js|svg)$/i.test(path)) for (const reference of await designResourceReferences(new TextDecoder("utf-8", { fatal: true }).decode(bytes), path)) {
      if (reference.kind === "navigation") continue;
      const target = manifest.contentFormat ? nativeResourceTarget(path, reference.url, paths) : designResourceTarget(path, reference.url);
      if (target) await visit(target);
    }
    active.delete(path); checked.add(path);
  };
  for (const board of manifest.boards) await visit(board.file);
}
