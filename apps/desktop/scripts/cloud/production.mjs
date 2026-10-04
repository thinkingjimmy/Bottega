import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [command, ...extra] = process.argv.slice(2);
if (!["dev", "build"].includes(command) || extra.length) {
  throw new Error("Usage: node scripts/cloud/production.mjs <dev|build>");
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(dirname(createRequire(import.meta.url).resolve("electron-vite/package.json")), "bin/electron-vite.js");
const result = spawnSync(process.execPath, [cli, command], {
  cwd: root, stdio: "inherit",
  env: { ...process.env, BOTTEGA_CLOUD_BUILD: "production", ELECTRON_ENTRY: "out/main/index.js" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
