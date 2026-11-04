/**
 * [INPUT]: Immutable Dashboard source, syntax-aware resource spans and verified runtime assets.
 * [OUTPUT]: Validated closed page/blob resources and an offline page document for an opaque frame.
 * [POS]: Dashboard main-side read boundary; authored source is parsed and rewritten, never executed.
 */
import { parse, parseFragment, serialize, defaultTreeAdapter, type DefaultTreeAdapterMap } from "parse5";
import { posix } from "node:path";
import { readDashboardSource } from "@ai-chat/cloud-protocol/artifacts/design/dashboard/model";
import { artifactMime } from "../../artifacts/admission/files";
import { designDigest, DESIGN_LIMITS } from "../documents/model";
import { designResourceReferences, inlineDesignTextResources } from "../documents/resources/references";
import { rewriteReferences } from "../documents/resources/types";
type Member = { path: string; data: Uint8Array };
export async function dashboardResources(files: readonly Member[], documentId: string) {
  const source = readDashboardSource(files, documentId), members = new Map(files.map(file => [file.path, file.data]));
  const mime = new Map<string, string>();
  const resources = new Map(Object.entries(source.sourceFiles).map(([path, text]) => [path, Buffer.from(text)]));
  for (const [id, bytes] of source.blobs) {
    if (designDigest(bytes).slice(7, 39) !== id) throw new Error("Dashboard attachment content does not match its identity");
    const raw = members.get("_blobs/" + id + ".json"); if (!raw) throw new Error("Dashboard attachment metadata is missing");
    const meta = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!meta || typeof meta !== "object" || Array.isArray(meta) || typeof meta.name !== "string" || meta.name.length > 240 || typeof meta.contentType !== "string" || meta.contentType.length > 128 || meta.bytes !== bytes.length) throw new Error("Dashboard attachment metadata does not match its bytes");
    resources.set("/_blob/" + id, Buffer.from(bytes)); mime.set("/_blob/" + id, meta.contentType);
  }
  const target = (path: string, url: string) => {
    if (/^(?:data:|#)/i.test(url)) return null;
    let clean = decodeURIComponent(url.split(/[?#]/, 1)[0]!);
    if (clean.startsWith("files/")) clean = clean.slice(6);
    if (clean.startsWith("./")) clean = clean.slice(2);
    if (/^\/_blob\/[a-f0-9]{32}$/.test(clean) && resources.has(clean)) return clean;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(clean) || clean.includes("\\")) throw new Error("Dashboard resources must be captured in its files or attachments");
    const result = posix.normalize(posix.join(posix.dirname(path), clean));
    if (!/^[A-Za-z0-9_][A-Za-z0-9_. -]{0,199}$/.test(result) || !resources.has(result)) throw new Error("Missing Dashboard page resource: " + url.slice(0, 200));
    return result;
  };
  const active = new Set<string>(), checked = new Set<string>(), pageBlobs = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    if (active.has(path)) throw new Error("Dashboard has a cyclic page resource: " + path);
    if (checked.has(path)) return; active.add(path);
    for (const reference of /\.(?:html|css|[cm]?js|svg)$/i.test(path) ? await designResourceReferences(new TextDecoder("utf-8", { fatal: true }).decode(resources.get(path)!), path) : []) {
      const next = target(path, reference.url); if (next && reference.kind !== "navigation") { if (next.startsWith("/_blob/")) pageBlobs.add(next.slice(7)); await visit(next); }
    }
    active.delete(path); checked.add(path);
  };
  for (const path of Object.keys(source.sourceFiles)) await visit(path);
  return { source, resources, target, mime, pageBlobs };
}
export async function prepareDashboardPage(files: readonly Member[], documentId: string, runtime: ReadonlyMap<string, Uint8Array>) {
  const { source, resources, target, mime } = await dashboardResources(files, documentId), cache = new Map<string, string>(); let total = 0;
  const prepare = async (path: string, root = false): Promise<string> => {
    if (cache.has(path)) return cache.get(path)!;
    const bytes = resources.get(path)!; let content = Buffer.from(bytes);
    if (/\.(?:html|css|[cm]?js|svg)$/i.test(path)) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), references = await designResourceReferences(text, path), replacements = new Map<number, string>();
      for (const ref of references) { if (ref.kind === "navigation") continue; const next = target(path, ref.url); if (next) replacements.set(ref.start, await prepare(next)); }
      content = Buffer.from(rewriteReferences(text, references, ref => replacements.get(ref.start) ?? null));
    }
    if (root) return content.toString("utf8");
    const uri = "data:" + (mime.get(path) ?? artifactMime(path)) + ";base64," + content.toString("base64"); total += uri.length;
    if (total > DESIGN_LIMITS.archive) throw new Error("Dashboard page resources exceed their render budget"); cache.set(path, uri); return uri;
  };
  const sdk = runtime.get("page.js"), d3 = runtime.get("d3.js"), css = runtime.get("page.css"); if (!sdk || !d3 || !css) throw new Error("The verified Dashboard page runtime is missing");
  const json = JSON.stringify({ datasets: source.datasets, title: source.manifest.title, defaults: source.documents["dash/params"] ?? {} }).replaceAll("<", "\\u003c");
  const csp = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
  const script = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("</script", "<\\/script");
  const setup = `<meta http-equiv="Content-Security-Policy" content="${csp}"><style>${new TextDecoder().decode(css).replaceAll("</style", "<\\/style")}</style><script id="bottega-dashboard-data" type="application/json">${json}</script><script>${script(d3)}</script><script>${script(sdk)}</script>`;
  const text = await inlineDesignTextResources(await prepare("index.html", true));
  const document = parse(text), html = document.childNodes.find((node): node is DefaultTreeAdapterMap["element"] => "tagName" in node && node.tagName === "html")!;
  const head = html.childNodes.find((node): node is DefaultTreeAdapterMap["element"] => "tagName" in node && node.tagName === "head")!, body = html.childNodes.find((node): node is DefaultTreeAdapterMap["element"] => "tagName" in node && node.tagName === "body")!;
  const roots: DefaultTreeAdapterMap["element"][] = [];
  const findRoot = (node: DefaultTreeAdapterMap["node"]) => { if ("attrs" in node && node.attrs.some(value => value.name === "id" && value.value === "dash-root")) roots.push(node); if ("childNodes" in node) node.childNodes.forEach(findRoot); };
  findRoot(body); if (roots.length > 1) throw new Error("Dashboard has duplicate page roots");
  if (!roots.length) {
    const wrapper = parseFragment('<div id="dash-root"></div>').childNodes[0] as DefaultTreeAdapterMap["element"];
    for (const child of [...body.childNodes]) { defaultTreeAdapter.detachNode(child); defaultTreeAdapter.appendChild(wrapper, child); }
    defaultTreeAdapter.appendChild(body, wrapper);
  }
  const initial = parseFragment(setup).childNodes; for (const child of initial) child.parentNode = head; head.childNodes.unshift(...initial);
  document.childNodes = document.childNodes.filter(node => node.nodeName !== "#documentType");
  return Buffer.from("<!doctype html>" + serialize(document));
}
