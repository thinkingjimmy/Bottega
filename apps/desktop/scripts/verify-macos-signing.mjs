/**
 * [INPUT]: Depends on release/mac-* Bottega.app and DMG, APPLE_TEAM_ID, codesign, spctl, and stapler
 * [OUTPUT]: Verifies strict deep signatures, Developer ID authority, Team ID, hardened runtime, helper entitlements, Gatekeeper, and notarization staple
 * [POS]: Terminal fail-closed oracle for signed macOS release bytes; successful packaging alone is never sufficient
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { readPackagedProduct } from "./product-artifact.mjs";

const desktop = join(import.meta.dirname, "..");
const release = join(desktop, "release");
const { productName } = readPackagedProduct(desktop);
const teamId = process.env.APPLE_TEAM_ID?.trim();
if (!teamId) throw new Error("APPLE_TEAM_ID is required for signature verification");

const newest = (paths) =>
  paths.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
const app = newest(
  readdirSync(release)
    .filter((name) => name.startsWith("mac"))
    .map((name) => join(release, name, `${productName}.app`))
    .filter(existsSync)
);
const dmg = newest(
  readdirSync(release)
    .filter((name) => name.endsWith(".dmg"))
    .map((name) => join(release, name))
);
if (!app || !dmg) throw new Error("signed app or DMG is missing");

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
};

run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", app]);
const signature = run("codesign", ["-dv", "--verbose=4", app]);
if (!signature.includes("Authority=Developer ID Application")) {
  throw new Error("app is not signed by a Developer ID Application authority");
}
if (!signature.includes(`TeamIdentifier=${teamId}`)) {
  throw new Error(`app Team ID does not match ${teamId}`);
}
if (!/flags=.*runtime/.test(signature)) {
  throw new Error("app signature is missing hardened-runtime flag");
}

const helperApps = readdirSync(join(app, "Contents", "Frameworks"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
  .map((entry) => join(app, "Contents", "Frameworks", entry.name));
if (helperApps.length === 0) throw new Error("Electron helper applications are missing");
for (const helper of helperApps) {
  run("codesign", ["--verify", "--strict", "--verbose=4", helper]);
  const details = run("codesign", ["-dv", "--verbose=4", helper]);
  if (!details.includes(`TeamIdentifier=${teamId}`) || !/flags=.*runtime/.test(details)) {
    throw new Error(`helper signature policy mismatch: ${helper}`);
  }
  const entitlements = run("codesign", ["-d", "--entitlements", ":-", helper]);
  if (!entitlements.includes("com.apple.security.cs.allow-jit")) {
    throw new Error(`helper inherited entitlements are missing allow-jit: ${helper}`);
  }
}
run("spctl", ["-a", "-vv", "--type", "execute", app]);
run("xcrun", ["stapler", "validate", app]);
run("xcrun", ["stapler", "validate", dmg]);
process.stdout.write(`strict signing and notarization verification passed: ${dmg}\n`);
