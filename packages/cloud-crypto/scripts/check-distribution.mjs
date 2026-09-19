/**
 * [INPUT]: Depends on the exact installed sumo package pair, their original ISC license bytes, and optional emitted notice copies.
 * [OUTPUT]: Rejects dependency, license identity or shipped-copy drift before distribution.
 * [POS]: Client crypto distribution check shared by package, desktop and browser builds.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.8.4";
const names = ["libsodium-sumo", "libsodium-wrappers-sumo"];
const licenseHash = "ce7b8ba14db085aadb72359226ccf7273225db31dad653242a7726a10dabbbd4";
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const notice = readFileSync(join(packageRoot, "NOTICE.txt"));
assert.equal(createHash("sha256").update(notice).digest("hex"), licenseHash, "Crypto ISC notice identity changed");
for (const name of names) {
  assert.equal(manifest.dependencies[name], version, `${name} must use the reviewed exact release`);
  const installed = join(packageRoot, "node_modules", name);
  const metadata = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(metadata.name, name, `${name} installed identity changed`);
  assert.equal(metadata.version, version, `${name} installed version changed`);
  assert.equal(metadata.license, "ISC", `${name} SPDX identity changed`);
  assert(notice.equals(readFileSync(join(installed, "LICENSE"))), `${name} ISC license bytes changed`);
}
let copies = 0;
for (let index = 2; index < process.argv.length; index += 2) {
  assert.equal(process.argv[index], "--copy", "Expected --copy <emitted-notice-path>");
  const path = process.argv[index + 1];
  assert(path && !path.startsWith("--"), "A notice copy path is required");
  assert(notice.equals(readFileSync(resolve(path))), `Emitted crypto notice differs: ${path}`);
  copies += 1;
}
process.stdout.write(`[crypto-distribution] ${names.join(" + ")} ${version}; ISC ${notice.byteLength} bytes; ${copies} emitted copies verified\n`);
