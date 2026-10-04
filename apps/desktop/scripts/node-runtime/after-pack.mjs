/**
 * [INPUT]: Depends on fetch-node.mjs (fetchNodeRuntime: the verified cache or a verified online fetch; manifestNodeSection), the build's runtime-entries.json beside the main bundle (the foundation's entries/packages), resources/entitlements.node.plist, and /usr/bin/codesign.
 * [OUTPUT]: Provides the electron-builder afterPack hook (default export) and its parts: assertPinned, nodeSigningMode, readRuntimeEntries, packBundledNode, adHocSign, NODE_ENTITLEMENTS, NODE_ENTITLEMENTS_PLIST, runtimePaths.
 * [POS]: TASK-34's packaging step for the bundled Node: every packaging path (dist, dist:verify, dist:release:mac, the public release workflow) runs it; runtime/node.ts is the reader of what it writes.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fetchNodeRuntime, manifestNodeSection, pinFor } from "./fetch-node.mjs";

const run = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** electron-builder's Arch enum (builder-util), by value. */
const ARCH = ["ia32", "x64", "armv7l", "arm64", "universal"];
export const NODE_VERSION = "24.18.0";
export const NODE_ENTITLEMENTS_PLIST = fileURLToPath(new URL("../../resources/entitlements.node.plist", import.meta.url));
/** The only entitlements the bundled Node may carry; the packaged verifier refuses any other. */
export const NODE_ENTITLEMENTS = Object.freeze(["com.apple.security.cs.allow-jit", "com.apple.security.cs.disable-library-validation"]);

/** The fixed layout runtime/node.ts reads; the binary is never named in the manifest. */
export function runtimePaths(resourcesPath, platform, arch) {
  const root = join(resourcesPath, "runtime"), home = join(root, "node", `${platform}-${arch}`);
  return { root, manifest: join(root, "runtime-manifest.json"), home,
    binary: join(home, "bin", platform === "win32" ? "node.exe" : "node"), license: join(home, "LICENSE") };
}

/**
 * Ad-hoc only until part 2b: an unsigned or ad-hoc app gets an ad-hoc Node with its own entitlements. A Developer ID
 * identity is refused, never answered with an ad-hoc Node inside a Developer-ID app.
 */
export function nodeSigningMode({ identity, forceCodeSigning = false, env = process.env }) {
  if (identity === "-" || identity === null) return "ad-hoc";
  const discovery = env.CSC_IDENTITY_AUTO_DISCOVERY === "false" && !env.CSC_LINK && !env.CSC_NAME;
  if (identity === undefined && discovery && !forceCodeSigning) return "ad-hoc";
  throw new Error("Signing the bundled Node with a Developer ID identity is TASK-34 part 2b, which waits for the Apple Developer membership; package ad-hoc (mac.identity=-) or unsigned (mac.identity=null).");
}

const DIGEST = /^[0-9a-f]{64}$/;
const relativePath = (value) => typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.split(/[\\/]/).includes("..");
const record = (value, field) => value && typeof value === "object" && relativePath(value[field]) && DIGEST.test(value.sha256)
  && Number.isSafeInteger(value.bytes) && value.bytes >= 0;
const table = (value) => value && typeof value === "object" && !Array.isArray(value);

/** The foundation's build output, taken as is: validated, never recomputed or reordered. */
export async function readRuntimeEntries(path) {
  const text = await readFile(path, "utf8").catch(() => { throw new Error(`The runtime entries file is missing at ${path}; build the desktop before packaging.`); });
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`The runtime entries file at ${path} does not parse.`); }
  if (parsed?.schemaVersion !== 1) throw new Error(`The runtime entries file at ${path} has schemaVersion ${JSON.stringify(parsed?.schemaVersion)}; this packaging step reads 1.`);
  const { entries, packages } = parsed;
  if (!table(entries) || !Object.values(entries).every(entry => record(entry, "file"))
    || !table(packages) || !Object.values(packages).every(entry => record(entry, "path")))
    throw new Error(`The runtime entries file at ${path} has an entry that is not { file|path, sha256, bytes }.`);
  return { entries, packages };
}

export async function adHocSign(binary, entitlements = NODE_ENTITLEMENTS_PLIST) {
  await run("/usr/bin/codesign", ["--force", "--sign", "-", "--options", "runtime", "--timestamp=none", "--entitlements", entitlements, binary]);
}

/**
 * Places exactly bin/node and LICENSE, signs the placed copy, and records the digest of the signed bytes: the packaged
 * port compares against that, not the release digest (which `source` keeps).
 */
export async function packBundledNode({ resourcesPath, platform, arch, node, runtimeEntries, sign }) {
  const paths = runtimePaths(resourcesPath, platform, arch);
  await rm(paths.root, { recursive: true, force: true });
  await mkdir(dirname(paths.binary), { recursive: true });
  await copyFile(node.binary, paths.binary);
  await copyFile(node.license, paths.license);
  await chmod(paths.binary, 0o755);
  if (sha256(await readFile(paths.binary)) !== node.sha256) throw new Error(`The Node copied into ${paths.binary} is not the verified one.`);
  await sign(paths.binary);
  const signed = await readFile(paths.binary);
  const section = manifestNodeSection({ ...node, sha256: sha256(signed), bytes: (await stat(paths.binary)).size,
    source: { ...node.source, releaseBinarySha256: node.sha256, codeSignature: "ad-hoc" } });
  const manifest = { schemaVersion: 1, node: section, entries: runtimeEntries.entries, packages: runtimeEntries.packages };
  await writeFile(paths.manifest, JSON.stringify(manifest, null, 2) + "\n");
  return { paths, manifest };
}

/** An installer without a pinned Node could not run an Agent turn: it is not built. */
export function assertPinned(platform, arch) {
  try { pinFor(NODE_VERSION, platform, arch); }
  catch { throw new Error(`No pinned Node ${NODE_VERSION} for ${platform}-${arch}; the bundled Node for Windows/Linux is TASK-35 slices 8/9, and an installer without it cannot run an Agent turn.`); }
}

/** The packaged package.json's `main` (extraMetadata wins, as it does in the asar) names the directory of runtime-entries.json. */
async function entriesPath(packager) {
  const main = packager.config.extraMetadata?.main ?? packager.info.metadata.main;
  if (typeof main !== "string") throw new Error("The packaged package.json names no main; runtime-entries.json cannot be found.");
  return join(packager.info.appDir, dirname(main), "runtime-entries.json");
}

export default async function afterPack(context) {
  const platform = context.electronPlatformName === "mas" ? "darwin" : context.electronPlatformName;
  const arch = ARCH[context.arch] ?? String(context.arch);
  assertPinned(platform, arch);
  const packager = context.packager;
  if (platform === "darwin") nodeSigningMode({ identity: packager.platformSpecificBuildOptions.identity, forceCodeSigning: packager.forceCodeSigning });
  const runtimeEntries = await readRuntimeEntries(await entriesPath(packager));
  const node = await fetchNodeRuntime({ version: NODE_VERSION, platform, arch });
  const { paths, manifest } = await packBundledNode({ resourcesPath: packager.getResourcesDir(context.appOutDir), platform, arch, node, runtimeEntries,
    sign: platform === "darwin" ? adHocSign : async () => {} });
  console.log(`[bundled-node] ${paths.binary} ${manifest.node.bytes} bytes, signed sha256 ${manifest.node.sha256} (release ${node.sha256})`);
}
