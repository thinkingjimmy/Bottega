/**
 * [INPUT]: Verified cloud application origin and a fresh random lease identifier.
 * [OUTPUT]: Separate wildcard artifact origins and the matching cloud frame policy.
 * [POS]: Shared routing convention for the cloud reader, artifact shell and deployment headers.
 */
export function artifactOrigin(appOrigin: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("artifact-invalid-lease");
  const app = new URL(appOrigin);
  if (app.origin !== appOrigin) throw new Error("artifact-invalid-origin");
  const local = app.hostname === "localhost";
  if (!local && app.protocol !== "https:") throw new Error("artifact-insecure-origin");
  return `${app.protocol}//art-${id}.artifacts.${app.hostname}${local ? ":5184" : ""}`;
}
export function artifactFrameOriginPolicy(appOrigin: string) {
  const app = new URL(appOrigin);
  return `${app.protocol}//*.artifacts.${app.hostname}${app.hostname === "localhost" ? ":5184" : ""}`;
}
