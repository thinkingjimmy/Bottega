/**
 * [INPUT]: One-use capabilities from the exact application, pure snapshot preparation and host-observed activation.
 * [OUTPUT]: An opaque offline frame, permanent parent navigation policy and authenticated interaction relay.
 * [POS]: Credential-free trusted wrapper; untrusted content has no hosting-origin or Service Worker authority.
 */
import { artifactFenceSchema, artifactRelativePathSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { ARTIFACT_FRAGMENT_CSP } from "@ai-chat/cloud-protocol/artifacts/viewer-shell";
import { ArtifactFollowUpGuard } from "@ai-chat/cloud-protocol/artifacts/frame-security";
import { prepareContent, type ArtifactResource } from "./content";
declare const __ARTIFACT_PARENT_ORIGIN__: string;
const params = new URLSearchParams(location.search), nonce = location.hash.slice(1);
const host: Window | null = parent !== window ? parent : opener;
if (!/^[a-f0-9-]{36}$/.test(nonce) || !host) throw new Error("artifact-capability-missing");
let used = false;
const receive = (event: MessageEvent) => {
  if (used || event.source !== host || event.origin !== __ARTIFACT_PARENT_ORIGIN__ || event.data?.type !== "bottega:artifact:mount" || event.data.nonce !== nonce) return;
  used = true;
  const fence = artifactFenceSchema.parse(event.data.fence), files: unknown = event.data.files;
  if (!Array.isArray(files) || !files.length || files.length > 200) throw new Error("artifact-resource-budget");
  let total = 0;
  const entries: ArtifactResource[] = files.map(value => {
    const path = artifactRelativePathSchema.parse(value.path);
    if (!(value.bytes instanceof Uint8Array)) throw new Error("artifact-resource-invalid");
    total += value.bytes.length;
    if (total > 50_000_000) throw new Error("artifact-resource-budget");
    return { path, bytes: value.bytes, mime: String(value.mime).slice(0, 128) };
  });
  if (new Set(entries.map(file => file.path)).size !== entries.length) throw new Error("artifact-duplicate-resource");
  if (fence.kind !== "static-site" && (entries.length !== 1 || total > 16_777_216)) throw new Error("artifact-resource-budget");
  const html = prepareContent(fence, entries, params.get("theme") === "dark" ? "dark" : "light");
  // This ancestor policy survives child navigation and cannot be changed by artifact code.
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy"; policy.content = ARTIFACT_FRAGMENT_CSP.replace("frame-src 'none'", "frame-src blob:"); document.head.append(policy);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const frame = document.createElement("iframe"); frame.title = fence.title;
  frame.sandbox.add("allow-scripts"); frame.referrerPolicy = "no-referrer";
  frame.style.cssText = "width:100%;height:100%;border:0;display:block";
  document.documentElement.style.cssText = "height:100%;overflow:hidden";
  document.body.style.cssText = "height:100%;margin:0;overflow:hidden";
  document.title = fence.title;
  const guard = new ArtifactFollowUpGuard();
  const relay = (message: MessageEvent) => {
    if (message.source === host && message.origin === __ARTIFACT_PARENT_ORIGIN__ && message.data?.type === "bottega:artifact:theme") {
      frame.contentWindow?.postMessage(message.data, "*"); return;
    }
    if (message.source !== frame.contentWindow || message.origin !== "null") return;
    if (message.data?.type === "bottega:artifact:follow-up") {
      const payload = guard.accept(message.data.payload, navigator.userActivation.isActive);
      if (payload) host.postMessage({ type: message.data.type, payload, nonce, activated: true }, __ARTIFACT_PARENT_ORIGIN__);
    } else if (["bottega:artifact:ready", "bottega:artifact:size", "bottega:artifact:escape", "bottega:artifact:error"].includes(message.data?.type)) {
      host.postMessage({ ...message.data, nonce }, __ARTIFACT_PARENT_ORIGIN__);
    }
  };
  window.addEventListener("message", relay);
  frame.src = url; document.body.replaceChildren(frame);
  setTimeout(() => { window.removeEventListener("message", relay); frame.remove(); URL.revokeObjectURL(url); document.body.textContent = "Artifact expired"; }, 30 * 60_000);
};
window.addEventListener("message", event => { try { receive(event); } catch { host.postMessage({ type: "bottega:artifact:error", nonce }, __ARTIFACT_PARENT_ORIGIN__); document.body.textContent = "Artifact unavailable"; } });
host.postMessage({ type: "bottega:artifact:shell-ready", nonce }, __ARTIFACT_PARENT_ORIGIN__);
