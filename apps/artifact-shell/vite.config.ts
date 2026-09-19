/**
 * [INPUT]: Explicit parent application origin and the artifact CDN allowlist.
 * [OUTPUT]: Credential-free wildcard shell with offline-only content-frame security headers.
 * [POS]: Artifact hosting build boundary; this application has no account SDK or API proxy.
 */
import { defineConfig } from "vite";
import { ARTIFACT_FRAGMENT_CSP } from "../../packages/cloud-protocol/src/artifacts/viewer-shell";
import { artifactFrameOriginPolicy } from "../../packages/cloud-protocol/src/artifacts/origins";
const parent = process.env.ARTIFACT_PARENT_ORIGIN ?? "http://localhost:5173";
if (new URL(parent).origin !== parent) throw new Error("artifact-parent-origin-invalid");
const frames = artifactFrameOriginPolicy(parent);
export const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*",
  "Content-Security-Policy": ARTIFACT_FRAGMENT_CSP.replace("script-src ", "script-src 'self' ").replace("style-src ", "style-src 'self' ")
    .replace("frame-src 'none'", "frame-src blob:") + `; frame-ancestors ${parent} ${frames}`,
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), display-capture=()" };
export default defineConfig({ plugins: [{ name: "artifact-security-headers", generateBundle() {
  this.emitFile({ type: "asset", fileName: "_headers", source: "/*\n" + Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`).join("\n") + "\n" });
} }], define: { __ARTIFACT_PARENT_ORIGIN__: JSON.stringify(parent) }, server: { allowedHosts: [".artifacts.localhost"], headers }, preview: { headers } });
