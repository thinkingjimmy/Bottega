/**
 * [INPUT]: Depends on apps/desktop/runtime-dependencies.json, apps/desktop/package.json, electron-builder.yml text, and the installed adapter package.json for cross-declared versions
 * [OUTPUT]: Exits non-zero unless package.json dependencies equal the manifest package set with identical exact versions, every manifest field is well-formed, cross-declared versions match their owner, and electron-builder.yml carries every excludedGlobs negation
 * [POS]: First segment of the desktop build script and the pre-build half of the single-authority dependency contract; the packaged-artifact half lives in smoke-dist.mjs. Written as `node scripts/…` so the public sync keeps it in the public build
 */

/* global process */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRequire = createRequire(join(desktopRoot, "package.json"));
const read = (path) => JSON.parse(readFileSync(join(desktopRoot, path), "utf8"));

const ROLES = new Set(["main", "appGui", "adapter"]);
const GATES = new Set(["gate-1", "gate-2", "gate-3"]);
const ADMISSIONS = new Set(["core", "gate-3", "base-ui", "icons"]);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const manifest = read("runtime-dependencies.json");
const desktopPackage = read("package.json");
const builderConfig = readFileSync(join(desktopRoot, "electron-builder.yml"), "utf8");
const failures = [];
const fail = (message) => failures.push(message);

if (manifest.schema !== "bottega.runtime-dependencies/v1") {
  fail(`unknown manifest schema: ${manifest.schema}`);
}

const packages = manifest.packages ?? {};
for (const [name, entry] of Object.entries(packages)) {
  if (!EXACT_VERSION.test(entry.version ?? "")) fail(`${name}: version must be exact, got ${entry.version}`);
  if (!Array.isArray(entry.roles) || entry.roles.length === 0 || entry.roles.some((role) => !ROLES.has(role))) {
    fail(`${name}: roles must be a non-empty subset of ${[...ROLES].join("/")}`);
  }
  for (const gate of entry.runtimeGates ?? []) {
    if (!GATES.has(gate)) fail(`${name}: unknown runtime gate ${gate}`);
  }
  if (entry.runtimeGates && !entry.roles?.includes("appGui")) {
    fail(`${name}: runtimeGates only apply to the appGui role`);
  }
  if (entry.authorAdmission !== undefined && !ADMISSIONS.has(entry.authorAdmission)) {
    fail(`${name}: unknown authorAdmission ${entry.authorAdmission}`);
  }
  if (entry.mustEqualDependencyOf) {
    const owner = desktopRequire(`${entry.mustEqualDependencyOf}/package.json`);
    const declared = owner.dependencies?.[name];
    if (declared !== entry.version) {
      fail(`${name}: ${entry.mustEqualDependencyOf} declares ${declared}, manifest says ${entry.version}`);
    }
  }
}
for (const [name, entry] of Object.entries(manifest.virtualSpecifiers ?? {})) {
  if (!name.startsWith("@bottega/")) fail(`virtual specifier ${name} must live under @bottega/`);
  if (!["core", "gate-3"].includes(entry.authorAdmission)) {
    fail(`virtual specifier ${name}: authorAdmission must be core or gate-3`);
  }
}

/* package.json dependencies 与清单包集合必须精确相等：多一个是隐式运行时依赖，
   少一个是打包后 MODULE_NOT_FOUND；版本不等则 metadata 与安装物分叉。 */
const declared = desktopPackage.dependencies ?? {};
for (const name of Object.keys(declared)) {
  if (!packages[name]) fail(`package.json dependency ${name} is not in runtime-dependencies.json`);
}
for (const [name, entry] of Object.entries(packages)) {
  if (!(name in declared)) fail(`manifest package ${name} is missing from package.json dependencies`);
  else if (declared[name] !== entry.version) {
    fail(`${name}: package.json says ${declared[name]}, manifest says ${entry.version}`);
  }
}

for (const glob of manifest.excludedGlobs ?? []) {
  if (!builderConfig.includes(`- "!${glob}"`)) {
    fail(`electron-builder.yml is missing the files negation for ${glob}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`[dependency-manifest] ${failures.length} problem(s):\n${failures.map((line) => `  - ${line}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`[dependency-manifest] ${Object.keys(packages).length} runtime packages match package.json and electron-builder.yml\n`);
