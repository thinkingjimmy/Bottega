/**
 * [INPUT]: Depends on the fixed component definitions and regular, singly linked component source bytes.
 * [OUTPUT]: Generates or checks the deterministic v1 component catalog, including explicitly reviewed origin compatibility.
 * [POS]: App GUI metadata generation leaf; runs before authoring metadata so private and exported sources use their actual bytes.
 */

import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The original catalog and all five source hashes were verified together. Never admit a digest from an input catalog.
const compatibleOriginSnapshots = ["sha256:0e68acebc21195b2f897daebe6bf5be06722f10b7bba5b3b5765f20e7d880ae8"];
const definitions = [
  ["feedback", ["Progress", "Toast"]],
  ["forms", ["Button", "Input", "Textarea", "Label", "Field", "Checkbox", "Switch", "RadioGroup", "Radio", "Select"]],
  ["navigation", ["Tabs", "Accordion"]],
  ["overlays", ["Dialog", "AlertDialog", "Popover", "Tooltip", "DropdownMenu"]],
  ["surfaces", ["Card", "Badge", "Separator", "Skeleton", "Table", "ScrollArea"]],
];

export async function syncComponentCatalog(snapshotRoot, { check = false } = {}) {
  const components = [];
  for (const [id, exports] of definitions) {
    const sourcePath = `${id}.tsx`;
    const path = join(snapshotRoot, sourcePath);
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1) throw new Error(`Component snapshot source is not a regular singly linked file: ${sourcePath}`);
    components.push({ id, sourcePath, targetPath: `gui/src/components/ui/${sourcePath}`,
      sha256: sha256(await readFile(path)), license: "MIT", exports });
  }
  const identity = { schema: "bottega.app-gui-component-snapshot/v1", compatibleOriginSnapshots, components };
  const catalog = { schema: identity.schema, snapshotDigest: sha256(Buffer.from(canonical(identity))), compatibleOriginSnapshots, components };
  const expected = `${JSON.stringify(catalog, null, 2)}\n`;
  const path = join(snapshotRoot, "catalog.json");
  const current = await readFile(path, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; });
  if (current !== expected) {
    if (check) throw new Error("App GUI component catalog drift: catalog identity or source bytes differ. Run `pnpm --filter @ai-chat/desktop app-gui:metadata` and commit the generated metadata with the source change.");
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, expected, { mode: 0o644, flag: "wx" });
    await rename(temporary, path);
  }
  return catalog;
}

const sha256 = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
