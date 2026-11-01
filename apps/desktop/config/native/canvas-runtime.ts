/**
 * [INPUT]: Verified maintained Canvas and Slides source builds and its digest-bound output receipt.
 * [OUTPUT]: Emits lazy native editor resources and complete licenses beside main.
 * [POS]: Desktop build composition; native editor code never enters the host startup bundle.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Plugin } from "vite";
export function canvasRuntime(root: string): Plugin {
  return { name: "maintained-canvas-runtime", async buildStart() {
    for (const directory of [root, resolve(root, "../slides-runtime")])
      execFileSync(process.execPath, [resolve(directory, "build/index.mjs")], { cwd: directory, stdio: "pipe" });
    for (const directory of ["source", "adapters", "build", "fonts"]) this.addWatchFile(resolve(root, directory));
  }, generateBundle() {
    for (const kind of ["canvas-runtime", "slides-runtime"]) {
    const directory = resolve(root, "..", kind);
    const receipt = readFileSync(resolve(directory, "dist/build.json"));
    const files = JSON.parse(receipt.toString()).outputs as { path: string; sha256: string }[];
    for (const file of files) {
      const source = readFileSync(resolve(directory, "dist", file.path));
      if (createHash("sha256").update(source).digest("hex") !== file.sha256) throw new Error("Native editor output changed before packaging");
      this.emitFile({ type: "asset", fileName: kind + "/" + file.path, source });
    }
    this.emitFile({ type: "asset", fileName: kind + "/build.json", source: receipt });
    }
  } };
}
