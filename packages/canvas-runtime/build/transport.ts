/**
 * [INPUT]: An optional main-issued opaque remote transport installed before the original editor runtime.
 * [OUTPUT]: nativeFetch and nativeBase route only owned native module requests through that transport or the original local fetch.
 * [POS]: Trusted module-owned HTTP adapter; global fetch and authored child windows are unchanged.
 */
import { nativeEditorFetch } from "../adapters/asset-address";
type Transport = { base: string; fetch: typeof fetch; resource(path: string): string | null };
const remote = () => (window as Window & { __bottegaNativeTransport?: Transport }).__bottegaNativeTransport;
export const nativeBase = () => remote()?.base ?? new URL("./", location.href).href;
export const nativeFetch: typeof fetch = nativeEditorFetch;
