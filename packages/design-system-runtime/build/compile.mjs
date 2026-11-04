/**
 * [INPUT]: Verified maintained source, existing exact Canvas build dependencies, original legal helper and React 18 preview files.
 * [OUTPUT]: Deterministic isolated React 19 library/CSS, separate React 18 preview resources and full source/dependency notices.
 * [POS]: Internal Design System source compiler; it does not install a host or publish an editor.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const sha = data => createHash("sha256").update(data).digest("hex");
export async function compile(root, source) {
  const require = createRequire(resolve(root, "../canvas-runtime/package.json"));
  const { build } = require("esbuild");
  const packageRoot = name => dirname(require.resolve(name + "/package.json"));
  const version = name => JSON.parse(readFileSync(join(packageRoot(name), "package.json"), "utf8")).version;
  if (version("react") !== "19.3.0" || version("react-dom") !== "19.3.0" || version("react-18") !== "18.3.1" || version("react-dom-18") !== "18.3.1") throw new Error("Design System React isolation versions changed");
  const output = join(root, "dist"), entry = join(root, ".build/entry.ts");
  rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
  writeFileSync(entry, `import ${JSON.stringify(join(source, "packages/design-system-runtime/src/app.css"))};\nimport {createDesignSystemRuntime} from ${JSON.stringify(join(source, "packages/design-system-runtime/src/runtime.ts"))};\nimport {installSystemHost} from ${JSON.stringify(join(root,"build/host.ts"))};\ninstallSystemHost();createDesignSystemRuntime();\n`);
  const result = await build({ entryPoints: [entry], outfile: join(output, "runtime.js"), absWorkingDir: root,
    bundle: true, format: "esm", platform: "browser", target: "es2022", jsx: "automatic", minify: true,
    legalComments: "inline", metafile: true, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' },
    alias: { react: packageRoot("react"), "react-dom": packageRoot("react-dom") },
    nodePaths: [resolve(root, "../canvas-runtime/node_modules")] });
  const inputs = Object.keys(result.metafile.inputs).map(path => resolve(root, path));
  const reactRoots = new Set(inputs.filter(path => /[/\\]react[/\\](?:cjs[/\\]|index\.js|jsx-runtime\.js)/.test(path)).map(path => path.slice(0, path.lastIndexOf("/react/") + 7)));
  if (reactRoots.size !== 1) throw new Error("Design System editor has multiple React instances");
  writeFileSync(join(output, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="runtime.css"></head><body><div id="root"></div><script type="module" src="runtime.js"></script></body></html>');
  const vendor = join(output, "artifact-type/vendor"); mkdirSync(vendor, { recursive: true });
  const vendorInputs = [];
  for (const name of ["react", "react-dom"]) {
    const path = join(packageRoot(name + "-18"), "umd", name + ".production.min.js"); vendorInputs.push(path);
    copyFileSync(path, join(vendor, name + ".production.min.js"));
  }
  mkdirSync(join(output, "artifact-type"), { recursive: true });
  // The unchanged preview runner is fixed independently of the maintained TypeScript runtime.
  const previewSource = resolve(root, "source/preview-run.html");
  copyFileSync(previewSource, join(output, "artifact-type/run.html"));
  const { bundledPackageDirs, thirdPartyLicenses } = await import(pathToFileURL(join(source, "apps/design-system-editor/licenses.mjs")));
  const notices = thirdPartyLicenses(bundledPackageDirs([...inputs, ...vendorInputs]));
  writeFileSync(join(output, "third-party-licenses.txt"), notices + "\n" + readFileSync(join(root, "LICENSE"), "utf8") + "\n" +
    readFileSync(join(root, "licenses/THIRD_PARTY_NOTICES.md"), "utf8") + "\nLucide SVG controls:\n" + readFileSync(join(root, "licenses/lucide-ISC.txt"), "utf8"));
  const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(directory, item.name)) : [join(directory, item.name)]);
  const outputs = walk(output).sort().map(file => { const data = readFileSync(file); return { path: file.slice(output.length + 1).replaceAll("\\", "/"), bytes: data.length, sha256: sha(data) }; });
  if (/@font-face\s*\{[^}]*(?:Anthropicons|FizzyLake)/i.test(readFileSync(join(output, "runtime.css"), "utf8"))) throw new Error("Excluded editor font in Design System output");
  return { outputs, editorReact: "19.3.0", previewReact: "18.3.1" };
}
