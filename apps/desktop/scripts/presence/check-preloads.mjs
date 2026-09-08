/**
 * [INPUT]: Depends on the generated product and auxiliary preload JavaScript.
 * [OUTPUT]: Rejects sibling chunk requires and product bridge leakage into the panel preload.
 * [POS]: Build-time sandbox preload oracle; both entries must load independently.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
for (const name of ["index", "task-panel"]) {
  const source = readFileSync(resolve(import.meta.dirname, `../../out/preload/${name}.js`), "utf8");
  for (const [, dependency] of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
    assert.equal(dependency, "electron", `${name} preload requires a module unavailable in the Electron sandbox: ${dependency}`);
  }
  if (name === "task-panel") {
    assert.match(source, /exposeInMainWorld\("taskPanel"/);
    assert.doesNotMatch(source, /exposeInMainWorld\("(?:agent|chats|settings|app|presence)"/);
  }
}
