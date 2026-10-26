/**
 * [INPUT]: The parent origin and per-host shell headers from headers.ts.
 * [OUTPUT]: Credential-free wildcard shell build with the parent origin baked in; dev and preview answer each artifact or surface host with its own headers.
 * [POS]: Loader build boundary; this application has no account SDK or API proxy. Hosted headers come from vercel.ts.
 */
import { defineConfig, type Connect, type Plugin } from "vite";
import { resolve } from "node:path";
import { parentOrigin, shellHeaders, shellKind } from "./headers";
const parent = parentOrigin();
const perHost: Connect.NextHandleFunction = (request, response, next) => {
  const headers = shellHeaders(parent, shellKind((request.headers.host ?? "").split(":")[0]!));
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  next();
};
const hostHeaders: Plugin = { name: "loader-host-headers", configureServer: server => { server.middlewares.use(perHost); }, configurePreviewServer: server => { server.middlewares.use(perHost); } };
export default defineConfig({ define: { __ARTIFACT_PARENT_ORIGIN__: JSON.stringify(parent) }, plugins: [hostHeaders],
  worker: { format: "es" }, build: { rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html") } } },
  server: { allowedHosts: [".artifacts.localhost", ".surfaces.localhost"] }, preview: { allowedHosts: [".artifacts.localhost", ".surfaces.localhost"] } });
