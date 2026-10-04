/**
 * [INPUT]: Depends on electron-vite, Vite React/Tailwind plugins, esbuild, Node paths, Rollup diagnostics, and cloud assembly configuration
 * [OUTPUT]: Provides the fixed production desktop assembly, out entry selection, CSP, renderer module reports, and utility workers.
 * [POS]: Electron build entry coordinating main/preload rebuilds, process restarts, and renderer output
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { buildSync } from "esbuild";
import { builtinModules, createRequire } from "node:module";
import { defineConfig } from "electron-vite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { build, type Plugin, type Rollup } from "vite";
import { resolveCloudAssembly, workbenchUiFor, serverTunnelFor } from "./config/cloud-assembly";
import { NODE_ENTRY_FILES, NODE_PACKAGES, type NodeEntry } from "./electron/main/runtime/model";
const cloudAssembly = resolveCloudAssembly("production");
/* Keep offline test defaults separate from the default-on development and production UI. */
const workbenchUi = workbenchUiFor(cloudAssembly, process.env.BOTTEGA_WORKBENCH_UI);
const serverTunnel = serverTunnelFor(cloudAssembly, process.env.BOTTEGA_SERVER_TUNNEL);
/* Copied renderer assets retain their license; verify-packaged-payload checks the same list. */
const RENDERER_LICENSES = [
    ["licenses/phosphor-icons-MIT.txt", "../../packages/ui/src/components/icons/PHOSPHOR-LICENSE.txt"],
] as const;
/* The production byte gate (scripts/budget/production-gate.mjs) builds into its own root, so it never replaces the E2E build in out/. */
const outputRoot = "out";
if (!process.env.ELECTRON_ENTRY)
    process.env.ELECTRON_ENTRY = `${outputRoot}/main/index.js`;
const cloudDefines = { __BOTTEGA_SERVER_TUNNEL__: JSON.stringify(serverTunnel), __BOTTEGA_CLOUD_CONFIG__: JSON.stringify(cloudAssembly.config), __BOTTEGA_CLOUD_UPDATES_ENABLED__: JSON.stringify(cloudAssembly.updatesEnabled) };
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
/* Isolated auxiliary surfaces (notch task panel, Bottega Dock bar/panel) each get one
   self-contained preload; none of them may share a chunk with the product preload. */
const AUXILIARY_PRELOADS = ["task-panel", "system-dock", "desktop-dialog"] as const;
function auxiliaryPreload(): Plugin {
    return {
        name: "self-contained-auxiliary-preloads",
        generateBundle() {
            for (const name of AUXILIARY_PRELOADS) {
                // Sandboxed preloads can require Electron, but cannot load sibling chunks.
                const result = buildSync({ entryPoints: [resolve(__dirname, `electron/preload/${name === "desktop-dialog" ? "desktop-dialog/index" : name}.ts`)], bundle: true, write: false,
                    platform: "node", format: "cjs", target: "node22", external: ["electron"], metafile: true,
                    /* 与 main/preload 同一口味：这份也在每个辅助渲染进程里常驻。 */
                    minify: true, keepNames: true, legalComments: "none", charset: "ascii" });
                for (const file of Object.keys(result.metafile!.inputs))
                    this.addWatchFile(resolve(file));
                this.emitFile({ type: "asset", fileName: `${name}.js`, source: result.outputFiles[0]!.text });
            }
        },
    };
}
/* TASK-35: the entries a plain Node runs (the bundled Node, and Electron-as-Node until the fuses are off) are built self-contained,
   one file each with no shared chunk, and unpacked on their own; out/main/runtime-entries.json records their digests and those of
   the two ACP adapters, which the runtime port checks before every launch. */
const RUNTIME_ENTRY_SOURCES: Record<NodeEntry, string> = {
    "package-host": "electron/main/host/package/entry.ts",
    "package-provider": "electron/main/providers/bridge/entry.ts",
    "custody-guardian": "electron/main/custody/guardian-entry.ts",
    "builtin-tools-server": "electron/main/tools/server.ts",
    "codec-host": "electron/main/bases/media-host/codec-host-entry.ts",
    "app-gui-compiler": "electron/main/workers/app-gui-compiler-entry.ts",
    "process-watchdog": "electron/main/runtime/programs/watchdog-entry.ts",
    "seatbelt-measurement": "electron/main/runtime/programs/seatbelt-measurement-entry.ts",
    "repair-supervisor": "electron/main/runtime/programs/repair-supervisor-entry.ts",
};
/* A private (non-production) main input marked here is taken out of the Rollup graph and built like a runtime entry: one file a plain
   Node can run from the unpacked tree, outside the product catalog and its digests (TASK-35 slice 6). */
const selfContainedInputs = new Set<string>();
function selfContained(path: string) { selfContainedInputs.add(path); return path; }
const ADAPTER_PACKAGE_ENTRIES: Record<(typeof NODE_PACKAGES)[number], string> = {
    "claude-agent-acp": "node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
    "codex-acp": "node_modules/@agentclientprotocol/codex-acp/dist/index.js",
};
/* Evaluates a self-contained CommonJS build inside this config (the layout of the built-in Provider packages): the workspace's TypeScript
   packages cannot be imported by the config directly, and the generator needs only Node built-ins. */
function evaluateBuilt(code: string): unknown {
    const module = { exports: {} as unknown };
    const require = (id: string) => {
        if (id.startsWith("node:") || builtinModules.includes(id))
            return createRequire(__filename)(id);
        throw new Error(`the evaluated build may require only Node built-ins, not ${id}`);
    };
    new Function("module", "exports", "require", code)(module, module.exports, require);
    return module.exports;
}
function runtimeEntries(): Plugin {
    const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
    const privateEntries = new Map<string, string>();
    return {
        name: "self-contained-runtime-entries",
        options(options) {
            const input = options.input;
            if (!input || typeof input !== "object" || Array.isArray(input))
                return null;
            const kept = Object.fromEntries(Object.entries(input).filter(([name, path]) => {
                if (!selfContainedInputs.has(path))
                    return true;
                privateEntries.set(`${name}.js`, path);
                return false;
            }));
            return { ...options, input: kept };
        },
        async generateBundle() {
            /* The same externals as the main bundle: Node built-ins and runtime dependencies load from the unpacked node_modules; zod is bundled
               (Rollup, not esbuild: only Rollup tree-shakes zod 4's namespace, which otherwise adds about 450 KB to every entry). */
            const desktopPackage = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as {
                version: string;
                dependencies: Record<string, string>;
            };
            const dependencies = Object.keys(desktopPackage.dependencies).filter(name => name !== "zod");
            const external = (id: string) => id === "electron" || id.startsWith("electron/") || id.startsWith("node:") || builtinModules.includes(id.split("/")[0]!)
                || dependencies.some(name => id === name || id.startsWith(`${name}/`));
            const selfContainedCode = async (file: string, input: string) => {
                /* ssr.noExternal: Vite would otherwise externalize every node_modules package on its own, including ones that never ship. */
                const result = await build({ configFile: false, logLevel: "warn", define: cloudDefines, esbuild: ESBUILD, ssr: { noExternal: true, target: "node" },
                    build: { write: false, ssr: true, minify: "esbuild", target: "node22", rollupOptions: { onwarn, input, external: id => file.startsWith("package-")
                                ? id.startsWith("node:") || builtinModules.includes(id.split("/")[0]!) : external(id),
                            output: { format: "cjs", inlineDynamicImports: true } } } });
                const chunk = (Array.isArray(result) ? result[0]! : result as Rollup.RollupOutput).output[0];
                /* R7: a plain Node cannot read the asar, so nothing relative may stay outside the file, and Electron is never reachable. */
                const escaped = [...chunk.imports, ...chunk.dynamicImports].filter(id => id === "electron" || id.startsWith("electron/") || /^\.{1,2}\//.test(id));
                if (escaped.length)
                    this.error(`${file} must be self-contained; it still imports ${escaped.join(", ")}`);
                for (const id of chunk.moduleIds)
                    if (!id.startsWith("\0"))
                        this.addWatchFile(id);
                return chunk.code;
            };
            const selfContainedFile = async (file: string, input: string) => {
                const code = await selfContainedCode(file, input);
                this.emitFile({ type: "asset", fileName: file, source: code });
                return code;
            };
            const entries: Record<string, {
                file: string;
                sha256: string;
                bytes: number;
            }> = {};
            for (const [entry, file] of Object.entries(NODE_ENTRY_FILES) as [
                NodeEntry,
                string
            ][]) {
                const code = await selfContainedFile(file, resolve(__dirname, RUNTIME_ENTRY_SOURCES[entry]));
                entries[entry] = { file, sha256: sha256(code), bytes: Buffer.byteLength(code) };
            }
            for (const [file, input] of privateEntries)
                await selfContainedFile(file, input);
            /* Built-in Provider packages (TASK-11 d3): `providers/<id>/` with the manifest and descriptor generated from the built-in descriptors
               and the Provider's bridge module (d2: pure data and functions, so it may import nothing at all), every file pinned here. */
            const layout = evaluateBuilt(await selfContainedCode("bundled-package", resolve(__dirname, "shared/providers/bundled-package.ts"))) as typeof import("./shared/providers/bundled-package");
            const packageFiles = layout.bundledProviderPackageFiles(desktopPackage.version);
            const providerPackages: Record<string, {
                directory: string;
                files: Record<string, {
                    sha256: string;
                    bytes: number;
                }>;
            }> = {};
            const moduleSources = resolve(__dirname, "electron/main/providers/bridge/modules");
            const moduleIds = readdirSync(moduleSources).filter(name => name.endsWith(".ts")).map(name => name.slice(0, -3)).sort();
            if (moduleIds.join() !== Object.keys(packageFiles).sort().join())
                this.error(`bridge modules (${moduleIds}) and built-in Providers (${Object.keys(packageFiles)}) differ`);
            for (const providerId of moduleIds) {
                const directory = layout.bundledProviderDirectory(providerId);
                const bridge = await selfContainedCode(`${directory}/${layout.BUNDLED_BRIDGE_ENTRY}`, resolve(moduleSources, `${providerId}.ts`));
                const required = [...bridge.matchAll(/\brequire\((["'`])([^"'`]+)\1\)/g)].map(match => match[2]!);
                if (required.length)
                    this.error(`${directory}/${layout.BUNDLED_BRIDGE_ENTRY} may require nothing; it requires ${required.join(", ")}`);
                const files = { ...packageFiles[providerId], [layout.BUNDLED_BRIDGE_ENTRY]: bridge };
                providerPackages[providerId] = { directory, files: Object.fromEntries(Object.entries(files).map(([name, source]) => {
                        this.emitFile({ type: "asset", fileName: `${directory}/${name}`, source });
                        return [name, { sha256: sha256(source), bytes: Buffer.byteLength(source) }];
                    })) };
            }
            const packages = Object.fromEntries(Object.entries(ADAPTER_PACKAGE_ENTRIES).map(([name, path]) => {
                const bytes = readFileSync(resolve(__dirname, path));
                return [name, { path, sha256: sha256(bytes), bytes: bytes.byteLength }];
            }));
            this.emitFile({ type: "asset", fileName: "runtime-entries.json", source: `${JSON.stringify({ schemaVersion: 1, entries, packages, providerPackages }, null, 2)}\n` });
        },
    };
}
/* The budget gate reads which flavour produced this output: preload and main surfaces gate only the production build (2026-09-26). */
function buildFlavor(): Plugin {
    return { name: "build-flavor-marker", apply: "build", generateBundle() {
            this.emitFile({ type: "asset", fileName: "build-flavor.json", source: `${JSON.stringify({ flavor: cloudAssembly.flavor, workbenchUi })}\n` });
        } };
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
                        /* Modules left with code after tree-shaking: the flag-off check reads these (E-01). */
                        rendered: Object.entries(output.modules).filter(([, info]) => info.renderedLength > 0).map(([id]) => normalize(id)),
                    },
                ]
                : []);
            this.emitFile({
                type: "asset",
                fileName: ".chart-module-report.json",
                source: `${JSON.stringify({ flavor: cloudAssembly.flavor, workbenchUi, chunks }, null, 2)}\n`,
            });
        },
    };
}
/* One compression policy for every surface (OPT-30). electron-vite defaults every target to `minify: false`, and each
   process keeps its source strings resident for its whole life. keepNames preserves `constructor.name` / `error.name`
   checks; legalComments drops license comments from resident bytes (NOTICE is generated by the packaging script).
   `charset: "ascii"` escapes non-ASCII string content: one CJK character would otherwise make V8 hold the whole chunk
   as UTF-16. Copy is unchanged; only its encoding in the file is. esbuild leaves `String.raw` and regex literals as
   they are, so their semantics never change. */
const MINIFY = { minify: "esbuild" as const, cssMinify: true };
const ESBUILD = { keepNames: true, legalComments: "none" as const, charset: "ascii" as const };
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
        plugins: [runtimeEntries(), buildFlavor()],
        define: { ...cloudDefines,
            /* Non-production mains may load the private entries built beside them; production compiles the loader out. */
            __BOTTEGA_PRIVATE_ENTRIES__: JSON.stringify(cloudAssembly.flavor !== "production"),
            /* S3: production's application menu has no Reload / Force Reload / DevTools; stable and staging keep Electron's default. */
            __BOTTEGA_DEVELOPER_MENU__: JSON.stringify(cloudAssembly.flavor !== "production") },
        esbuild: ESBUILD,
        build: {
            ...MINIFY,
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
                    ...(serverTunnel ? { "server-tunnel-entry": resolve(__dirname, "electron/main/apps/gateway/tunnel/entry.ts") } : {}),
                    index: resolve(__dirname, "electron/main/main-entry.ts"),
                    "sync-crypto-worker-entry": resolve(__dirname, "electron/main/cloud/encryption/worker-entry.ts"),
                    "utility-host-entry": resolve(__dirname, "electron/main/host/entry.ts"),
                    "provider-bridge-entry": resolve(__dirname, "electron/main/providers/bridge/entry.ts"),
                    "app-gui-query-worker-entry": resolve(__dirname, "electron/main/workers/app-gui-query-worker-entry.ts"),
                    "chat-database-worker-entry": resolve(__dirname, "electron/main/workers/chat-database-worker-entry.ts"),
                    "history-import-worker-entry": resolve(__dirname, "electron/main/workers/history-import-worker-entry.ts"),
                },
            },
        },
    },
    preload: {
        define: cloudDefines,
        esbuild: ESBUILD,
        plugins: [auxiliaryPreload()],
        build: {
            ...MINIFY,
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
        define: { ...cloudDefines, __BOTTEGA_WORKBENCH_UI__: JSON.stringify(workbenchUi) },
        esbuild: ESBUILD,
        root: "src",
        resolve: {
            alias: {
                "@": resolve(__dirname, "src"),
            },
        },
        plugins: [react(), tailwindcss(), { name: "renderer-licenses", generateBundle() {
                    /* MIT requires the notice with the copied Phosphor glyphs. */
                    for (const [fileName, source] of RENDERER_LICENSES)
                        this.emitFile({ type: "asset", fileName, source: readFileSync(resolve(__dirname, source)) });
                } }, productionCsp(), chartModuleReport()],
        build: {
            ...MINIFY,
            outDir: resolve(__dirname, `${outputRoot}/renderer`),
            rollupOptions: {
                onwarn,
                input: { index: resolve(__dirname, "src/index.html"), "task-panel": resolve(__dirname, "src/task-panel.html"),
                    "system-dock-bar": resolve(__dirname, "src/system-dock-bar.html"), "system-dock-panel": resolve(__dirname, "src/system-dock-panel.html") },
            },
        },
    },
});
