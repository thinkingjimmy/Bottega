/**
 * [INPUT]: Depends on the closed output-root parser and selected stable/production or staging product and auxiliary (task-panel, system-dock) preload JavaScript.
 * [OUTPUT]: Rejects sibling chunk requires, product bridge leakage into auxiliary preloads, and a bundled validator library in the resident Dock preload.
 * [POS]: Build-time sandbox preload oracle; every entry must load independently.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { resolveOutputRoot } from "../assembly/output-root.mjs";
const output = resolveOutputRoot(process.argv.slice(2));
const PRODUCT_BRIDGES = /exposeInMainWorld\("(?:agent|chats|settings|app|presence|systemDockSettings|cloud|usage)"/;
const AUXILIARY = { "task-panel": "taskPanel", "system-dock": "systemDock" };
for (const name of ["index", ...Object.keys(AUXILIARY)]) {
  const source = readFileSync(resolve(import.meta.dirname, `../../${output}/preload/${name}.js`), "utf8");
  for (const [, dependency] of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
    assert.equal(dependency, "electron", `${name} preload requires a module unavailable in the Electron sandbox: ${dependency}`);
  }
  const bridge = AUXILIARY[name];
  if (!bridge) continue;
  assert.match(source, new RegExp(`exposeInMainWorld\\("${bridge}"`));
  assert.doesNotMatch(source, PRODUCT_BRIDGES, `${name} preload exposes a product bridge`);
  /* The Dock preload binds channel names by type only; a value import of the contract would
     drag zod into every Dock renderer. */
  if (name === "system-dock") assert.doesNotMatch(source, /ZodError|\$ZodType|zod/i, "system-dock preload bundles zod");
}
