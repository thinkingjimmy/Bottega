/**
 * [INPUT]: Depends on node:crypto/fs/path and the runtime model (pins, manifest schema, RuntimeUnavailable).
 * [OUTPUT]: Provides resolveBundledNode: reads only a runtime manifest — packaged, `Resources/runtime/runtime-manifest.json`, with the Node at its fixed place and the digest of the signed binary (a `binary` field is refused); unpackaged, the dev manifest beside the output root that the fetch script writes, whose absolute `binary` must be the pinned release binary. Version, platform and arch are checked and the file's digest verified. Main never knows the dev cache or its variable; never Electron, never PATH's `node`.
 * [POS]: The runtime port's resolver (TASK-35 §2.3); called once, lazily, by the port.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { BUNDLED_NODE, DEV_MANIFEST, FETCH_SCRIPT, RuntimeUnavailable, runtimeManifestSchema } from "./model";

export type BundledNode = { path: string; version: string; sha256: string };
export type NodeLocation = { packaged: boolean; resourcesPath: string; mainDirectory: string; platform: NodeJS.Platform; arch: string };

const fileDigest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const executable = (platform: NodeJS.Platform) => platform === "win32" ? "node.exe" : "node";

function verified(path: string, sha256: string): BundledNode {
  if (!existsSync(path) || !statSync(path).isFile()) throw new RuntimeUnavailable("missing", `The bundled Node is missing at ${path}.`);
  if (fileDigest(path) !== sha256) throw new RuntimeUnavailable("digest-mismatch", `The bundled Node at ${path} does not match its recorded digest.`);
  return { path, version: BUNDLED_NODE.version, sha256 };
}

export function resolveBundledNode(location: NodeLocation): BundledNode {
  const manifestPath = location.packaged ? join(location.resourcesPath, "runtime", "runtime-manifest.json")
    : join(location.mainDirectory, "..", "..", DEV_MANIFEST);
  if (!existsSync(manifestPath)) {
    if (!location.packaged) throw new RuntimeUnavailable("dev-cache-missing",
      `No dev runtime manifest at ${manifestPath}; run node ${FETCH_SCRIPT} --manifest ${manifestPath}.`);
    throw new RuntimeUnavailable("missing", `The runtime manifest is missing at ${manifestPath}.`);
  }
  let node;
  try { node = runtimeManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8"))).node; }
  catch (cause) { throw new RuntimeUnavailable("manifest-invalid", `The runtime manifest at ${manifestPath} is invalid: ${cause instanceof Error ? cause.message : String(cause)}`); }
  if (node.version !== BUNDLED_NODE.version) throw new RuntimeUnavailable("version-mismatch", `The runtime manifest names Node ${node.version}, not ${BUNDLED_NODE.version}.`);
  if (node.platform !== location.platform || node.arch !== location.arch) {
    throw new RuntimeUnavailable("platform-mismatch", `The runtime manifest is for ${node.platform}-${node.arch}, not ${location.platform}-${location.arch}.`);
  }
  if (location.packaged) {
    /* The packaged Node sits at a fixed place; a manifest that points elsewhere is refused, never followed. */
    if (node.binary !== undefined) throw new RuntimeUnavailable("manifest-invalid", `The packaged runtime manifest at ${manifestPath} may not name a binary.`);
    return verified(join(location.resourcesPath, "runtime", "node", `${location.platform}-${location.arch}`, "bin", executable(location.platform)), node.sha256);
  }
  if (!node.binary || !isAbsolute(node.binary)) throw new RuntimeUnavailable("manifest-invalid", `The dev runtime manifest at ${manifestPath} must name an absolute binary.`);
  const release = BUNDLED_NODE.releases[`${location.platform}-${location.arch}`];
  /* Development runs the unmodified release binary: the manifest must name that one, and the file must still be it. */
  if (!release || node.sha256 !== release.nodeSha256) {
    throw new RuntimeUnavailable("digest-mismatch", `The dev runtime manifest does not name the pinned Node ${BUNDLED_NODE.version}; run node ${FETCH_SCRIPT} --manifest ${manifestPath}.`);
  }
  return verified(node.binary, node.sha256);
}
