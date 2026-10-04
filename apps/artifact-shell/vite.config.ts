/**
 * [INPUT]: The parent origin and per-host shell headers from headers.ts.
 * [OUTPUT]: Credential-free wildcard shell build with the parent origin baked in; dev and preview answer each artifact or surface host with its own headers.
 * [POS]: Loader build boundary; this application has no account SDK or API proxy. Hosted headers come from vercel.ts.
 */
import { defineConfig, type Connect, type Plugin } from "vite";
import { resolve } from "node:path";
import { parentOrigin, shellHeaders, shellKind } from "./headers";
const parent = parentOrigin();
const dormant = process.env.BOTTEGA_SERVER_TUNNEL === "1";
if (dormant && (process.env.VERCEL === "1" || new URL(parent).hostname !== "localhost")) throw new Error("Server surface test hosting is local only");
const perHost: Connect.NextHandleFunction = (request, response, next) => {
  const headers = shellHeaders(parent, shellKind((request.headers.host ?? "").split(":")[0]!));
  if (dormant) {
    const target = new URL(request.url ?? "/", "http://localhost").searchParams.get("tunnel");
    if (target && !/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(target)) { response.statusCode = 403; response.end(); return; }
    headers["Content-Security-Policy"] = target
      ? `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src https://${target} wss://${target}`
      : `default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; frame-ancestors ${parent}`;
    headers["Service-Worker-Allowed"] = "/";
  }
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  next();
};
const hostHeaders: Plugin = { name: "loader-host-headers", configureServer: server => { server.middlewares.use(perHost); }, configurePreviewServer: server => { server.middlewares.use(perHost); } };
export default defineConfig({ define: { __ARTIFACT_PARENT_ORIGIN__: JSON.stringify(parent) }, plugins: [hostHeaders],
  worker: { format: "es" }, build: { rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), ...(dormant ? { server: resolve(import.meta.dirname, "src/server-tunnel/index.html") } : {}) } } },
  server: { allowedHosts: [".artifacts.localhost", ".surfaces.localhost"] }, preview: { allowedHosts: [".artifacts.localhost", ".surfaces.localhost"] } });
