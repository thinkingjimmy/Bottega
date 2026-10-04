/**
 * [INPUT]: Verified cloud application origin and a fresh random surface lease identifier.
 * [OUTPUT]: One `srf-<lease>.surfaces.<app host>` origin per mount, the matching cloud frame policy and the lease a wrapper reads from its own host.
 * [POS]: Routing convention shared by the Cloud Web surface host, the loader wrapper and its deployment headers; distinct from artifacts/origins.
 */
const LEASE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Local development shares the artifact shell's dev server; the host name, not the port, selects the surface wrapper.
const LOCAL_PORT = ":5184";
function appHost(appOrigin: string) {
  const app = new URL(appOrigin);
  if (app.origin !== appOrigin) throw new Error("surface-invalid-origin");
  const local = app.hostname === "localhost";
  if (!local && app.protocol !== "https:") throw new Error("surface-insecure-origin");
  return { protocol: app.protocol, hostname: app.hostname, port: local ? LOCAL_PORT : "" };
}
export function surfaceOrigin(appOrigin: string, leaseId: string) {
  if (!LEASE.test(leaseId)) throw new Error("surface-invalid-lease");
  const app = appHost(appOrigin);
  return `${app.protocol}//srf-${leaseId}.surfaces.${app.hostname}${app.port}`;
}
export function surfaceFrameOriginPolicy(appOrigin: string) {
  const app = appHost(appOrigin);
  return `${app.protocol}//*.surfaces.${app.hostname}${app.port}`;
}
export function surfaceLeaseFromHost(hostname: string): string | null {
  const match = /^srf-([a-f0-9-]{36})\.surfaces\.[a-z0-9.-]+$/.exec(hostname);
  return match && LEASE.test(match[1]!) ? match[1]! : null;
}
