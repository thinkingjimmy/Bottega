/**
 * [INPUT]: The lease in its own host name, a one-use mount from the exact parent frame, surface preparation and the frame protocol.
 * [OUTPUT]: startSurface: one opaque `allow-scripts` Blob frame per lease under a permanent ancestor CSP; a hop-2 relay for frame-nonce-bound readiness and SDK RPCs (results only for the App's own open requests); bounded authenticated preferences, immediate malformed-RPC refusals, unmount, renewal and expiry.
 * [POS]: Credential-free App surface wrapper (TASK-22). It runs only as an iframe of the baked Cloud Web origin: no popup path, no key, no account SDK.
 */
import { SURFACE_FRAGMENT_CSP } from "@ai-chat/cloud-protocol/surfaces/policy";
import { surfaceLeaseFromHost } from "@ai-chat/cloud-protocol/surfaces/origins";
import { configureJitlessZod } from "@ai-chat/cloud-protocol/surfaces/zod";
import {
  surfaceAppMessageSchema, surfaceAppRpcSchema, surfaceMountSchema, surfaceNonceSchema, surfaceRenewSchema, surfaceRpcResultSchema,
  surfaceUnmountSchema, surfacePreferencesSchema, type SurfaceMount,
} from "@ai-chat/cloud-protocol/surfaces/frame-protocol";
import { SURFACE_LIMITS } from "@ai-chat/cloud-protocol/surfaces/policy";
import { prepareSurface } from "./content";
declare const __ARTIFACT_PARENT_ORIGIN__: string;
const PARENT = __ARTIFACT_PARENT_ORIGIN__;
export function startSurface() {
  configureJitlessZod();
  const nonce = location.hash.slice(1), leaseId = surfaceLeaseFromHost(location.hostname);
  // A popup or top-level load has no trusted parent; in the Android shell a popup would also lose this channel.
  if (parent === window || !leaseId || !surfaceNonceSchema.safeParse(nonce).success) throw new Error("surface-capability-missing");
  const report = (type: string, extra: Record<string, unknown> = {}) => parent.postMessage({ type, nonce, ...extra }, PARENT);
  let mounted: { frame: HTMLIFrameElement; url: string; frameNonce: string; timer: ReturnType<typeof setTimeout>; calls: Set<string> } | null = null, used = false;
  const expire = () => { unmount(); report("bottega:surface:error", { code: "expired" }); };
  const unmount = () => {
    if (!mounted) return;
    clearTimeout(mounted.timer); mounted.frame.remove(); URL.revokeObjectURL(mounted.url); mounted = null;
  };
  function mount(data: unknown) {
    const parsed = surfaceMountSchema.safeParse(data), now = Date.now();
    if (!parsed.success || parsed.data.leaseId !== leaseId || parsed.data.expiresAt <= now || parsed.data.expiresAt > now + SURFACE_LIMITS.leaseMs + 60_000) {
      report("bottega:surface:error", { code: "mount-invalid" }); return;
    }
    const value: SurfaceMount = parsed.data;
    let html: string;
    try { html = prepareSurface(value.files.map(file => ({ path: file.path, mime: file.mime, bytes: file.bytes as Uint8Array<ArrayBuffer> })), value.entry); }
    catch { report("bottega:surface:error", { code: "prepare-failed" }); return; }
    // This ancestor policy survives child navigation and cannot be changed by App code.
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy"; policy.content = SURFACE_FRAGMENT_CSP.replace("frame-src 'none'", "frame-src blob:"); document.head.append(policy);
    const frameNonce = crypto.randomUUID(), url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    // The desktop gateway's fragment names, which the compiled prepaint script and SDK bootstrap read.
    const { language, reducedMotion, ...environment } = value.environment;
    const fragment = new URLSearchParams({ frameNonce, lang: language, ...environment, reducedMotion: String(reducedMotion) });
    const frame = document.createElement("iframe");
    frame.sandbox.add("allow-scripts"); frame.referrerPolicy = "no-referrer"; frame.title = value.subject?.id ?? value.appId!;
    frame.style.cssText = "width:100%;height:100%;border:0;display:block";
    document.documentElement.style.cssText = "height:100%;overflow:hidden"; document.body.style.cssText = "height:100%;margin:0;overflow:hidden";
    const timer = setTimeout(expire, value.expiresAt - now);
    mounted = { frame, url, frameNonce, timer, calls: new Set() };
    frame.src = url + "#" + fragment; document.body.replaceChildren(frame);
  }
  window.addEventListener("message", event => {
    if (event.source === parent && event.origin === PARENT && event.data?.nonce === nonce) {
      if (event.data.type === "bottega:surface:mount" && !used) { used = true; mount(event.data); return; }
      const unmounting = surfaceUnmountSchema.safeParse(event.data);
      if (unmounting.success) { unmount(); report("bottega:surface:unmounted", { reason: unmounting.data.reason }); return; }
      const renewing = surfaceRenewSchema.safeParse(event.data);
      if (renewing.success && mounted) {
        clearTimeout(mounted.timer);
        mounted.timer = setTimeout(expire, Math.min(renewing.data.expiresAt, Date.now() + SURFACE_LIMITS.leaseMs) - Date.now());
        return;
      }
      const preferences = surfacePreferencesSchema.safeParse(event.data);
      if(preferences.success && mounted){
        mounted.frame.contentWindow?.postMessage({type:"bottega:surface:preferences",frameNonce:mounted.frameNonce,preferences:preferences.data.preferences},"*");return;
      }
      // A result reaches the App only for a request this App frame made and has not been answered yet; the lease nonce is stripped.
      const result = surfaceRpcResultSchema.safeParse(event.data);
      if (result.success && mounted?.calls.delete(result.data.requestId)) {
        const { nonce: _nonce, ...answer } = result.data;
        mounted.frame.contentWindow?.postMessage(answer, "*");
      }
      return;
    }
    // Opaque frames report origin "null"; the frame nonce binds the message to the document this wrapper created.
    if (!mounted || event.source !== mounted.frame.contentWindow || event.origin !== "null") return;
    const message = surfaceAppMessageSchema.safeParse(event.data);
    if (message.success && message.data.frameNonce === mounted.frameNonce) { report(message.data.type); return; }
    const call = surfaceAppRpcSchema.safeParse(event.data);
    if (!call.success) {
      const raw=event.data;
      if(raw?.type==="bottega:surface:rpc" && raw.frameNonce===mounted.frameNonce && typeof raw.requestId==="string" && /^rpc_[a-z0-9_]{8,64}$/.test(raw.requestId) && !mounted.calls.has(raw.requestId))
        mounted.frame.contentWindow?.postMessage({type:"bottega:surface:rpc-result",requestId:raw.requestId,ok:false,error:{code:"invalid_envelope"}},"*");
      return;
    }
    if (call.data.frameNonce !== mounted.frameNonce || mounted.calls.has(call.data.requestId)) return;
    if (mounted.calls.size >= SURFACE_LIMITS.pendingRpcs) {
      mounted.frame.contentWindow?.postMessage({ type: "bottega:surface:rpc-result", requestId: call.data.requestId, ok: false, error: { code: "busy" } }, "*"); return;
    }
    mounted.calls.add(call.data.requestId);
    const { frameNonce: _frameNonce, ...forward } = call.data;
    report(forward.type, forward);
  });
  report("bottega:surface:shell-ready");
}
