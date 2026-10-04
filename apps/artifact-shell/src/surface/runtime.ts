/**
 * [INPUT]: The frame nonce the wrapper writes into the Blob URL fragment.
 * [OUTPUT]: surfaceAppRuntime: serialized source that exposes window.__bottegaSurface.post (closed hop-2 messages) and call(operation, payload), a promise that always settles with the value or an Error carrying the typed code and desktop-shaped detail; authenticated onPreferences subscriptions; per-mount in-memory sessionStorage/localStorage stand-ins; disables popups, link navigation and form submission.
 * [POS]: First script of every App surface document; convenience only, the sandbox and inherited CSP remain the security boundary.
 */
import { SURFACE_APP_MESSAGES } from "@ai-chat/cloud-protocol/surfaces/frame-protocol";
export function surfaceAppRuntime(): string {
  return `(${install.toString()})(${JSON.stringify(SURFACE_APP_MESSAGES)});`;
}
function install(types: readonly string[]) {
  const frameNonce = new URLSearchParams(location.hash.slice(1)).get("frameNonce") ?? "";
  const send = parent.postMessage.bind(parent), allowed = new Set(types),parentOrigin=new URL(location.href).origin;
  type Preferences={locale:string;theme:"light"|"dark"};
  const fragment=new URLSearchParams(location.hash.slice(1));
  let preferences:Preferences={locale:fragment.get("locale")??"en",theme:fragment.get("colorScheme")==="dark"?"dark":"light"};
  const listeners=new Set<(value:Preferences)=>void>();
  type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  const pending = new Map<string, Pending>();
  type Detail = { message?: string; outcome?: string; issues?: unknown[]; currentRevision?: number };
  const failure = (code: string, reason?: string, detail?: Detail) => Object.assign(new Error(detail?.message ?? (reason ? `${code}: ${reason}` : code)), { code, reason, detail });
  addEventListener("message", event => {
    const data = event.data as { type?: string; frameNonce?:string; preferences?:Preferences; requestId?: string; ok?: boolean; value?: unknown; error?: { code: string; reason?: string; detail?: Detail } } | null;
    if(event.source!==parent || event.origin!==parentOrigin)return;
    if(data?.type==="bottega:surface:preferences" && data.frameNonce===frameNonce){
      const value=data.preferences;
      if(value&&typeof value.locale==="string"&&value.locale.length>=2&&value.locale.length<=35&&(value.theme==="light"||value.theme==="dark")){
        preferences={locale:value.locale,theme:value.theme};for(const listener of listeners){try{listener({...preferences});}catch{ /* One subscriber must not stop preference delivery to others. */ }}
      }return;
    }
    if (data?.type !== "bottega:surface:rpc-result" || !data.requestId) return;
    const call = pending.get(data.requestId); if (!call) return;
    pending.delete(data.requestId); clearTimeout(call.timer);
    if (data.ok) call.resolve(data.value); else call.reject(failure(data.error?.code ?? "unavailable", data.error?.reason, data.error?.detail));
  });
  // Every call settles: a typed refusal from the host, or "unavailable" when no answer comes back in time.
  const call = (operation: string, payload: unknown) => new Promise((resolve, reject) => {
    const requestId = "rpc_" + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
    const timer = setTimeout(() => { pending.delete(requestId); reject(failure("unavailable", "timeout")); }, 30_000);
    pending.set(requestId, { resolve, reject, timer });
    send({ type: "bottega:surface:rpc", frameNonce, requestId, operation, payload }, "*");
  });
  Object.defineProperty(window, "__bottegaSurface", { value: Object.freeze({ post(type: string) { if (allowed.has(type)) send({ type, frameNonce }, "*"); }, call, onPreferences(listener:(value:Preferences)=>void){listeners.add(listener);listener({...preferences});return()=>listeners.delete(listener);} }) });
  /* An opaque frame has no Web storage and throws on access. Apps get per-mount in-memory stand-ins so code written for the
     desktop gateway keeps running; nothing persists or leaves the frame, and durable state still goes through the SDK. */
  const memoryStorage = (): Storage => {
    const items = new Map<string, string>();
    return Object.freeze({
      get length() { return items.size; }, key: (index: number) => [...items.keys()][index] ?? null,
      getItem: (key: string) => items.get(String(key)) ?? null, setItem: (key: string, value: string) => { items.set(String(key), String(value)); },
      removeItem: (key: string) => { items.delete(String(key)); }, clear: () => items.clear(),
    }) as Storage;
  };
  for (const name of ["sessionStorage", "localStorage"]) Object.defineProperty(window, name, { value: memoryStorage(), configurable: false });
  // The compiled GUI's asset imports ask this for the inlined data URL of a module-relative asset (see the desktop compiler's asset stub).
  const resource = (window as unknown as { __artifactResource?: (href: string) => string | null }).__artifactResource;
  Object.defineProperty(window, "__bottegaAssetUrl", { value: (href: string) => resource?.(href) ?? href });
  window.open = () => null;
  addEventListener("click", event => {
    const link = (event.target as Element | null)?.closest?.("a[href]");
    if (link && !link.getAttribute("href")!.startsWith("#")) event.preventDefault();
  }, true);
  addEventListener("submit", event => event.preventDefault(), true);
}
