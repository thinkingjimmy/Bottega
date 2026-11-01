/**
 * [INPUT]: Digest-verified captured component inputs, explicit target, fixed local React/esbuild and the existing opaque offline renderer.
 * [OUTPUT]: Separate standalone React19 or native DC React18 compilation, fixed bundle/style/preview bytes and actual mount evidence.
 * [POS]: System component compiler; source modules never execute in the main process or install dependencies.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import type { Plugin, Loader } from "esbuild";
import type { DesignSystem, SystemComponent } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { designDigest, DesignDocumentError, sourcePath } from "../documents/model";
import { captureDesignCanvas } from "../tooling/render-check";
import { capturedComponentInputs, capturedComponentProps } from "./components/captured";
import { escapeHtml } from "./files";

const require = createRequire(import.meta.url);
const byteLimit = 6 * 1024 * 1024;
function dependencyPath(path: string) {
  const unpacked = path.replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  return existsSync(unpacked) ? unpacked : path;
}
function loaderFor(path: string): Loader {
  const extension = posix.extname(path).toLowerCase();
  return ({ ".tsx": "tsx", ".ts": "ts", ".jsx": "jsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".json": "json", ".css": "css" } as Record<string, Loader>)[extension] ?? "dataurl";
}
export async function compileSystemComponent(system: DesignSystem, component: SystemComponent,
  archive: readonly { path: string; data: Uint8Array }[], props: Record<string, unknown> = {}, target: "standalone" | "dc" = "standalone", systemId = "") {
  if (target === "dc") return (await import("./components/dc")).compileDcComponent(system, component, archive, props, systemId);
  const esbuild = await import("esbuild");
  const versions = ["react", "react-dom", "esbuild"] as const, expected = ["19.2.4", "19.2.4", "0.28.1"];
  const trustedRoots: string[] = [];
  for (const [index, name] of versions.entries()) {
    const manifestFile = dependencyPath(require.resolve(`${name}/package.json`));
    const metadata = JSON.parse(await readFile(manifestFile, "utf8"));
    if (metadata.version !== expected[index]) throw new DesignDocumentError("NOT_READY", `Locked ${name}@${expected[index]} is unavailable. No dependency was installed.`);
    if (name !== "esbuild") trustedRoots.push(await realpath(dirname(manifestFile)));
  }
  const reactDomRequire = createRequire(require.resolve("react-dom/package.json"));
  trustedRoots.push(await realpath(dirname(dependencyPath(reactDomRequire.resolve("scheduler/package.json")))));
  const trusted = (path: string) => trustedRoots.some(root => path === root || path.startsWith(root + sep));
  const { sources: sourceMap, files: fileMap, load: sourceLoader } = capturedComponentInputs(system, [component], archive);
  const plugin: Plugin = {
    name: "captured-design-system",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async args => {
        if (args.path === "__bottega_captured_component__") return { path: component.entry, namespace: "design-source" };
        if (/^(?:react(?:\/jsx(?:-dev)?-runtime)?|react-dom(?:\/client)?|scheduler)$/.test(args.path)) {
          const resolver = args.path === "scheduler" ? reactDomRequire : args.namespace === "design-runtime" ? createRequire(args.importer) : require;
          const path = await realpath(dependencyPath(resolver.resolve(args.path)));
          if (!trusted(path)) return { errors: [{ text: "React dependency is outside the locked runtime" }] };
          return { path, namespace: "design-runtime" };
        }
        if (args.namespace === "design-runtime") {
          if (!args.path.startsWith(".")) return { errors: [{ text: `Unlisted runtime dependency: ${args.path}` }] };
          const path = await realpath(resolve(dirname(args.importer), args.path)).catch(() => null);
          if (!path || !trusted(path)) return { errors: [{ text: "Runtime dependency leaves the locked package" }] };
          return { path, namespace: "design-runtime" };
        }
        if (args.namespace === "design-source") {
          if (args.kind === "url-token" && /^data:(?:image|font)\/[a-z0-9.+-]+(?:;|,)/i.test(args.path)) return { path: args.path, external: true };
          const isCss = /\.css$/i.test(args.importer);
          if ((!args.path.startsWith(".") && !isCss) || /^(?:[a-z]+:|\/|\\)/i.test(args.path)) return { errors: [{ text: `Only captured relative modules and locked React are allowed: ${args.path.slice(0, 200)}` }] };
          const path = posix.normalize(posix.join(posix.dirname(args.importer), args.path));
          if (!sourcePath.safeParse(path).success) return { errors: [{ text: "Import leaves the captured path contract" }] };
          const candidates = [path, ...[".tsx", ".ts", ".jsx", ".js", ".json", ".css", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"].map(suffix => path + suffix)];
          const match = candidates.find(candidate => sourceMap.has(candidate));
          if (!match) return { errors: [{ text: `Missing captured dependency: ${path}` }] };
          return { path: match, namespace: "design-source" };
        }
        return { errors: [{ text: `Unexpected compiler import: ${args.path}` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "design-source" }, args => ({ contents: sourceLoader(args.path), loader: loaderFor(args.path) }));
      build.onLoad({ filter: /.*/, namespace: "design-runtime" }, async args => {
        const path = await realpath(args.path), metadata = await lstat(path);
        if (!trusted(path) || !metadata.isFile() || metadata.isSymbolicLink() || metadata.size > byteLimit) throw new DesignDocumentError("PATH_DENIED", "Runtime package file is not bounded ordinary data");
        return { contents: await readFile(path), loader: "js" };
      });
    },
  };
  const bootstrap = [
    "import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';",
    "import * as Source from '__bottega_captured_component__';",
    `const Component = Source[${JSON.stringify(component.exportName)}];`,
    `const props = ${capturedComponentProps(props).literal};`,
    "if(!Component) throw new Error('Selected component export is missing');",
    "const mount=document.getElementById('system-component-root');",
    "try{flushSync(()=>createRoot(mount,{onUncaughtError:error=>console.error(String(error))}).render(React.createElement(Component,props)));",
    "if(!mount.firstChild) throw new Error('Component produced no mounted content'); mount.dataset.mounted='1';}",
    "catch(error){console.error('Component did not mount: '+String(error)); throw error;}",
  ].join("\n");
  const context = await esbuild.context({ stdin: { contents: bootstrap, sourcefile: "system-component.tsx", loader: "tsx", resolveDir: "/" },
    bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic", minify: true,
    define: { "process.env.NODE_ENV": '"production"' }, outdir: "/bottega-compiled-system", plugins: [plugin], logLevel: "silent" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const built = await Promise.race([context.rebuild(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { void context.cancel(); reject(new DesignDocumentError("NOT_READY", "Controlled component compilation timed out")); }, 15000); timer.unref();
    })]);
    const script = built.outputFiles?.find(file => /\.js$/.test(file.path)), css = built.outputFiles?.find(file => /\.css$/.test(file.path));
    if (!script || script.contents.length > byteLimit || (css?.contents.length ?? 0) > 2 * 1024 * 1024) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete component bundle exceeds its budget");
    const basename = component.name.toLowerCase().replaceAll(".", "-") + "-" + designDigest(JSON.stringify([component.name, component.entry])).slice(7, 15);
    const bundle = `components/${basename}.js`, preview = `components/${basename}.html`, evidence = `components/${basename}.png`, stylesheet = `components/${basename}.css`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(component.name)}</title><link rel="stylesheet" href="../tokens.css">${css ? `<link rel="stylesheet" href="${basename}.css">` : ""}</head><body><div id="system-component-root"></div><script src="${basename}.js"></script></body></html>`;
    const files = [{ path: bundle, data: Buffer.from(script.contents) }, { path: preview, data: Buffer.from(html) }, ...(css ? [{ path: stylesheet, data: Buffer.from(css.contents) }] : [])];
    const tokensCss = fileMap.get("tokens.css"); if (!tokensCss) throw new DesignDocumentError("INVALID_DOCUMENT", "Generated tokens.css is missing");
    const offlineStyle = tokensCss.toString("utf8").replaceAll(/url\("([^"]+)"\)/g, (match, path: string) => {
      const data = fileMap.get(path); return data ? `url("data:font/${/\.woff2$/i.test(path) ? "woff2" : "woff"};base64,${data.toString("base64")}")` : match;
    });
    const guardedScript = Buffer.from(script.contents).toString("base64"), guardedCss = css ? Buffer.from(css.contents).toString("base64") : "";
    const renderHtml = html.replace('<link rel="stylesheet" href="../tokens.css">', `<link rel="stylesheet" href="data:text/css;base64,${Buffer.from(offlineStyle).toString("base64")}">`)
      .replace(`src="${basename}.js"`, `src="data:application/javascript;base64,${guardedScript}"`)
      .replace(`href="${basename}.css"`, `href="data:text/css;base64,${guardedCss}"`);
    const rendered = await captureDesignCanvas({ html: renderHtml, viewport: "desktop", size: { width: 1200, height: 900 },
      format: "png", maxImageBytes: 4 * 1024 * 1024, signal: AbortSignal.timeout(30000) });
    const png = Buffer.from(rendered.data, "base64"); files.push({ path: evidence, data: png });
    return { preview, component: { ...component, mode: "mounted" as const, reason: "Actual source export mounted in the opaque no-network renderer", bundle, preview,
      bundleDigest: designDigest(script.contents), evidence: { file: evidence, digest: designDigest(png), styleDigest: designDigest(tokensCss), width: rendered.width, height: rendered.height,
        runtime: "react@19.2.4" as const, compiler: "esbuild@0.28.1" as const } }, files };
  } finally { clearTimeout(timer); await context.dispose(); }
}
