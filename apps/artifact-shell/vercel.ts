/**
 * [INPUT]: The parent origin and per-kind shell headers from headers.ts.
 * [OUTPUT]: Provides the hosted loader configuration: mutually exclusive artifact or exact-environment surface headers on every response, the shell at `/`, hashed assets, and 404 for anything else.
 * [POS]: Vercel project configuration for `*.artifacts.<app host>` and `*.surfaces.<app host>`; a separate project from Cloud Web, with no `/api/auth`, rewrites or proxy.
 */
import { parentOrigin, shellHeaders } from "./headers";

/* Structural subset of @vercel/config's VercelConfig; the loader takes no dependency for a type. */
type Has = { type: "host"; value: string }[];
type Route = { src: string; has?: Has; missing?: Has; headers?: Record<string, string>; continue?: boolean; dest?: string; status?: number } | { handle: "filesystem" };
const parent = parentOrigin();
const parentHost = new URL(parent).hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const surfaceHost: Has = [{ type: "host", value: `^srf-[a-f0-9-]{36}\\.surfaces\\.${parentHost}$` }];
export const config: { framework: "vite"; installCommand: string; buildCommand: string; outputDirectory: string; routes: Route[] } = {
  framework: "vite", installCommand: "pnpm install --frozen-lockfile", buildCommand: "pnpm run build", outputDirectory: "dist",
  routes: [
    // Match the complete host and select one policy; edge header precedence must never decide the surface CSP.
    { src: "^/.*$", missing: surfaceHost, headers: shellHeaders(parent, "artifact"), continue: true },
    { src: "^/.*$", has: surfaceHost, headers: shellHeaders(parent, "surface"), continue: true },
    { handle: "filesystem" },
    // The reader only ever opens `/` (lease in the host, nonce in the fragment); nothing falls back to the shell.
    { src: "^/$", dest: "/index.html" },
    { src: "^/.*$", status: 404 },
  ],
};
