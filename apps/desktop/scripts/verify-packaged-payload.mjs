/**
 * [INPUT]: Depends on the one-shot build manifest (appPath/appOutDir/resourcesPath/installers), @electron/asar listPackage/extractFile, runtime-dependencies.json, electron-builder.yml extraResources targets, and an optional release-budgets.json
 * [OUTPUT]: Verifies the packaged tree structurally (every manifest package present in the ASAR or unpacked tree with matching name and version, every excludedGlobs match absent, every extraResources target present), writes release/dist-size-receipt.json with installer bytes and unpackedPayloadBytes, and asserts current-platform budgets when release-budgets.json declares them; platforms without budget keys are measure-only
 * [POS]: Production build verification shared by the private dist smoke; it contains no behavior test so the same file can later run inside the public build job. The dependency manifest owns what must exist, this file proves the packaged bytes agree
 */

/* global process, console */

import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";

const RECEIPT_SCHEMA = "bottega.dist-size-receipt/v1";

// 排除 glob 只有三种形状：前导 "**" 加斜杠（任意祖先，含嵌套 node_modules）、段内 "*"、
// 尾随斜杠加 "**"（整棵子树）。转成"路径中任一段序列匹配"的正则后，同时作用于
// asar 条目与 unpacked 相对路径。（块注释放不下这个 glob：星号加斜杠会提前收尾。）
function globToRegExp(glob) {
  const core = glob
    .replace(/^\*\*\//, "")
    .replace(/\/\*\*$/, "")
    .replace(/[.+^$(){}|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`(?:^|/)${core}(?:/|$)`);
}

function walkRelative(root, visit, depth = 0) {
  if (depth > 6 || !existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    visit(path, entry);
    if (entry.isDirectory()) walkRelative(path, visit, depth + 1);
  }
}

/* 逻辑 unpacked payload：常规文件 size 之和，符号链接计 0 且不跟随，硬链接不去重。
   这是跨平台确定性的口径，不是操作系统报告的安装占用。 */
export function unpackedPayloadBytes(root) {
  let total = 0;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) total += stat.size;
    }
  };
  walk(root);
  return total;
}

function extraResourceTargets(desktop) {
  const source = readFileSync(join(desktop, "electron-builder.yml"), "utf8");
  const block = source.match(/^extraResources:\n((?: {2}.*\n)+)/m);
  assert(block, "electron-builder.yml 缺少 extraResources 块");
  return [...block[1].matchAll(/^\s+to:\s*(\S+)\s*$/gm)].map((match) => match[1]);
}

function readPackageJson(archive, entries, unpackedModules, name) {
  const asarEntry = `/node_modules/${name}/package.json`;
  if (entries.has(asarEntry)) {
    return JSON.parse(extractFile(archive, asarEntry.slice(1)).toString("utf8"));
  }
  const unpacked = join(unpackedModules, name, "package.json");
  if (existsSync(unpacked)) return JSON.parse(readFileSync(unpacked, "utf8"));
  return null;
}

export async function verifyPackagedPayload({ desktop, buildManifest, log = (line) => console.log(line) }) {
  const manifest = JSON.parse(readFileSync(join(desktop, "runtime-dependencies.json"), "utf8"));
  const desktopPackage = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
  const resources = buildManifest.resourcesPath;
  const archive = join(resources, "app.asar");
  const unpackedRoot = join(resources, "app.asar.unpacked");
  const unpackedModules = join(unpackedRoot, "node_modules");
  assert(existsSync(archive), `打包产物缺少 app.asar：${archive}`);
  const entries = new Set(listPackage(archive, { isPack: false }));

  /* 1. 清单里的每个包都必须以正确的 name/version 落在 asar 或 unpacked 里。 */
  const missing = [];
  for (const [name, entry] of Object.entries(manifest.packages)) {
    const installed = readPackageJson(archive, entries, unpackedModules, name);
    if (!installed) missing.push(`${name}: 不在 asar 也不在 unpacked`);
    else if (installed.name !== name || installed.version !== entry.version) {
      missing.push(`${name}: 打包的是 ${installed.name}@${installed.version}，清单要求 ${entry.version}`);
    }
  }
  assert.equal(missing.length, 0, `打包 node_modules 与 runtime-dependencies.json 不一致：\n  ${missing.join("\n  ")}`);

  /* 2. 被排除的 glob 在 asar 与 unpacked 都不得出现。 */
  const excluded = (manifest.excludedGlobs ?? []).map(globToRegExp);
  const leaked = [];
  for (const entry of entries) {
    if (excluded.some((pattern) => pattern.test(entry))) leaked.push(`asar:${entry}`);
  }
  walkRelative(unpackedRoot, (path, dirent) => {
    if (!dirent.isDirectory()) return;
    const relativePath = relative(unpackedRoot, path).split(sep).join("/");
    if (excluded.some((pattern) => pattern.test(relativePath))) leaked.push(`unpacked:${relativePath}`);
  });
  assert.equal(leaked.length, 0, `被排除的包进入了打包产物：${leaked.slice(0, 5).join(", ")}`);

  /* 3. extraResources 的每个目标都必须在 Resources 下存在。 */
  const absent = extraResourceTargets(desktop).filter((target) => !existsSync(join(resources, target)));
  assert.equal(absent.length, 0, `extraResources 目标缺失：${absent.join(", ")}`);

  /* 4. 体积 receipt：installer 字节数 + 逻辑 unpacked payload。 */
  const measuredRoot = buildManifest.platform === "darwin" ? buildManifest.appPath : buildManifest.appOutDir;
  const payloadBytes = unpackedPayloadBytes(measuredRoot);
  const installers = Object.fromEntries(
    Object.entries(buildManifest.installers ?? {}).map(([id, artifact]) => [id, artifact.bytes])
  );
  const receipt = {
    schema: RECEIPT_SCHEMA,
    buildId: buildManifest.buildId,
    platform: buildManifest.platform,
    arch: buildManifest.arch,
    version: desktopPackage.version,
    installers,
    measuredRoot,
    unpackedPayloadBytes: payloadBytes,
    measuredAt: Date.now(),
  };
  const receiptPath = join(dirname(buildManifest.appOutDir), "dist-size-receipt.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  log(`[packaged-payload] ${Object.keys(manifest.packages).length} packages verified; payload ${(payloadBytes / 1048576).toFixed(1)} MB; installers ${Object.entries(installers).map(([id, bytes]) => `${id}=${(bytes / 1048576).toFixed(1)} MB`).join(", ") || "(none)"}`);

  /* 5. 预算：只对当前平台已声明的键断言；没有键就是 measure-only，首次测量不会被卡住。 */
  const budgetsPath = join(desktop, "release-budgets.json");
  if (!existsSync(budgetsPath)) {
    log("[packaged-payload] release-budgets.json 不存在，measure-only");
    return receipt;
  }
  const budgets = JSON.parse(readFileSync(budgetsPath, "utf8"));
  const over = [];
  let asserted = 0;
  for (const [id, bytes] of Object.entries(installers)) {
    const budget = budgets.installers?.[id];
    if (!Number.isSafeInteger(budget)) continue;
    asserted += 1;
    if (bytes > budget) over.push(`${id} ${bytes} > ${budget}`);
  }
  const payloadKey = `${buildManifest.platform}-${buildManifest.arch}`;
  const payloadBudget = budgets.unpackedPayload?.[payloadKey];
  if (Number.isSafeInteger(payloadBudget)) {
    asserted += 1;
    if (payloadBytes > payloadBudget) over.push(`${payloadKey} payload ${payloadBytes} > ${payloadBudget}`);
  }
  assert.equal(over.length, 0, `超出体积预算：${over.join("; ")}`);
  log(`[packaged-payload] ${asserted} budget(s) asserted for ${payloadKey}${asserted === 0 ? " (measure-only)" : ""}`);
  return receipt;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const buildManifest = JSON.parse(readFileSync(join(desktop, "release", "build-manifest.json"), "utf8"));
  await verifyPackagedPayload({ desktop, buildManifest });
}
