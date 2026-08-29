/**
 * [INPUT]: Depends on macOS security/xcrun, CSC_NAME, APPLE_TEAM_ID, and one complete Apple ID or App Store Connect API notarization credential set
 * [OUTPUT]: Exits zero only when the requested Developer ID identity and notarytool credentials are structurally present
 * [POS]: Fail-closed gate before any macOS release build; ordinary unsigned CI packaging never calls this script
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

const required = ["CSC_NAME", "APPLE_TEAM_ID"];
const missing = required.filter((name) => !process.env[name]?.trim());
const appleIdCredentials =
  process.env.APPLE_ID?.trim() &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim();
const apiKeyCredentials =
  process.env.APPLE_API_KEY?.trim() &&
  process.env.APPLE_API_KEY_ID?.trim() &&
  process.env.APPLE_API_ISSUER?.trim();
if (!appleIdCredentials && !apiKeyCredentials) {
  missing.push(
    "APPLE_ID+APPLE_APP_SPECIFIC_PASSWORD or APPLE_API_KEY+APPLE_API_KEY_ID+APPLE_API_ISSUER"
  );
}
if (process.platform !== "darwin") missing.push("macOS release host");
if (missing.length > 0) {
  throw new Error(`macOS release signing preflight failed: ${missing.join(", ")}`);
}

const identities = spawnSync(
  "security",
  ["find-identity", "-v", "-p", "codesigning"],
  { encoding: "utf8" }
);
if (identities.status !== 0) {
  throw new Error(`security find-identity failed: ${identities.stderr}`);
}
const identity = process.env.CSC_NAME.trim();
const teamId = process.env.APPLE_TEAM_ID.trim();
if (!identities.stdout.includes(identity)) {
  throw new Error(`Developer ID identity is not installed: ${identity}`);
}
if (!identities.stdout.includes(teamId)) {
  throw new Error(`installed identity does not expose expected Team ID: ${teamId}`);
}
const notarytool = spawnSync("xcrun", ["notarytool", "--version"], {
  encoding: "utf8",
});
if (notarytool.status !== 0) {
  throw new Error(`notarytool is unavailable: ${notarytool.stderr}`);
}
process.stdout.write(`macOS signing preflight passed for Team ID ${teamId}\n`);
