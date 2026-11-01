/**
 * [INPUT]: Verified maintained sources and exact workspace dependency lock.
 * [OUTPUT]: Lazy editor, document React 18 runtime, injected scripts and complete dependency and upstream source notices.
 * [POS]: Maintained Canvas browser compiler; editor React is isolated from host and document runtimes.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build as bundle } from "esbuild";
import { build } from "vite";
export async function compile(root, source, fontLibrary) {
  const runtime = join(source, "packages/design-runtime"), src = join(runtime, "src"), generated = join(src, "generated");
  const editor = join(source, "apps/design-editor"), output = join(root, "dist"), req = createRequire(join(root, "package.json"));
  const packageDir = name => resolve(req.resolve(name + "/package.json"), "..");
  mkdirSync(generated, { recursive: true });
  const bundled = new Set();
  async function script(entry, filename, options = {}) {
    const result = await bundle({ entryPoints: [join(src, entry)], outfile: join(generated, filename), absWorkingDir: root,
      bundle: true, jsx: "automatic", jsxImportSource: "react", format: "iife", platform: "browser", target: "es2022", minify: false, legalComments: "inline", metafile: true, logLevel: "error", ...options });
    for (const input of Object.keys(result.metafile.inputs)) bundled.add(resolve(root, input));
  }
  for (const file of readdirSync(join(src, "scripts")).filter(file => /\.tsx?$/.test(file)).sort())
    await script("scripts/" + file, file.replace(/\.tsx?$/, ".js"));
  const marker = { js: "try{window.__dcHostRuntime=true}catch{};" };
  await script("runtime/support-entry.ts", "support.js", { banner: marker });
  for (const [name, path] of [["react", join(packageDir("react-18"), "umd/react.production.min.js")],
    ["react-dom", join(packageDir("react-dom-18"), "umd/react-dom.production.min.js")],
    ["babel.min", join(packageDir("@babel/standalone"), "babel.min.js")]]) {
    copyFileSync(path, join(generated, name + ".js")); bundled.add(path);
  }
  await script("runtime/index.tsx", "dc-runtime.js", { banner: marker, alias: { react: packageDir("react-18"), "react-dom": packageDir("react-dom-18") } });
  const { workerBrowserPlugin } = await import(pathToFileURL(join(runtime, "tools/worker-browser-plugin.mjs")));
  await script("worker/sandbox.ts", "fast-edit-worker.js", { plugins: [workerBrowserPlugin()] });
  const { thirdPartyLicenses, bundledPackageDirs } = await import(pathToFileURL(join(editor, "licenses.mjs")));
  mkdirSync(join(editor, "src"), { recursive: true });
  writeFileSync(join(editor, "src/main.ts"), `import ${JSON.stringify(join(src, "app.css"))};\nimport {createDesignRuntime} from ${JSON.stringify(join(src, "app-runtime.ts"))};\nimport {initializeThemeFromSystem} from ${JSON.stringify(join(src, "bootstrap/theme.ts"))};\nimport {installDesignEditorHost} from ${JSON.stringify(join(root, "build/host.ts"))};\nimport {installNativeExportRuntime} from ${JSON.stringify(join(root, "adapters/export-runtime.ts"))};\ninstallDesignEditorHost();initializeThemeFromSystem();const runtime=createDesignRuntime();installNativeExportRuntime(runtime,"canvas");\n`);
  let html = readFileSync(join(editor, "index.html"), "utf8");
  html = html.replace("appifact_extra_export_formats:window.parent===window", "appifact_extra_export_formats:true");
  writeFileSync(join(editor, "index.html"), html);
  await build({ configFile: false, root: editor, base: "./", logLevel: "warn", esbuild: { jsx: "automatic", jsxImportSource: "react" }, build: { target: "es2022", outDir: output, emptyOutDir: true, chunkSizeWarningLimit: 16000,
    rollupOptions: { onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); } } }, plugins: [{ name: "canvas-runtime-assets", generateBundle() {
      for (const filename of ["dc-runtime.js", "babel.min.js", "fast-edit-worker.js"])
        this.emitFile({ type: "asset", fileName: "artifact-type/" + filename, source: readFileSync(join(generated, filename)) });
      for (const file of fontLibrary.files) this.emitFile({ type: "asset", fileName: file.path, source: file.data });
      const licenses = thirdPartyLicenses(bundledPackageDirs([...this.getModuleIds(), ...bundled]));
      this.emitFile({ type: "asset", fileName: "third-party-licenses.txt", source: licenses + "\n" + readFileSync(join(root, "LICENSE"), "utf8") + "\nUpstream source notices (including source references):\n" + readFileSync(join(root, "licenses/THIRD_PARTY_NOTICES.md"), "utf8") + "\nFixed source font library:\n" + readFileSync(join(root, "fonts/LICENSE.txt"), "utf8") });
    } }] });
  const files = [...readdirSync(output).filter(name => !["assets", "artifact-type", "font-library"].includes(name)),
    ...["assets", "artifact-type", "font-library"].flatMap(dir => readdirSync(join(output, dir)).map(name => dir + "/" + name))].sort();
  for (const file of files.filter(file => file.endsWith(".css"))) if (/@font-face\s*\{[^}]*(?:Anthropicons|FizzyLake|SplitCaret)/i.test(readFileSync(join(output, file), "utf8")))
    throw new Error("Excluded native font found in Canvas output");
  return files.map(path => { const data = readFileSync(join(output, path)); return { path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") }; });
}
