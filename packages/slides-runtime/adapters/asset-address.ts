/**
 * [INPUT]: Fixed viewer resource map or trusted native editor location and a source-relative resource.
 * [OUTPUT]: Read-only render/fetch URLs without changing original image/font source references.
 * [POS]: Slides resource adapter shared by rendering and font loading; no file or write authority is issued.
 */
export { nativeEditorFetch } from "../../canvas-runtime/adapters/asset-address";
import { nativeAssetAddress } from "../../canvas-runtime/adapters/asset-address";
export function nativeSlidesResource(value: string): boolean {
  if (typeof document === "undefined") return false;
  const captured = (window as Window & { __bottegaSlidesResources?: ReadonlyMap<string, string> }).__bottegaSlidesResources?.has(value);
  if (captured) return true;
  if (!document.querySelector<HTMLMetaElement>('meta[name="bottega-native-token"]')?.content) return false;
  const path = value.split("#", 1)[0]!.replace(/^\.\//, ""), parts = path.split("/");
  return path.length <= 240 && parts.length <= 4 && parts.every(part => /^[A-Za-z0-9_][A-Za-z0-9_. -]*$/.test(part) && part !== "node_modules");
}
export function slidesAssetAddress(value: string): string {
  if (typeof document === "undefined") return value;
  const resources = (window as Window & { __bottegaSlidesResources?: ReadonlyMap<string, string> }).__bottegaSlidesResources;
  const captured = resources?.get(value); if (captured) return captured;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  const trusted = document.querySelector<HTMLMetaElement>('meta[name="bottega-native-token"]')?.content;
  if (trusted && /^\/_blob\/[a-f0-9]{32}$/.test(value)) {
    const remote = (window as Window & { __bottegaNativeTransport?: { resource(path: string): string | null } }).__bottegaNativeTransport;
    return remote ? remote.resource(value.slice(1)) ?? value : new URL("./" + value.slice(1), location.href).href;
  }
  const hash = value.indexOf("#"), path = hash < 0 ? value : value.slice(0, hash);
  const address = nativeAssetAddress(path.replace(/^\.\//, ""));
  return address ? address + (hash < 0 ? "" : "#" + encodeURIComponent(value.slice(hash + 1))) : value;
}
