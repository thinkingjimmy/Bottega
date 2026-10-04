/**
 * [INPUT]: Depends on the closed output-root parser and selected stable/production or staging product and auxiliary (task-panel, system-dock, desktop-dialog) preload JavaScript.
 * [OUTPUT]: Rejects sibling chunk requires, product bridge leakage into auxiliary preloads, and a bundled validator library (zod) in any preload.
 * [POS]: Build-time sandbox preload oracle; every entry must load independently.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { resolveOutputRoot } from "../assembly/output-root.mjs";
const output = resolveOutputRoot(process.argv.slice(2));
const PRODUCT_BRIDGES = /exposeInMainWorld\("(?:agent|chats|settings|app|presence|systemDockSettings|cloud|usage)"/;
const AUXILIARY = { "task-panel": "taskPanel", "system-dock": "systemDock", "desktop-dialog": "desktopDialog" };
for (const name of ["index", ...Object.keys(AUXILIARY)]) {
  const source = readFileSync(resolve(import.meta.dirname, `../../${output}/preload/${name}.js`), "utf8");
  for (const [, dependency] of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
    assert.equal(dependency, "electron", `${name} preload requires a module unavailable in the Electron sandbox: ${dependency}`);
  }
  /* No preload bundles zod: every window runs its preload before first paint, so a value import of a contract that builds a schema
     costs each window a zod instance. Contracts reach a preload as types and channel names only (the Dock since OPT-34, every preload
     since the Provider catalog bridge pulled zod into the main one, TASK-11 d4a). */
  assert.doesNotMatch(source, /ZodError|\$ZodType/, `${name} preload bundles zod`);
  const bridge = AUXILIARY[name];
  if (!bridge) continue;
  assert.match(source, new RegExp(`exposeInMainWorld\\("${bridge}"`));
  assert.doesNotMatch(source, PRODUCT_BRIDGES, `${name} preload exposes a product bridge`);
}
