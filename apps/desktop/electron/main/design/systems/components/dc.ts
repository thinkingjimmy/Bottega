/**
 * [INPUT]: Fixed captured component graph, immutable system values, locked esbuild and verified document runtime.
 * [OUTPUT]: compileDcComponent emits shared no-auto-mount React18 exports, native preview and actual opaque mount evidence.
 * [POS]: Native DC target; separate from standalone React19 compilation and its evidence.
 */
import { posix } from "node:path";
import type { Plugin } from "esbuild";
import type { DesignSystem, SystemComponent } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { nativeEditorAssets } from "../../../artifacts/render/native/assets";
import { designDigest, DesignDocumentError } from "../../documents/model";
import { captureDesignCanvas } from "../../tooling/render-check";
import { escapeHtml } from "../files";
import { capturedComponentInputs, capturedComponentProps } from "./captured";
import { dcConnectedGraph, dcRelativeModule, dcSourceLoader } from "./graph";
import { dcRuntimeShim, dcComponentBootstrap, dcCachedModule, dcGlobalName } from "./dc-bridge";
const react19 = /\b(?:useActionState|useOptimistic|useFormStatus|useEffectEvent|useEffectEventImpl)\b|\b(?:React|react)\s*\.\s*use\s*\(/;
export async function compileDcComponent(system: DesignSystem, component: SystemComponent,
  archive: readonly { path: string; data: Uint8Array }[], props: Record<string, unknown>, systemId: string) {
  if (!systemId) throw new DesignDocumentError("INVALID_DOCUMENT", "Native DC compilation needs its main-owned system identity");
  const esbuild = await import("esbuild");
  if (esbuild.version !== "0.28.1") throw new DesignDocumentError("NOT_READY", "Locked esbuild@0.28.1 is unavailable");
  const input = capturedComponentInputs(system, [component], archive), { components, paths } = await dcConnectedGraph(system, component, input);
  for (const path of paths) if (/\.[cm]?[jt]sx?$/i.test(path) && react19.test(input.load(path).toString("utf8")))
    throw new DesignDocumentError("INVALID_DOCUMENT", "React19-only APIs are unsupported by the native React18 target: " + path);
  const graph = designDigest(JSON.stringify([systemId, designDigest(input.files.get("tokens.css") ?? new Uint8Array()), components.map(value => [value.name, value.entry, value.exportName]),
    [...input.sources.values()].filter(value => paths.has(value.path)).map(value => [value.path, value.digest]).sort((a, b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)]));
  const plugin: Plugin = { name: "captured-native-dc", setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      const entry = /^dc-entry:(\d+)$/.exec(args.path);
      if (entry) return { path: components[Number(entry[1])]!.entry, namespace: "dc-source" };
      if (["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"].includes(args.path)) return { path: args.path, namespace: "dc-runtime" };
      if (args.path === "react-dom/client") return { errors: [{ text: "Native DC components cannot create or hydrate roots; react-dom/client is unsupported" }] };
      if (args.namespace !== "dc-source") return { errors: [{ text: "Unlisted DC compiler import" }] };
      if (args.kind === "url-token" && /^data:(?:image|font)\/[a-z0-9.+-]+(?:;|,)/i.test(args.path)) return { path: args.path, external: true };
      if ((!args.path.startsWith(".") && !/\.css$/i.test(args.importer)) || /^(?:[a-z]+:|\/|\\)/i.test(args.path))
        return { errors: [{ text: "Only captured relative modules and the document React18 are allowed: " + args.path.slice(0, 200) }] };
      const match = dcRelativeModule(input, args.importer, args.path);
      return match ? { path: match, namespace: "dc-source" } : { errors: [{ text: "Missing captured DC dependency: " + args.path }] };
    });
    build.onLoad({ filter: /.*/, namespace: "dc-source" }, args => {
      if (/\.[cm]?[jt]sx?$/i.test(args.path) && react19.test(input.load(args.path).toString("utf8")))
        throw new DesignDocumentError("INVALID_DOCUMENT", "React19-only APIs are unsupported by the native React18 target: " + args.path);
      return { contents: input.load(args.path), loader: dcSourceLoader(args.path) };
    });
    build.onLoad({ filter: /.*/, namespace: "dc-runtime" }, args => ({ contents: dcRuntimeShim(args.path), loader: "js" }));
  } };
  const context = await esbuild.context({ stdin: { contents: dcComponentBootstrap(components, graph), sourcefile: "native-dc.tsx", loader: "tsx", resolveDir: "/" },
    bundle: true, write: false, format: "cjs", platform: "browser", target: "es2022", jsx: "automatic", minify: true,
    define: { "process.env.NODE_ENV": '"production"' }, outdir: "/bottega-dc-component", plugins: [plugin], logLevel: "silent" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const built = await Promise.race([context.rebuild(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { void context.cancel(); reject(new DesignDocumentError("NOT_READY", "Captured native DC compilation timed out")); }, 15_000); timer.unref();
    })]);
    const javascript = built.outputFiles?.find(file => /\.js$/.test(file.path)), css = built.outputFiles?.find(file => /\.css$/.test(file.path));
    if (!javascript || javascript.contents.length > 6 * 1024 * 1024 || (css?.contents.length ?? 0) > 2 * 1024 * 1024)
      throw new DesignDocumentError("BUDGET_EXCEEDED", "Native DC component output exceeds its budget");
    const runtime = (await nativeEditorAssets()).get("artifact-type/dc-runtime.js"), tokens = input.files.get("tokens.css");
    if (!runtime || !tokens) throw new DesignDocumentError("NOT_READY", "Verified native runtime or exact system values are unavailable");
    const runtimeDigest = designDigest(runtime), stem = "dc-" + graph.slice(7, 27), basename = stem + "-" + designDigest(component.name).slice(7, 15);
    const bundle = "components/" + stem + ".js", stylesheet = css ? "components/" + stem + ".css" : undefined,
      runtimeFile = "components/dc-runtime-" + runtimeDigest.slice(7, 19) + ".js", preview = "components/" + basename + ".html", evidence = "components/" + basename + ".png";
    const code = Buffer.from(dcCachedModule(javascript.text, graph)), componentProps = capturedComponentProps(props);
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + escapeHtml(component.name) + '</title><link rel="stylesheet" href="../tokens.css">' +
      (stylesheet ? '<link rel="stylesheet" href="./' + stem + '.css">' : "") + '<script>window.__resources={};window.__dcSourcePath='+JSON.stringify(preview+'.dc.html')+';</script><script src="./' + posix.basename(runtimeFile) + '"></script></head><body><x-dc><x-import from="./' + stem + '.js" component="' +
      escapeHtml(component.name) + '" data-bottega-props="{{componentProps}}"></x-import></x-dc><script type="text/x-dc" data-dc-script>class Component extends DCLogic{renderVals(){return{componentProps:' + componentProps.literal + '};}}</script></body></html>';
    const files = [{ path: bundle, data: code }, { path: preview, data: Buffer.from(html) }, { path: runtimeFile, data: Buffer.from(runtime) },
      ...(css && stylesheet ? [{ path: stylesheet, data: Buffer.from(css.contents) }] : [])];
    const toData = (mime: string, data: Uint8Array) => "data:" + mime + ";base64," + Buffer.from(data).toString("base64");
    let offlineTokens = tokens.toString("utf8");
    offlineTokens = offlineTokens.replaceAll(/url\("([^"]+)"\)/g, (match, path: string) => {
      const bytes = input.files.get(path); return bytes ? 'url("' + toData("font/" + (/\.woff2$/i.test(path) ? "woff2" : "woff"), bytes) + '")' : match;
    });
    const renderHtml = html.replace("../tokens.css", toData("text/css", Buffer.from(offlineTokens)))
      .replace("./" + posix.basename(runtimeFile), toData("text/javascript", runtime))
      .replace("./" + stem + ".js", toData("text/javascript", code))
      .replace("./" + stem + ".css", toData("text/css", css?.contents ?? new Uint8Array()));
    const rendered = await captureDesignCanvas({ html: renderHtml, viewport: "desktop", size: { width: 1200, height: 900 }, format: "png",
      native: true, readySelector: '[data-bottega-dc-mounted="1"]', maxImageBytes: 4 * 1024 * 1024, signal: AbortSignal.timeout(30_000) });
    const png = Buffer.from(rendered.data, "base64"); files.push({ path: evidence, data: png });
    return { preview, files, component: { ...component, dc: { status: "ready" as const, reason: "Captured source mounted through the native document React18 singleton",
      systemId, runtime: "react@18.3.1" as const, compiler: "esbuild@0.28.1" as const, runtimeFile, runtimeDigest, graphDigest: graph, bundle, bundleDigest: designDigest(code),
      previewDigest: designDigest(html), propsDigest: componentProps.digest, exportName: component.name, globalName: dcGlobalName(component, graph), preview, ...(stylesheet && css ? { stylesheet, stylesheetDigest: designDigest(css.contents) } : {}),
      evidence: { file: evidence, digest: designDigest(png), styleDigest: designDigest(tokens), width: rendered.width, height: rendered.height } } } };
  } finally { clearTimeout(timer); await context.dispose(); }
}
