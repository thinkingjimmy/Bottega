/**
 * [INPUT]: The build environment (ARTIFACT_PARENT_ORIGIN, VERCEL), the checked-in deployment map, the artifact and surface fragment CSPs and both origin conventions.
 * [OUTPUT]: Provides parentOrigin (hosted builds accept only a mapped Cloud Web origin), shellHeaders(parent, kind) for every response and shellKind(host).
 * [POS]: Single header source for vite.config.ts (dev/preview) and vercel.ts (hosted); artifact and App surface hosts get separate policies.
 */
import { ARTIFACT_FRAGMENT_CSP } from "../../packages/cloud-protocol/src/artifacts/viewer-shell";
import { artifactFrameOriginPolicy } from "../../packages/cloud-protocol/src/artifacts/origins";
import { SURFACE_FRAGMENT_CSP } from "../../packages/cloud-protocol/src/surfaces/policy";
import { surfaceFrameOriginPolicy } from "../../packages/cloud-protocol/src/surfaces/origins";
import deployments from "./config/deployments.json" with { type: "json" };

export type ShellKind = "artifact" | "surface";
/* A hosted shell baked with the wrong parent would accept mounts from nobody (or from localhost), so a hosted build
   fails unless its parent is one of the mapped Cloud Web origins; only local builds fall back to the dev server. */
export function parentOrigin(env: NodeJS.ProcessEnv = process.env) {
  const hosted = env.VERCEL === "1";
  const value = env.ARTIFACT_PARENT_ORIGIN ?? (hosted ? "" : "http://localhost:5173");
  if (!value || new URL(value).origin !== value) throw new Error("artifact-parent-origin-invalid");
  if (hosted && !Object.values(deployments).some(target => target.parentOrigin === value)) throw new Error("artifact-parent-origin-unmapped");
  return value;
}
export const shellKind = (host: string): ShellKind => /^srf-[a-f0-9-]{36}\.surfaces\./.test(host) ? "surface" : "artifact";

/* frame-ancestors names the loader's own wildcard too: WebKit applies it to the Blob child frame the shell creates. */
export function shellHeaders(parent: string, kind: ShellKind): Record<string, string> {
  const [fragment, frames] = kind === "surface" ? [SURFACE_FRAGMENT_CSP, surfaceFrameOriginPolicy(parent)] : [ARTIFACT_FRAGMENT_CSP, artifactFrameOriginPolicy(parent)];
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*",
    "Content-Security-Policy": fragment.replace("script-src ", "script-src 'self' ").replace("style-src ", "style-src 'self' ")
      .replace("frame-src 'none'", "frame-src blob:") + `; frame-ancestors ${parent} ${frames}`,
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), display-capture=()" };
}
