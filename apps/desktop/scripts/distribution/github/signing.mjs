/**
 * [INPUT]: GitHub Actions runner environment, base64 Developer ID PKCS#12, App Store Connect .p8 contents, and macOS security/notarytool.
 * [OUTPUT]: Fail-closed signing admission, a temporary keychain, notarization credential paths, and strict signature verification of the stapled application and the application extracted from the ZIP, with complete subprocess failure fields and no added argument or environment dumps.
 * [POS]: Public workflow signing boundary; build-only never calls it, and Bottega-Dev holds no signing secrets.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export const RELEASE_SECRET_NAMES = Object.freeze(["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_TEAM_ID", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]);
const SIGNING_ENV = Object.freeze([...RELEASE_SECRET_NAMES, "CSC_NAME", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD"]);
const TEAM = /^[A-Z0-9]{10}$/;
const KEY_ID = /^[A-Z0-9]{10}$/;
const ISSUER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_IDENTITY = /^[^\r\n:]+ \([A-Z0-9]{10}\)$/;

export function signingForMode(mode) {
  if (mode === "build-only") return "ad-hoc-unnotarized";
  if (mode === "signed" || mode === "draft") return "developer-id-notarized";
  throw new Error("Expected build-only, signed, or draft mode");
}

function apiKeyMaterial(value) {
  const text = String(value).replace(/\r\n/g, "\n").trim();
  if (!text.includes("BEGIN PRIVATE KEY") || !text.includes("END PRIVATE KEY") || text.includes("BEGIN CERTIFICATE")) {
    throw new Error("APPLE_API_KEY must be the App Store Connect API .p8 contents");
  }
  return `${text}\n`;
}

function decodeP12(value) {
  const compact = String(value).replace(/\s+/g, "");
  if (compact.length < 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error("CSC_LINK must be the base64 contents of a Developer ID .p12");
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length < 64 || bytes[0] !== 0x30) throw new Error("CSC_LINK did not decode to a PKCS#12 certificate");
  return bytes;
}

/** Structural presence only. Missing or malformed material throws before any keychain or build. */
export function assertSigningSecrets(env = process.env) {
  const missing = RELEASE_SECRET_NAMES.filter(name => !String(env[name] ?? "").trim());
  if (missing.length) throw new Error(`macOS release signing preflight failed: ${missing.join(", ")}`);
  const teamId = env.APPLE_TEAM_ID.trim();
  const keyId = env.APPLE_API_KEY_ID.trim();
  const issuer = env.APPLE_API_ISSUER.trim();
  if (!TEAM.test(teamId)) throw new Error("APPLE_TEAM_ID must be a 10-character Apple Team ID");
  if (!KEY_ID.test(keyId)) throw new Error("APPLE_API_KEY_ID must be a 10-character App Store Connect key id");
  if (!ISSUER.test(issuer)) throw new Error("APPLE_API_ISSUER must be the App Store Connect issuer UUID");
  return { teamId, keyId, issuer, p12: decodeP12(env.CSC_LINK), password: env.CSC_KEY_PASSWORD, apiKey: apiKeyMaterial(env.APPLE_API_KEY) };
}

export function unsignedPackagingEnvironment(env = process.env) {
  const next = { ...env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
  for (const name of SIGNING_ENV) delete next[name];
  delete next.BOTTEGA_SIGNING_DIR;
  return next;
}

/** Values electron-builder reads after the temporary keychain exists. The .p12 and its password are not forwarded. */
export function preparedSigningEnvironment(env = process.env) {
  assertPreparedSigning(env);
  const next = { ...env, CSC_IDENTITY_AUTO_DISCOVERY: "true" };
  for (const name of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD"]) delete next[name];
  return next;
}

export function assertPreparedSigning(env = process.env) {
  if (process.platform !== "darwin") throw new Error("macOS release signing preflight failed: macOS release host");
  const teamId = String(env.APPLE_TEAM_ID ?? "").trim();
  const keyId = String(env.APPLE_API_KEY_ID ?? "").trim();
  const issuer = String(env.APPLE_API_ISSUER ?? "").trim();
  const identity = String(env.CSC_NAME ?? "").trim();
  const apiKey = String(env.APPLE_API_KEY ?? "").trim();
  const missing = [];
  if (!TEAM.test(teamId)) missing.push("APPLE_TEAM_ID");
  if (!KEY_ID.test(keyId)) missing.push("APPLE_API_KEY_ID");
  if (!ISSUER.test(issuer)) missing.push("APPLE_API_ISSUER");
  if (!SHORT_IDENTITY.test(identity) || !identity.endsWith(`(${teamId})`)) missing.push("CSC_NAME");
  if (!apiKey || !existsSync(apiKey)) missing.push("APPLE_API_KEY");
  if (missing.length) throw new Error(`macOS release signing preflight failed: ${missing.join(", ")}`);
  const header = readFileSync(apiKey).subarray(0, 80).toString("utf8");
  if (!header.includes("BEGIN PRIVATE KEY")) throw new Error("APPLE_API_KEY is not an App Store Connect private key file");
  return { teamId, identity, apiKey };
}

function contained(root, path) {
  if (!root || !isAbsolute(root) || !isAbsolute(path)) return false;
  const from = relative(resolve(root), resolve(path));
  return from === "" || (!from.startsWith("..") && !isAbsolute(from));
}

function exportGitHubEnv(name, value) {
  const file = process.env.GITHUB_ENV;
  if (!file) throw new Error("GITHUB_ENV is required to pass signing paths to later steps");
  assert(!/[\r\n]/.test(value), `Refusing to export ${name}`);
  appendFileSync(file, `${name}=${value}\n`);
}

function security(args, redactions) {
  const result = spawnSync("/usr/bin/security", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    let detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    for (const secret of redactions) if (secret) detail = detail.replaceAll(secret, "[redacted]");
    throw new Error(`security ${args[0]} failed${detail ? `: ${detail}` : ""}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function quotedIdentities(text) {
  return [...text.matchAll(/"([^"\r\n]+)"/g)].map(match => match[1]);
}

export function prepareSigning(env = process.env) {
  const material = assertSigningSecrets(env);
  if (process.platform !== "darwin") throw new Error("macOS release signing preflight failed: macOS release host");
  const notary = spawnSync("xcrun", ["notarytool", "--version"], { encoding: "utf8" });
  if (notary.status !== 0) throw new Error("notarytool is unavailable");
  const root = env.RUNNER_TEMP && isAbsolute(env.RUNNER_TEMP) ? env.RUNNER_TEMP : tmpdir();
  const dir = join(root, `bottega-signing-${randomBytes(8).toString("hex")}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  if (env.GITHUB_ENV) exportGitHubEnv("BOTTEGA_SIGNING_DIR", dir);
  const keychainPassword = randomBytes(32).toString("hex");
  const keychain = join(dir, "signing.keychain-db");
  const p12 = join(dir, "developer-id.p12");
  const apiKey = join(dir, "AuthKey.p8");
  const redactions = [material.password, keychainPassword];
  try {
    writeFileSync(p12, material.p12, { mode: 0o600 });
    chmodSync(p12, 0o600);
    writeFileSync(apiKey, material.apiKey, { mode: 0o600 });
    chmodSync(apiKey, 0o600);
    const original = security(["list-keychains", "-d", "user"], redactions);
    writeFileSync(join(dir, "keychains.txt"), original.endsWith("\n") ? original : `${original}\n`, { mode: 0o600 });
    security(["create-keychain", "-p", keychainPassword, keychain], redactions);
    writeFileSync(join(dir, "keychain.path"), keychain, { mode: 0o600 });
    security(["set-keychain-settings", "-lut", "21600", keychain], redactions);
    security(["unlock-keychain", "-p", keychainPassword, keychain], redactions);
    const existing = [...original.matchAll(/"([^"]+)"/g)].map(match => match[1]);
    security(["list-keychains", "-d", "user", "-s", keychain, ...existing], redactions);
    security(["import", p12, "-k", keychain, "-f", "pkcs12", "-P", material.password, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security", "-T", "/usr/bin/productsign", "-T", "/usr/bin/productbuild"], redactions);
    security(["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", keychainPassword, keychain], redactions);
    rmSync(p12, { force: true });
    const found = quotedIdentities(security(["find-identity", "-v", "-p", "codesigning", keychain], redactions))
      .filter(name => name.startsWith("Developer ID Application: ") && name.endsWith(`(${material.teamId})`));
    if (found.length !== 1) throw new Error(`Expected one Developer ID Application identity for Team ID ${material.teamId}`);
    const identity = found[0].slice("Developer ID Application: ".length);
    if (!SHORT_IDENTITY.test(identity)) throw new Error("Imported Developer ID identity has an unexpected name");
    if (env.GITHUB_ENV) {
      exportGitHubEnv("CSC_NAME", identity);
      exportGitHubEnv("APPLE_API_KEY", apiKey);
      exportGitHubEnv("APPLE_API_KEY_ID", material.keyId);
      exportGitHubEnv("APPLE_API_ISSUER", material.issuer);
      exportGitHubEnv("APPLE_TEAM_ID", material.teamId);
    }
    process.stdout.write(`macOS signing preflight passed for Team ID ${material.teamId}\n`);
    return { teamId: material.teamId, identity, apiKey, directory: dir };
  } catch (error) {
    rmSync(p12, { force: true });
    throw error;
  }
}

function restoreKeychains(dir, keychain) {
  const saved = join(dir, "keychains.txt");
  if (!existsSync(saved)) return;
  const paths = [...readFileSync(saved, "utf8").matchAll(/"([^"]+)"/g)].map(match => match[1]).filter(path => path && path !== keychain);
  if (paths.length) spawnSync("/usr/bin/security", ["list-keychains", "-d", "user", "-s", ...paths], { encoding: "utf8" });
}

export function cleanupSigning(env = process.env) {
  const dir = String(env.BOTTEGA_SIGNING_DIR ?? "").trim();
  if (!dir) {
    process.stdout.write("No temporary signing directory to remove\n");
    return;
  }
  const root = env.RUNNER_TEMP && isAbsolute(env.RUNNER_TEMP) ? env.RUNNER_TEMP : "";
  if (!contained(root, dir)) throw new Error("Refusing to clean a signing directory outside the runner temporary directory");
  const keychainFile = join(dir, "keychain.path");
  const keychain = existsSync(keychainFile) ? readFileSync(keychainFile, "utf8").trim() : "";
  if (keychain && !contained(dir, keychain)) throw new Error("Refusing to delete a keychain outside the signing directory");
  if (keychain) {
    const removed = spawnSync("/usr/bin/security", ["delete-keychain", keychain], { encoding: "utf8" });
    if (removed.status !== 0 && existsSync(keychain)) throw new Error("Temporary keychain could not be deleted");
  }
  if (existsSync(dir)) restoreKeychains(dir, keychain);
  rmSync(dir, { recursive: true, force: true });
  if (existsSync(dir) || (keychain && existsSync(keychain))) throw new Error("Signing material remains after cleanup");
  process.stdout.write("Temporary signing material removed\n");
}

/** Top-level name of the one real application directory inside a shipped macOS ZIP. */
export function applicationBundleName(entries) {
  const bundles = [];
  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry?.name;
    const kind = typeof entry === "string" ? "directory" : entry?.kind;
    if (typeof name !== "string" || name.length === 0 || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      throw new Error("ZIP entry escapes the archive");
    }
    if (!name.endsWith(".app")) continue;
    if (kind !== "directory") throw new Error("ZIP application bundle must be a real directory");
    bundles.push(name);
  }
  if (bundles.length !== 1) throw new Error(`Expected one application bundle in the ZIP, found ${bundles.length}`);
  return bundles[0];
}

/**
 * electron-builder 26.15.3 notarizes and attaches the ticket to the .app inside sign(),
 * before packageInDistributableFormat builds the DMG and ZIP. The ZIP cannot carry a ticket.
 * DmgTarget does not notarize the disk image, and dmg.sign is unset, so the DMG is not a subject either.
 */
export function notarizationStaplePlan({ appPath, extractedAppPath, dmgPath, zipPath }) {
  if (!String(dmgPath).endsWith(".dmg")) throw new Error("DMG path is not an installer");
  if (!String(zipPath).endsWith(".zip")) throw new Error("ZIP path is not an installer");
  const subjects = [appPath, extractedAppPath];
  for (const subject of subjects) {
    if (!String(subject).endsWith(".app")) throw new Error("Notarization ticket validation requires an application bundle");
  }
  if (subjects.includes(dmgPath) || subjects.includes(zipPath)) throw new Error("Installer containers are not ticket subjects");
  return { subjects, containers: [dmgPath, zipPath] };
}

function verifyApplication(appPath, teamId, dmgPath) {
  const script = join(import.meta.dirname, "../../verify-macos-signing.mjs");
  const args = [script, "--app", appPath];
  if (dmgPath) args.push("--dmg", dmgPath);
  const verified = spawnSync(process.execPath, args, {
    encoding: "utf8", env: { ...process.env, APPLE_TEAM_ID: teamId }, maxBuffer: 16 * 1024 * 1024 });
  if (verified.error || verified.status !== 0) {
    const failure = {
      status: verified.status,
      signal: verified.signal,
      error: verified.error ? {
        name: verified.error.name, message: verified.error.message, code: verified.error.code ?? null,
      } : null,
      stdout: verified.stdout ?? "",
      stderr: verified.stderr ?? "",
    };
    throw new Error(`Developer ID verification failed:\n${JSON.stringify(failure, null, 2)}`);
  }
}

function extractZipApplication(zipPath) {
  const root = mkdtempSync(join(tmpdir(), "bottega-zip-app-"));
  try {
    const extracted = spawnSync("/usr/bin/ditto", ["-x", "-k", zipPath, root], { encoding: "utf8", timeout: 180_000 });
    if (extracted.status !== 0) {
      const detail = `${extracted.stderr ?? ""}${extracted.stdout ?? ""}`.trim() || extracted.error?.message || "unknown";
      throw new Error(`ZIP extraction failed: ${detail}`);
    }
    const entries = readdirSync(root, { withFileTypes: true }).map(entry => ({
      name: entry.name,
      kind: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : "file",
    }));
    const appPath = join(root, applicationBundleName(entries));
    if (!contained(root, appPath)) throw new Error("ZIP application escapes the extraction directory");
    return { root, appPath };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function verifyNotarizedInstallers({ appPath, dmgPath, zipPath, teamId }) {
  assert(TEAM.test(teamId), "APPLE_TEAM_ID is required to verify a notarized installer");
  if (!existsSync(dmgPath) || !statSync(dmgPath).isFile()) throw new Error("DMG installer is missing");
  if (!existsSync(zipPath) || !statSync(zipPath).isFile()) throw new Error("ZIP installer is missing");
  const extracted = extractZipApplication(zipPath);
  try {
    const plan = notarizationStaplePlan({ appPath, extractedAppPath: extracted.appPath, dmgPath, zipPath });
    verifyApplication(plan.subjects[0], teamId, dmgPath);
    verifyApplication(plan.subjects[1], teamId);
    process.stdout.write(`strict signing and notarization verification passed: ${plan.subjects[1]}\n`);
  } finally {
    rmSync(extracted.root, { recursive: true, force: true });
  }
}
