/**
 * [INPUT]: Depends on the selected folder root and the current turn's canonical workspace.
 * [OUTPUT]: Names the write-protected content roots of a folder without reading it.
 * [POS]: Folder capability projection; backends consume paths without knowing the portable layout.
 */
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** Every top-level name the product owns. A folder holds nothing else the Agent may rewrite. */
const CONTENT_ROOTS = [".bottega", ".trash", "projects", "bases", "skills", "chats", "apps"] as const;
/** The current object's own portable evidence; its writable directory is the only exception. */
const CHAT_PROTECTED = ["chat.json", "transcript.jsonl", "attachments", "attachments.json", "artifacts", "branches"] as const;

/** `<root>/<collection>/<id>/<writable>` for the workspace, derived from the path alone. */
function currentObject(root: string, workspace: string) {
  const path = relative(root, resolve(workspace));
  if (!path || isAbsolute(path) || path.startsWith("..")) return null;
  const [collection, id, writable] = path.split(sep);
  if (!collection || !id || !writable) return null;
  if (collection === "chats" && writable === "home") return { collection, id, protect: CHAT_PROTECTED };
  if (collection === "apps" && writable === "source") return { collection, id, protect: ["app.json"] as const };
  return null;
}

/**
 * A fixed rule set: scanning the folder once per turn grew with the number of Chats and
 * produced one sandbox rule per Chat directory. The current workspace stays writable
 * because every profile emits it as the more specific rule — see sbpl.ts `writeRules`.
 */
export function libraryReadOnlyRoots(root: string | null, workspace: string) {
  if (!root) return [];
  const roots = CONTENT_ROOTS.map(name => join(root, name));
  const current = currentObject(root, workspace);
  /* The collection deny is an ancestor of the workspace, so consumers whose deny rules
     outrank every allow (Claude permission rules) drop it; naming the current object's
     own evidence keeps that protection exact instead of relying on the ancestor. */
  if (current) roots.push(...current.protect.map(name => join(root, current.collection, current.id, name)));
  return roots;
}
