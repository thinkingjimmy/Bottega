/**
 * [INPUT]: Node crypto/filesystem/process APIs, physical repository-root resolution and committed public build configuration.
 * [OUTPUT]: Canonical JSON, public source/configuration identities and packaged application digests. Signing is an explicit build claim, defaulting to ad-hoc.
 * [POS]: Production identity shared by GitHub packaging and private exact-installer acceptance.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const PUBLIC_REPOSITORY = "thinkingjimmy/Bottega";
export const PUBLIC_WORKFLOW = ".github/workflows/build-macos.yml";
export const PRODUCTION_CLOUD = Object.freeze({ environmentId: "cloud-production", deploymentId: "clean-cricket-785",
  appOrigin: "https://app.getbottega.app", authOrigin: "https://app.getbottega.app", convexUrl: "https://clean-cricket-785.convex.cloud",
  httpOrigin: "https://clean-cricket-785.convex.site", callbackScheme: "bottega" });
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
export const digestJson = value => `sha256:${createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex")}`;
export const canonicalJson = value => `${JSON.stringify(sorted(value))}\n`;
export const hashFile = path => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;

export function publicSourceIdentity(root) {
  const git = (args, options = {}) => execFileSync("git", ["--no-replace-objects", "-C", root, ...args], {
    encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...options });
  assert.equal(realpathSync(git(["rev-parse", "--show-toplevel"]).trim()), realpathSync(root), "Public source must be a repository root");
  assert.equal(git(["status", "--porcelain", "--untracked-files=all"]).trim(), "", "Public source must be clean");
  const commit = git(["rev-parse", "HEAD"]).trim(), tree = git(["rev-parse", "HEAD^{tree}"]).trim();
  const entries = git(["ls-tree", "-r", "-z", "HEAD"]).split("\0").filter(Boolean).map(line => {
    const tab = line.indexOf("\t"), match = line.slice(0, tab).match(/^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40})$/);
    assert(tab > 0 && match, "Invalid public source tree entry");
    return { path: line.slice(tab + 1), mode: match[1], type: match[2], oid: match[3] };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const blobs = [...new Set(entries.filter(entry => entry.type === "blob").map(entry => entry.oid))];
  const batch = git(["cat-file", "--batch"], { encoding: null, input: `${blobs.join("\n")}\n` });
  const hashes = new Map(); let offset = 0;
  for (const oid of blobs) {
    const headerEnd = batch.indexOf(10, offset);
    assert(headerEnd >= 0, "Truncated public blob response");
    const header = batch.subarray(offset, headerEnd).toString("ascii").match(/^([a-f0-9]{40}) blob (0|[1-9]\d*)$/);
    assert(header && header[1] === oid, "Public blob response identity mismatch");
    const size = Number(header[2]), start = headerEnd + 1, end = start + size;
    assert(Number.isSafeInteger(size) && end < batch.length && batch[end] === 10, "Invalid public blob response size");
    hashes.set(oid, `sha256:${createHash("sha256").update(batch.subarray(start, end)).digest("hex")}`);
    offset = end + 1;
  }
  assert.equal(offset, batch.length, "Unexpected public blob response bytes");
  assert(entries.length > 0, "Empty public source tree");
  return { commit, tree, digest: digestJson(entries.map(entry => [entry.path, entry.mode,
    entry.type === "commit" ? entry.oid : hashes.get(entry.oid)])), dirty: false };
}

export function publicConfigurationIdentity(desktop, signing = "ad-hoc-unnotarized") {
  assert(["ad-hoc-unnotarized", "developer-id-notarized"].includes(signing), "Invalid public signing claim");
  const files = ["electron-builder.yml", "config/cloud-assembly.ts", "electron.vite.config.ts", "package.json"];
  const assembly = readFileSync(join(desktop, "config/cloud-assembly.ts"), "utf8");
  for (const [key, value] of Object.entries(PRODUCTION_CLOUD)) {
    const literals = [...assembly.matchAll(new RegExp(`\\b${key}\\s*:\\s*["']([^"']+)["']`, "g"))];
    assert.equal(literals.length, 1, `Public cloud ${key} must have one production literal`);
    assert.equal(literals[0][1], value, `Public cloud ${key} mismatch`);
  }
  const vite = readFileSync(join(desktop, "electron.vite.config.ts"), "utf8");
  assert(/const\s+cloudAssembly\s*=\s*resolveCloudAssembly\(["']production["']\)/.test(vite), "Public Vite must select production");
  assert(/const\s+outputRoot\s*=\s*["']out["']/.test(vite), "Public Vite must select out");
  const builder = readFileSync(join(desktop, "electron-builder.yml"), "utf8");
  assert(/^appId: com\.jimmywong\.bottega$/m.test(builder) && /^productName: Bottega$/m.test(builder), "Public builder identity mismatch");
  return { workbenchUi: true, cloud: { ...PRODUCTION_CLOUD }, builder: "electron-builder.yml",
    digest: digestJson(Object.fromEntries(files.map(path => [path, hashFile(join(desktop, path))]))), signing };
}

export function payloadIdentity(root) {
  const facts = [];
  const walk = directory => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), stat = lstatSync(path), key = relative(root, path).split(sep).join("/");
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(path);
        assert(!relative(root, resolve(directory, target)).startsWith(".."), "Payload symlink escapes the application");
        facts.push([key, "link", target]);
      } else if (stat.isDirectory()) walk(path);
      else { assert(stat.isFile(), "Non-file payload entry"); facts.push([key, stat.mode & 0o777, stat.size, hashFile(path)]); }
    }
  };
  walk(root); assert(facts.length > 0, "Empty packaged payload"); return digestJson(facts);
}
