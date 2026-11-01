/**
 * [INPUT]: Trusted native editor marker, its original location and a validated document member path.
 * [OUTPUT]: nativePreviewResourceUrls maps captured remote markup/CSS and nativeRuntimeSource reads exact preview scripts for inline opaque descendants; nativePreviewFontUrls resolves early/nested native font CSS without global fetch changes; nativeExportZipResources retains exact binary resources/notices; nativeExportAssetBytes reads exact bounded native binary/text HTML resources; nativeAssetAddress resolves fixed local/remote resource URLs; nativeEditorAssetAddress resolves original property-picker project/blob images; nativeEditorFetch provides only the installed private module transport or ordinary fetch.
 * [POS]: Editor-side read-only resource adapter; authored frames gain no token or write capability.
 */
export function nativeAssetAddress(path: unknown): string | null {
  if (!document.querySelector<HTMLMetaElement>('meta[name="bottega-native-token"]')?.content || typeof path !== "string" ||
      path.length > 240 || path.startsWith("/") || /[\\?#]/.test(path) || path.includes(String.fromCharCode(0))) return null;
  const parts = path.replace(/^project\//, "").replace(/^(?:\.\/)+/, "").split("/");
  if (parts.length > 4 || parts.some(part => !part || part === "." || part === "..")) return null;
  const remote = (window as Window & { __bottegaNativeTransport?: { resource(path: string): string | null } }).__bottegaNativeTransport;
  if (remote) return remote.resource("project/" + parts.join("/"));
  return new URL(parts.map(encodeURIComponent).join("/"), new URL("./project/", location.href)).href;
}

export function nativeEditorAssetAddress(path: unknown): string | null {
  if (typeof path === "string" && /^\/_blob\/[a-f0-9]{32}$/.test(path) && document.querySelector<HTMLMetaElement>('meta[name="bottega-native-token"]')?.content) {
    const remote = (window as Window & { __bottegaNativeTransport?: { resource(path: string): string | null } }).__bottegaNativeTransport;
    return remote ? remote.resource(path.slice(1)) : new URL("." + path, location.href).href;
  }
  return nativeAssetAddress(path);
}

export const nativeEditorFetch: typeof fetch = (input, init) => {
  const remote = typeof window === "undefined" ? undefined : (window as Window & { __bottegaNativeTransport?: { fetch: typeof fetch } }).__bottegaNativeTransport;
  return remote ? remote.fetch(input, init) : globalThis.fetch(input, init);
};

export async function nativeExportAssetBytes(path: unknown) {
  const address = nativeAssetAddress(path);
  if (!address) return undefined;
  const response = await nativeEditorFetch(address);
  if (!response.ok) return null;
  const blob = await response.blob();
  if (blob.size > 24 * 1024 * 1024) throw new Error("A native HTML resource exceeds its byte budget");
  return { data: new Uint8Array(await blob.arrayBuffer()), mime: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream" };
}

export async function nativeExportZipResources(existing: ReadonlySet<string>) {
  if (!document.documentElement.hasAttribute("data-bottega-native-export")) return [];
  const remote = (window as Window & { __bottegaNativeTransport?: { base: string } }).__bottegaNativeTransport;
  const base = remote?.base ?? new URL("./", location.href).href;
  const result = await nativeEditorFetch(new URL("_files.json", base));
  if (!result.ok) throw new Error("The exact HTML ZIP resource list is unavailable");
  const index = await result.json() as { files: Record<string, unknown> }, rows: { name: string; data: Uint8Array }[] = [];
  const paths = Object.keys(index.files);
  if (existing.has("THIRD_PARTY_NOTICES.txt") || paths.includes("project/THIRD_PARTY_NOTICES.txt")) throw new Error("The HTML ZIP runtime notice path is reserved"); if (paths.length > 64) throw new Error("The original Canvas ZIP source exceeds its file budget");
  let total = 0;
  for (const path of paths) {
    const name = path.replace(/^project\//, "");
    if (!path.startsWith("project/") || existing.has(name) || ["canvas.json", "comments.json"].includes(name) || name.endsWith(".dc.html")) continue;
    const resource = await nativeExportAssetBytes(name);
    if (!resource || (total += resource.data.length) > 32 * 1024 * 1024) throw new Error("The exact HTML ZIP resources are missing or too large");
    rows.push({ name, data: resource.data }); existing = new Set([...existing, name]);
  }
  const notices = await nativeEditorFetch(new URL("third-party-licenses.txt", base));
  if (!notices.ok) throw new Error("The complete HTML ZIP runtime notices are missing");
  const bytes = new Uint8Array(await notices.arrayBuffer()); if (bytes.length > 8 * 1024 * 1024) throw new Error("The complete HTML ZIP notices exceed their byte budget");
  rows.push({ name: "THIRD_PARTY_NOTICES.txt", data: bytes }); return rows;
}

export function nativePreviewFontUrls(source: string, file: string) {
  if (!document.querySelector<HTMLMetaElement>('meta[name="bottega-native-token"]')?.content) return source;
  const remote = (window as Window & { __bottegaNativeTransport?: { resource(path: string): string | null } }).__bottegaNativeTransport;
  const base = "https://native.invalid/" + file.replace(/^project\//, "").replace(/^(?:\.\/)+/, "");
  return source.replace(/url\(\s*(?:(["'])([^"']+)\1|([^\s)'";]+))\s*\)/gi, (all, quote: string | undefined, quoted: string | undefined, bare: string | undefined) => {
    const value = quoted ?? bare!;
    let address: string | null;
    if (/^\/_blob\/[a-f0-9]{32}$/.test(value)) address = remote ? remote.resource(value.slice(1)) : new URL("." + value, location.href).href;
    else {
      if (!/\.(?:woff2?|ttf|otf)$/i.test(value) || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) return all;
      const target = new URL(value, base);
      address = nativeAssetAddress(target.pathname.slice(1));
    }
    return address ? "url(" + (quote ?? "") + address + (quote ?? "") + ")" : all;
  });
}

export function nativeRemotePreview() {
  return Boolean((window as Window & { __bottegaNativeTransport?: unknown }).__bottegaNativeTransport);
}

export function nativeRuntimeSource(address: string | undefined) {
  const remote = (window as Window & { __bottegaNativeTransport?: { script(path: string): string } }).__bottegaNativeTransport;
  if (!remote || !address) return undefined;
  const path = new URL(address, location.href).pathname.replace(/^\/(?:editor\/)?/, "");
  if (!path.startsWith("artifact-type/")) throw new Error("The exact native preview runtime is unavailable");
  return remote.script(path);
}

export function nativePreviewResourceUrls(source: string, file: string) {
  if (!nativeRemotePreview()) return source;
  const base = "https://native.invalid/" + file.replace(/^project\//, "");
  const address = (value: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(value)) return null;
    if (/^\/_blob\/[a-f0-9]{32}$/.test(value)) return (window as Window & { __bottegaNativeTransport?: { resource(path: string): string | null } }).__bottegaNativeTransport!.resource(value.slice(1));
    return nativeAssetAddress(new URL(value, base).pathname.replace(/^\/(?:appifact\/)?/, ""));
  };
  return source.replace(/<base\b[^>]*>/gi, "")
    .replace(/<(?:img|source|video|audio|a)\b[^>]*>/gi, tag => tag.replace(/\b(src|href|poster)\s*=\s*(["'])([^"'<>]+)\2/gi, (all, key: string, quote: string, value: string) => {
      const mapped = address(value); return mapped ? key + "=" + quote + mapped + quote : all;
    }))
    .replace(/url\(\s*(?:(["'])([^"']+)\1|([^\s)'";]+))\s*\)/gi, (all, quote: string | undefined, quoted: string | undefined, bare: string | undefined) => {
      const mapped = address(quoted ?? bare!); return mapped ? "url(" + (quote ?? "") + mapped + (quote ?? "") + ")" : all;
    });
}
