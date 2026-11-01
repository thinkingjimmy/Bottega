/**
 * [INPUT]: Verified Slides source, original guarded PptxGenJS extensions and pinned dependencies.
 * [OUTPUT]: Lazy browser editor, inert boot:false Node compiler and complete original license notices.
 * [POS]: Maintained Slides compiler; authored input is parsed as data and never evaluated by the Node compiler.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "vite";
import { build as bundle } from "esbuild";
export async function compile(root, source) {
  const runtime = join(source, "packages/slides-runtime"), src = join(runtime, "src"), editor = join(source, "apps/slides-editor"), output = join(root, "dist");
  const { patchPptxgenjs, pptxgenjsDistFile } = await import(pathToFileURL(join(runtime, "patches/pptxgenjs.mjs")));
  const { thirdPartyLicenses, bundledPackageDirs } = await import(pathToFileURL(join(editor, "licenses.mjs")));
  const notices = "\n" + readFileSync(join(root, "LICENSE"), "utf8") + "\n" + readFileSync(join(root, "licenses/lucide-ISC.txt"), "utf8") +
    "\nUpstream source notices (including source references):\n" + readFileSync(join(root, "licenses/THIRD_PARTY_NOTICES.md"), "utf8");
  const extensions = { name: "maintained-slides-extensions", load(id) {
    const file = pptxgenjsDistFile(id); return file ? patchPptxgenjs(readFileSync(id.replace(/\?.*$/, ""), "utf8"), file) : null;
  }, generateBundle() {
    this.emitFile({ type: "asset", fileName: "third-party-licenses.txt", source: thirdPartyLicenses(bundledPackageDirs(this.getModuleIds())) + notices });
  } };
  writeFileSync(join(editor, "src/main.ts"), [
    "import " + JSON.stringify(join(src, "app.css")) + ";",
    "import {createSlidesRuntime} from " + JSON.stringify(join(src, "index.ts")) + ";",
    "import {installDesignEditorHost} from " + JSON.stringify(join(root, ".build/host.ts")) + ";",
    "import {installNativeExportRuntime} from " + JSON.stringify(resolve(root, "../canvas-runtime/adapters/export-runtime.ts")) + ";",
    "import {installNativePresentationRuntime} from " + JSON.stringify(join(src, "adapters/presentation.ts")) + ";",
    "installDesignEditorHost('slides');const runtime=createSlidesRuntime();installNativeExportRuntime(runtime,'slides');installNativePresentationRuntime();",
  ].join("\n"));
  await build({ configFile: false, root: editor, base: "./", logLevel: "warn", plugins: [extensions],
    resolve: { dedupe: ["react", "react-dom"] }, esbuild: { jsx: "automatic", jsxImportSource: "react" },
    build: { target: "es2022", outDir: output, emptyOutDir: true, chunkSizeWarningLimit: 16000,
      rollupOptions: { onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); } } } });
  await bundle({ stdin: { contents: "import {createSlidesRuntime} from " + JSON.stringify(join(src, "index.ts")) + ";import {startSlidesViewer} from " + JSON.stringify(join(root, "adapters/viewer.tsx")) + ";startSlidesViewer(createSlidesRuntime({boot:false})).catch(cause=>{document.documentElement.setAttribute('data-bottega-render-error',String(cause?.message||cause));throw cause});",
    resolveDir: root, sourcefile: "slides-viewer-entry.ts", loader: "ts" }, outfile: join(output, "artifact-type/slides-runtime.js"), bundle: true,
    platform: "browser", format: "iife", target: "es2022", jsx: "automatic", jsxImportSource: "react", minify: false, legalComments: "inline", logLevel: "error",
    plugins: [{ name: "slides-viewer-original-pptx-extensions", setup(build) {
      build.onLoad({ filter: /[\\/]pptxgenjs[\\/]dist[\\/][^\\/]+\.js$/ }, args => {
        const file = pptxgenjsDistFile(args.path); return file ? { contents: patchPptxgenjs(readFileSync(args.path, "utf8"), file), loader: "js" } : undefined;
      });
    } }] });
  const compiler = await bundle({ stdin: { contents: "import {createSlidesRuntime} from " + JSON.stringify(join(src, "index.ts")) + ";export const runtime=createSlidesRuntime({boot:false});",
    resolveDir: root, sourcefile: "slides-compiler-entry.ts", loader: "ts" }, bundle: true, outfile: join(output, "node/compiler.cjs"), platform: "node", format: "cjs", target: "es2022",
    jsx: "automatic", jsxImportSource: "react", loader: { ".css": "empty", ".woff2": "empty" }, absWorkingDir: root, metafile: true, logLevel: "error",
    define: { "process.env.NODE_ENV": JSON.stringify("production") }, plugins: [{ name: "slides-original-pptx-extensions", setup(build) {
      build.onLoad({ filter: /[\\/]pptxgenjs[\\/]dist[\\/][^\\/]+\.js$/ }, args => {
        const file = pptxgenjsDistFile(args.path); return file ? { contents: patchPptxgenjs(readFileSync(args.path, "utf8"), file), loader: "js" } : undefined;
      });
    } }] });
  writeFileSync(join(output, "node/third-party-licenses.txt"), thirdPartyLicenses(bundledPackageDirs(Object.keys(compiler.metafile.inputs).map(path => resolve(root, path)))) + notices);
  const walk = directory => readdirSync(join(output, directory), { withFileTypes: true }).flatMap(entry => {
    const path = directory ? directory + "/" + entry.name : entry.name; return entry.isDirectory() ? walk(path) : [path];
  });
  return walk("").sort().map(path => { const data = readFileSync(join(output, path));
    if (/\.(?:css|js|cjs)$/.test(path) && /@font-face\s*\{[^}]*(?:Anthropicons|FizzyLake|SplitCaret)/i.test(data.toString())) throw new Error("Excluded UI font in Slides output");
    return { path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), browser: !path.startsWith("node/") };
  });
}
