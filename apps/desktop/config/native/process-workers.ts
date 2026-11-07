/**
 * [INPUT]: Vite/Rollup, the fixed crypto/history worker entries and the main build's minification/diagnostic policy.
 * [OUTPUT]: isolatedProcessWorkers emits both fixed workers and all dependencies from independent complete Rollup graphs.
 * [POS]: Worker build boundary; each entry tree-shakes validators independently of the main process.
 */
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { build, type Plugin, type Rollup, type ESBuildOptions } from "vite";

type WorkerBuildPolicy = Readonly<{
  esbuild: ESBuildOptions;
  onwarn: Rollup.WarningHandlerWithDefault;
  define: Record<string, string>;
}>;
const WORKERS = [
  { entry: "sync-crypto-worker-entry", source: "electron/main/cloud/encryption/worker-entry.ts", chunks: "crypto-worker" },
  { entry: "history-import-worker-entry", source: "electron/main/workers/history-import-worker-entry.ts", chunks: "history-worker" },
] as const;

export function isolatedProcessWorkers(root: string, policy: WorkerBuildPolicy): Plugin {
  return {
    name: "isolated-process-workers",
    options(options) {
      const input = options.input;
      if (!input || typeof input !== "object" || Array.isArray(input) ||
        WORKERS.some(worker => input[worker.entry] !== resolve(root, worker.source)))
        this.error("Isolated workers require their fixed main build entries");
      return { ...options, input: Object.fromEntries(Object.entries(input).filter(([name]) => !WORKERS.some(worker => worker.entry === name))) };
    },
    async generateBundle() {
      const desktop = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { dependencies: Record<string, string> };
      const bundled = new Set(["zod", "@ai-chat/cloud-crypto", "libsodium-wrappers-sumo", "libsodium-sumo"]);
      const dependencies = Object.keys(desktop.dependencies).filter(name => !bundled.has(name));
      const external = (id: string) => id === "electron" || id.startsWith("electron/") || id.startsWith("node:") ||
        builtinModules.includes(id.split("/")[0]!) || dependencies.some(name => id === name || id.startsWith(`${name}/`));
      for (const worker of WORKERS) {
        // Each graph tree-shakes Zod against one process rather than every main-process feature.
        const result = await build({ root, configFile: false, logLevel: "warn", define: policy.define, esbuild: policy.esbuild,
        ssr: { noExternal: true, target: "node" },
        build: { write: false, ssr: true, minify: "esbuild", target: "node22", rollupOptions: {
          onwarn: policy.onwarn, input: { [worker.entry]: resolve(root, worker.source) }, external,
          output: { format: "cjs", entryFileNames: "[name].js", chunkFileNames: `${worker.chunks}/[name]-[hash].js`, onlyExplicitManualChunks: true },
        } },
      });
        const output = (Array.isArray(result) ? result[0]! : result as Rollup.RollupOutput).output;
        const entries = output.filter(file => file.type === "chunk" && file.isEntry);
        if (entries.length !== 1 || entries[0]!.fileName !== `${worker.entry}.js`)
          this.error("An isolated worker emitted an unexpected entry");
        for (const file of output) {
          if (isAbsolute(file.fileName) || file.fileName.split(/[\\/]/).includes("..")) this.error("Worker output escapes its build root");
          if (file.type === "chunk") {
            for (const id of file.moduleIds) if (!id.startsWith("\0")) this.addWatchFile(id);
            this.emitFile({ type: "asset", fileName: file.fileName, source: file.code });
          } else this.emitFile({ type: "asset", fileName: file.fileName, source: file.source });
        }
      }
    },
  };
}
