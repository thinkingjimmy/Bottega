/**
 * [INPUT]: Depends on the Base UI runtime exports, their source modules, package dependency boundary and Vite library mode.
 * [OUTPUT]: Builds runtime exports and their preserved ESM dependency modules with host dependencies left external; type-only exports produce no JavaScript.
 * [POS]: Independent official Base UI build; Desktop and Web consume these modules through package exports.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;
const source = resolve(root, "src");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const dependencies = Object.keys(manifest.dependencies);
const entries = Object.fromEntries(Object.entries(manifest.exports)
  .filter(([, target]) => target.default)
  .map(([subpath]) => {
    const name = subpath.slice(2);
    const path = [".ts", ".tsx"].map(extension => resolve(source, name + extension)).find(existsSync);
    if (!path) throw new Error(`Base UI runtime export has no source: ${subpath}`);
    return [name, path];
  }));

export default defineConfig({
  esbuild: { jsx: "automatic", charset: "ascii" },
  build: {
    outDir: resolve(root, "dist"), emptyOutDir: true, minify: false, target: "es2022",
    lib: { entry: entries, formats: ["es"] },
    rollupOptions: {
      external: id => dependencies.some(name => id === name || id.startsWith(name + "/")),
      output: { preserveModules: true, preserveModulesRoot: source, entryFileNames: "[name].js" },
    },
  },
});
