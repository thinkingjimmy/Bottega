/**
 * [INPUT]: Apple Team ID, codesign, Gatekeeper, stapler, an application path, and either an explicit DMG or the existing release directory.
 * [OUTPUT]: Verifies strict nested Developer ID signatures, hardened runtime, helper entitlements, the bundled Node's own signature, Gatekeeper, and the application notarization ticket. A requested DMG must exist; electron-builder 26.15.3 does not staple that container. Failures retain process status, signal, spawn errors and both output streams without adding command arguments or environment dumps.
 * [POS]: macOS release verification; distribution supplies exact fresh artifacts instead of newest-file inference.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { readPackagedProduct } from "./distribution/product-artifact.mjs";

const desktop = join(import.meta.dirname, "..");
const release = join(desktop, "release");
const { productName } = readPackagedProduct(desktop);
const teamId = process.env.APPLE_TEAM_ID?.trim();
if (!teamId) throw new Error("APPLE_TEAM_ID is required for signature verification");

const newest = (paths) =>
  paths.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
const args = process.argv.slice(2);
const explicitApp = args[0] === "--app" && (args.length === 2 || (args.length === 4 && args[2] === "--dmg"));
if (args.length && !explicitApp) throw new Error("Expected --app <path> or --app <path> --dmg <path>");
const app = explicitApp ? args[1] : newest(
  readdirSync(release)
    .filter((name) => name.startsWith("mac"))
    .map((name) => join(release, name, `${productName}.app`))
    .filter(existsSync)
);
const dmg = args.length === 2 ? undefined : explicitApp ? args[3] : newest(
  readdirSync(release)
    .filter((name) => name.endsWith(".dmg"))
    .map((name) => join(release, name))
);
if (!app || !existsSync(app)) throw new Error("signed app is missing");
if (args.length !== 2 && (!dmg || !existsSync(dmg) || !statSync(dmg).isFile())) throw new Error("signed DMG is missing");

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const failure = {
      status: result.status,
      signal: result.signal,
      error: result.error ? {
        name: result.error.name, message: result.error.message, code: result.error.code ?? null,
      } : null,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
    throw new Error(`${command} verification failed:\n${JSON.stringify(failure, null, 2)}`);
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
const screenHelper = join(app, "Contents", "Resources", "presence", "bin", "screen-bridge");
const previewHelper = join(app, "Contents", "Resources", "tunnel", "bin", "preview-capture");
if (!existsSync(previewHelper)) throw new Error("preview capture helper is missing");
run("codesign", ["--verify", "--strict", "--verbose=4", previewHelper]);
const previewSignature = run("codesign", ["-dv", "--verbose=4", previewHelper]);
if (!previewSignature.includes(`TeamIdentifier=${teamId}`) || !/flags=.*runtime/.test(previewSignature)) throw new Error("preview capture helper signature policy mismatch");
if (!existsSync(screenHelper)) throw new Error("presence screen helper is missing");
run("codesign", ["--verify", "--strict", "--verbose=4", screenHelper]);
const screenSignature = run("codesign", ["-dv", "--verbose=4", screenHelper]);
if (!screenSignature.includes(`TeamIdentifier=${teamId}`) || !/flags=.*runtime/.test(screenSignature)) {
  throw new Error("presence screen helper signature policy mismatch");
}
const bundledNode = join(app, "Contents", "Resources", "runtime", "node", "darwin-arm64", "bin", "node");
if (!existsSync(bundledNode)) throw new Error("bundled Node is missing");
run("codesign", ["--verify", "--strict", "--verbose=4", bundledNode]);
const nodeSignature = run("codesign", ["-dv", "--verbose=4", bundledNode]);
if (!nodeSignature.includes("Authority=Developer ID Application") || !nodeSignature.includes(`TeamIdentifier=${teamId}`) || !/flags=.*runtime/.test(nodeSignature)) {
  throw new Error("bundled Node signature policy mismatch");
}
const nodeEntitlements = run("codesign", ["-d", "--entitlements", ":-", bundledNode]);
if (!nodeEntitlements.includes("com.apple.security.cs.allow-jit") || !nodeEntitlements.includes("com.apple.security.cs.disable-library-validation")) {
  throw new Error("bundled Node is missing its own entitlements");
}
if (nodeEntitlements.includes("com.apple.security.automation.apple-events")) {
  throw new Error("bundled Node inherited app entitlements");
}
// Bottega Dock: the bridge sends the one Finder Apple Event, so hardened runtime must carry the entitlement;
// the recovery agent is launched by launchd from the bundled plist and must be team-signed like the app.
for (const name of ["system-dock-bridge", "bottega-dock-recovery", "dock-glass.node"]) {
  const helper = join(app, "Contents", "Resources", "system-dock", "bin", name);
  if (!existsSync(helper)) throw new Error(`Bottega Dock helper is missing: ${name}`);
  run("codesign", ["--verify", "--strict", "--verbose=4", helper]);
  const details = run("codesign", ["-dv", "--verbose=4", helper]);
  if (!details.includes(`TeamIdentifier=${teamId}`) || !/flags=.*runtime/.test(details)) {
    throw new Error(`Bottega Dock helper signature policy mismatch: ${name}`);
  }
}
const dockEntitlements = run("codesign", ["-d", "--entitlements", ":-", join(app, "Contents", "Resources", "system-dock", "bin", "system-dock-bridge")]);
if (!dockEntitlements.includes("com.apple.security.automation.apple-events")) {
  throw new Error("Bottega Dock bridge is missing the Apple Events entitlement");
}
const launchAgents = join(app, "Contents", "Library", "LaunchAgents");
if (!existsSync(launchAgents) || !readdirSync(launchAgents).some((name) => name.endsWith(".dock-recovery.plist"))) {
  throw new Error("Bottega Dock recovery LaunchAgent plist is missing");
}
run("spctl", ["-a", "-vv", "--type", "execute", app]);
// electron-builder 26.15.3 calls notarize() from sign(), which staples this .app, before DMG and ZIP targets run.
// DmgTarget never notarizes the disk image, and dmg.sign is unset, so the container has no ticket.
run("xcrun", ["stapler", "validate", app]);
process.stdout.write(`strict signing and notarization verification passed: ${app}\n`);
