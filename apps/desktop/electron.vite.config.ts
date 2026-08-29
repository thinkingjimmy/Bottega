/**
 * [INPUT]: Depends on electron-Vite, vite React/Tailwind, Node path and Rollup chunk module chart
 * [OUTPUT]: Provides main/preload development, listening, three builds, producing CSP, renderer module reports, and gated four launcher dist connectivity smoke entry
 * [POS]: The project builds an input that connects the side of the Electron Node to the side of the React renderingdev main rebuilds force restarting Electron to avoid render/main version tearing
 */

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

const PRODUCTION_CSP = [
  "default-src 'self'",
  "frame-src http://*.localhost:*",
  "connect-src 'self' https://tile.openstreetmap.org",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fontsapi.zeoseven.com",
  "font-src 'self' https://fontsapi.zeoseven.com",
  "img-src 'self' data:",
].join("; ");

function productionCsp(): Plugin {
  return {
    name: "production-csp",
    apply: "build",
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content: PRODUCTION_CSP,
            },
            injectTo: "head-prepend",
          },
        ],
      };
    },
  };
}

function chartModuleReport(): Plugin {
  const root = resolve(__dirname);
  const normalize = (path: string) =>
    relative(root, path).split(sep).join("/");
  return {
    name: "chart-module-report",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).flatMap((output) =>
        output.type === "chunk"
          ? [
              {
                fileName: output.fileName,
                isEntry: output.isEntry,
                imports: output.imports,
                dynamicImports: output.dynamicImports,
                moduleIds: Object.keys(output.modules).map(normalize),
              },
            ]
          : []
      );
      this.emitFile({
        type: "asset",
        fileName: ".chart-module-report.json",
        source: `${JSON.stringify({ chunks }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  main: {
    build: {
      /* electron-vite 5 只在显式配置 Rollup watch 时重启 main。
         缺少它会让 renderer HMR 成功、Electron 却继续执行旧 bundle。 */
      watch: {},
      externalizeDeps: {
        exclude: ["@modelcontextprotocol/sdk", "zod"],
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/main/index.ts"),
          "builtin-tools-server": resolve(
            __dirname,
            "electron/main/tools/server.ts"
          ),
          "codec-host-entry": resolve(
            __dirname,
            "electron/main/bases/media-host/codec-host-entry.ts"
          ),
          "custody-guardian-entry": resolve(
            __dirname,
            "electron/main/custody/guardian-entry.ts"
          ),
          "connectivity-smoke-entry": resolve(
            __dirname,
            "electron/main/connectivity-smoke-entry.ts"
          ),
        },
      },
    },
  },
  preload: {
    build: {
      /* preload 变更同样必须触发 renderer full reload。生产 build 会由
         electron-vite 自动清空 watch，不会把 watcher 带进发行产物。 */
      watch: {},
      externalizeDeps: {
        exclude: ["zod"],
      },
      rollupOptions: {
        input: resolve(__dirname, "electron/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: "src",
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    plugins: [react(), tailwindcss(), productionCsp(), chartModuleReport()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/index.html"),
      },
    },
  },
});
