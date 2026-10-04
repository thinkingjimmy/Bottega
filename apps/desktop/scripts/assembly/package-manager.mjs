/**
 * [INPUT]: Depends on Node fs/path and the workspace root package.json#packageManager pin
 * [OUTPUT]: Provides builderEnvironment, the environment every direct electron-builder spawn uses so it collects node_modules with the pnpm collector
 * [POS]: Shared by the cloud packaging launcher, the local dist smoke and the staging build. electron-builder looks for a package manager only in apps/desktop (no pin, no lockfile) and otherwise falls back to `npm_config_user_agent`; run as plain `node`, that fallback is npm, whose collector silently drops optional dependencies such as sharp's platform binary
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const workspaceRoot = resolve(import.meta.dirname, "..", "..", "..", "..");

export function builderEnvironment(inherited = process.env) {
  const { packageManager } = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
  if (!/^pnpm@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageManager ?? "")) throw new Error("Packaging requires the workspace pnpm version pin");
  return { ...inherited, npm_config_user_agent: packageManager.replace("@", "/") };
}
