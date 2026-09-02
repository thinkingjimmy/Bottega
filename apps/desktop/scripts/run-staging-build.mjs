/**
 * [INPUT]: Depends on BOTTEGA_STAGING_VERSION, BOTTEGA_STAGING_FEED_URL, the staging builder config, pnpm and electron-builder
 * [OUTPUT]: Builds one real staging package whose embedded version and update channel match the staging feed convention
 * [POS]: Layer-2 updater build driver; it creates bytes but never uploads or publishes them
 */

import { spawnSync } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";

const version = process.env.BOTTEGA_STAGING_VERSION?.trim();
const feed = process.env.BOTTEGA_STAGING_FEED_URL?.trim();
if (!/^0\.1\.0-staging\.\d+$/.test(version ?? "")) {
  throw new Error("BOTTEGA_STAGING_VERSION must match 0.1.0-staging.N");
}
if (!feed || new URL(feed).protocol !== "http:") {
  throw new Error("BOTTEGA_STAGING_FEED_URL must be an explicit local/internal HTTP URL");
}

run("pnpm", ["build"]);
run("pnpm", [
  "exec",
  "electron-builder",
  "--config",
  "electron-builder.staging.yml",
  "--publish",
  "never",
  `-c.extraMetadata.version=${version}`,
]);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? -1}`);
  }
}
