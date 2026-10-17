/**
 * [INPUT]: Resource/import maps, module resolver, virtual source path and manifest-owned navigation policy.
 * [OUTPUT]: Relative resource compatibility and lookup; design links retain their attested original href.
 * [POS]: Untrusted-document convenience adapter; browser sandbox/CSP enforce security even if this is replaced.
 */
import { resolveArtifactModule, type ArtifactModuleMap } from "./modules";
export function artifactResourceRuntime(files: Record<string, string>, base: string, moduleMap: ArtifactModuleMap, preserveNavigation = false) {
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  return `(${installResources.toString()})(${json(files)},${json(base)},${json(moduleMap)},${resolveArtifactModule.toString()},${json(preserveNavigation)});`;
}
function installResources(files: Record<string, string>, base: string, moduleMap: ArtifactModuleMap, resolveModule: typeof resolveArtifactModule, preserveNavigation: boolean) {
  const resolve = (input: string | URL, from = base) => {
    if (String(input).startsWith("#")) return String(input);
    try { const url = new URL(String(input), from), hash = url.hash; url.search = ""; url.hash = ""; return (files[url.href] ?? String(input)) + (files[url.href] ? hash : ""); }
    catch { return String(input); }
  };
  // Read-only lookup from an original snapshot URL to its inlined data URL (the App surface runtime's asset mapper uses it).
  Object.defineProperty(window, "__artifactResource", { value: (href: string) => files[href] ?? null });
  const fetch = window.fetch.bind(window), NativeRequest = window.Request;
  window.Request = class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) { super(input instanceof NativeRequest ? input : resolve(input), init); }
  };
  window.fetch = (input, init) => {
    if (input instanceof NativeRequest) {
      const url = resolve(input.url);
      return fetch(url === input.url ? input : new Request(url, input), init);
    }
    return fetch(resolve(input), init);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, asynchronous: boolean = true, username?: string | null, password?: string | null) {
    open.call(this, method, resolve(url), asynchronous, username, password);
  };
  const moduleUrl = (from: string, value: string) => {
    const resolved = resolveModule(moduleMap, String(value), from);
    if (resolved === null) throw new TypeError(`Blocked module specifier: ${value}`);
    try { return new URL(resolved).href; } catch { throw new TypeError(`Unmapped module specifier: ${value}`); }
  };
  const runtime = window as unknown as {
    __artifactResolve: typeof moduleUrl;
    __artifactImport: (from: string, value: string, options?: ImportCallOptions) => Promise<unknown>;
  };
  runtime.__artifactResolve = moduleUrl;
  runtime.__artifactImport = async (from, value, options) => {
    const resolved = moduleUrl(from, value), url = new URL(resolved); url.search = ""; url.hash = "";
    return import(/* @vite-ignore */ files[url.href] ? url.href : resolved, options);
  };
  const srcset = (value: string) => value.includes("data:") ? value : value.split(",").map(item => item.trim().replace(/^\S+/, path => resolve(path))).join(", ");
  const attributes = ["src", "href", "poster", "data", "srcset"];
  const attributeUrl = (element: Element, name: string, value: string) => preserveNavigation && name === "href" && ["a", "area"].includes(element.localName)
    ? value : name === "srcset" ? srcset(value) : attributes.includes(name) ? resolve(value) : value;
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    setAttribute.call(this, name, attributeUrl(this, name.toLowerCase(), String(value)));
  };
  for (const [prototype, properties] of [
    [HTMLImageElement.prototype, ["src", "srcset"]], [HTMLScriptElement.prototype, ["src"]], [HTMLLinkElement.prototype, ["href"]],
    [HTMLSourceElement.prototype, ["src", "srcset"]], [HTMLMediaElement.prototype, ["src"]], [HTMLVideoElement.prototype, ["poster"]],
  ] as [object, string[]][]) {
    for (const property of properties) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (descriptor?.set) Object.defineProperty(prototype, property, { ...descriptor, set(this: Element, value: string) { descriptor.set!.call(this, attributeUrl(this, property, String(value))); } });
    }
  }
  const rewrite = (element: Element) => {
    for (const name of attributes) {
      const value = element.getAttribute(name); if (value === null) continue;
      const resolved = attributeUrl(element, name, value);
      if (resolved !== value) setAttribute.call(element, name, resolved);
    }
  };
  // HTML parsers bypass property setters. Observe inserted subtrees, including cloned template contents.
  const selector = attributes.map(name => `[${name}]`).join(",");
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") { rewrite(record.target as Element); continue; }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        rewrite(node); node.querySelectorAll(selector).forEach(rewrite);
      }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: attributes });
}
