/**
 * [INPUT]: Depends on electron-vite, Vite React/Tailwind plugins, esbuild, Node paths, Rollup diagnostics, and cloud assembly configuration
 * [OUTPUT]: Provides the fixed production desktop assembly, out entry selection, CSP, renderer module reports, and utility workers.
 * [POS]: Electron build entry coordinating main/preload rebuilds, process restarts, and renderer output
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { buildSync } from "esbuild";
import { defineConfig } from "electron-vite";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { Plugin, Rollup } from "vite";
import { resolveCloudAssembly } from "./config/cloud-assembly";
const cloudAssembly = resolveCloudAssembly("production");
const outputRoot = "out";
if (!process.env.ELECTRON_ENTRY)
    process.env.ELECTRON_ENTRY = `${outputRoot}/main/index.js`;
const cloudDefines = { __BOTTEGA_CLOUD_CONFIG__: JSON.stringify(cloudAssembly.config), __BOTTEGA_CLOUD_UPDATES_ENABLED__: JSON.stringify(cloudAssembly.updatesEnabled) };
const PRODUCTION_CSP = [
    "default-src 'self'",
    "frame-src http://*.localhost:*",
    "connect-src 'self' https://tile.openstreetmap.org",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
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
function auxiliaryPreload(): Plugin {
    const entry = resolve(__dirname, "electron/preload/task-panel.ts");
    return {
        name: "self-contained-task-panel-preload",
        generateBundle() {
            // Sandboxed preloads can require Electron, but cannot load sibling chunks.
            const result = buildSync({ entryPoints: [entry], bundle: true, write: false,
                platform: "node", format: "cjs", target: "node22", external: ["electron"], metafile: true,
                /* 与 main/preload 同一口味：这份也在每个面板渲染进程里常驻。 */
                minify: true, keepNames: true, legalComments: "none" });
            for (const file of Object.keys(result.metafile!.inputs))
                this.addWatchFile(resolve(file));
            this.emitFile({ type: "asset", fileName: "task-panel.js", source: result.outputFiles[0]!.text });
        },
    };
}
function chartModuleReport(): Plugin {
    const root = resolve(__dirname);
    const normalize = (path: string) => relative(root, path).split(sep).join("/");
    return {
        name: "chart-module-report",
        apply: "build",
        generateBundle(_options, bundle) {
            const chunks = Object.values(bundle).flatMap((output) => output.type === "chunk"
                ? [
                    {
                        fileName: output.fileName,
                        isEntry: output.isEntry,
                        imports: output.imports,
                        dynamicImports: output.dynamicImports,
                        moduleIds: Object.keys(output.modules).map(normalize),
                    },
                ]
                : []);
            this.emitFile({
                type: "asset",
                fileName: ".chart-module-report.json",
                source: `${JSON.stringify({ chunks }, null, 2)}\n`,
            });
        },
    };
}
/* electron-vite 把 main/preload 的 minify 默认关成 false——渲染端有包体预算，
   主进程「没人下载它」。但主进程要把自己的源码字符串背一整个生命周期，而
   V8 按双字节存：5.2 MB 的主包在堆里是 10.4 MB。压缩后源码字符串直接对折。
   keepNames 保住 `constructor.name` / `error.name` 这类按名字认人的判断，
   legalComments 把许可证注释从常驻字节里摘掉（NOTICE 由打包脚本单独生成）。 */
const NODE_MINIFY = { minify: true as const };
const NODE_ESBUILD = { keepNames: true, legalComments: "none" as const };
const onwarn: Rollup.WarningHandlerWithDefault = (warning, defaultHandler) => {
    // Zod 4.6.4 mentions pure annotations in prose; Rollup mistakes them for directives.
    const file = warning.id?.replaceAll("\\", "/").match(/\/node_modules\/zod\/v4\/core\/(util|regexes)\.js$/)?.[1];
    if (warning.code === "INVALID_ANNOTATION" && ((file === "util" && warning.message.includes("Wrapped in a `@__PURE__` IIFE: esbuild never tree-shakes")) ||
        (file === "regexes" && warning.message.includes("Anchors a pattern source. The interpolation lives here"))))
        return;
    defaultHandler(warning);
};
export default defineConfig({
    main: {
        define: cloudDefines,
        esbuild: NODE_ESBUILD,
        build: {
            ...NODE_MINIFY,
            outDir: `${outputRoot}/main`,
            /* electron-vite 5 只在显式配置 Rollup watch 时重启 main。
               缺少它会让 renderer HMR 成功、Electron 却继续执行旧 bundle。 */
            watch: {},
            externalizeDeps: {
                /* zod 是 dependencies 里的包却要打进 bundle；@modelcontextprotocol/sdk 已不是
                   dependency，externalize 插件本就不会碰它，无需再排除。 */
                exclude: ["zod", "@ai-chat/cloud-crypto", "libsodium-wrappers-sumo", "libsodium-sumo"],
            },
            rollupOptions: {
                onwarn,
                // Workers and resource helpers resolve from the main bundle directory.
                output: { chunkFileNames: "[name]-[hash].js" },
                input: {
                    index: resolve(__dirname, "electron/main/main-entry.ts"),
                    "sync-crypto-worker-entry": resolve(__dirname, "electron/main/cloud/encryption/worker-entry.ts"),
                    "builtin-tools-server": resolve(__dirname, "electron/main/tools/server.ts"),
                    "codec-host-entry": resolve(__dirname, "electron/main/bases/media-host/codec-host-entry.ts"),
                    "custody-guardian-entry": resolve(__dirname, "electron/main/custody/guardian-entry.ts"),
                    "app-gui-compiler-entry": resolve(__dirname, "electron/main/app-gui-compiler-entry.ts"),
                    "app-gui-query-worker-entry": resolve(__dirname, "electron/main/app-gui-query-worker-entry.ts"),
                    "chat-database-worker-entry": resolve(__dirname, "electron/main/chat-database-worker-entry.ts"),
                    "history-import-worker-entry": resolve(__dirname, "electron/main/history-import-worker-entry.ts"),
                },
            },
        },
    },
    preload: {
        define: cloudDefines,
        esbuild: NODE_ESBUILD,
        plugins: [auxiliaryPreload()],
        build: {
            ...NODE_MINIFY,
            outDir: `${outputRoot}/preload`,
            /* preload 变更同样必须触发 renderer full reload。生产 build 会由
               electron-vite 自动清空 watch，不会把 watcher 带进发行产物。 */
            watch: {},
            externalizeDeps: {
                exclude: ["zod"],
            },
            rollupOptions: {
                onwarn,
                input: { index: resolve(__dirname, "electron/preload/index.ts") },
            },
        },
    },
    renderer: {
        define: cloudDefines,
        root: "src",
        resolve: {
            alias: {
                "@": resolve(__dirname, "src"),
            },
        },
        plugins: [react(), tailwindcss(), { name: "maple-font-license", generateBundle() {
                    this.emitFile({ type: "asset", fileName: "licenses/maple-mono-OFL.txt", source: readFileSync(resolve(__dirname, "../../packages/ui/src/styles/fonts/OFL.txt")) });
                } }, productionCsp(), chartModuleReport()],
        build: {
            outDir: resolve(__dirname, `${outputRoot}/renderer`),
            rollupOptions: {
                onwarn,
                input: { index: resolve(__dirname, "src/index.html"), "task-panel": resolve(__dirname, "src/task-panel.html") },
            },
        },
    },
});
