/**
 * [INPUT]: Depends on node-runtime/after-pack.mjs (runtime layout, Node entitlements), codesign/plutil on macOS, the one-shot build manifest (appPath/appOutDir/resourcesPath/installers), @electron/asar listPackage/extractFile, runtime-dependencies.json, electron-builder.yml extraResources targets, the shared system-font policy, the original sumo ISC notice, and an optional release-budgets.json
 * [OUTPUT]: Provides providerPackageFailures and asarPackageReader verifyProviderPackages (TASK-11 d3: every built-in Provider package inside the asar, file by file against runtime-entries.json's sha256/bytes pins, no unpinned package directory, and no providerPackages in the runtime manifest), evaluateReleaseBudgets (current-platform installer and unpacked ceilings, plus an approved bundled-runtime line only when that runtime is packaged) and verifyPackagedPayload, which verifies the packaged tree structurally (every manifest package present in the ASAR or unpacked tree with matching name and version, every optional dependency of a manifest package that is installed for the build's os/cpu (its native half, e.g. `@img/sharp-<platform>-<arch>`) also packaged unless an exclusion glob removes it, every excludedGlobs match absent, every extraResources target present, the extension-trust anchor unprovisioned or a production root (never a test root), and crypto notice bytes exact), writes release/dist-size-receipt.json with installer bytes and unpackedPayloadBytes, and asserts current-platform budgets when release-budgets.json declares them; platforms without budget keys are measure-only, cross-platform color tray resources plus macOS templates and native executable checks, including the Bottega Dock helpers and their single recovery LaunchAgent plist; the bundled Node (TASK-34): exactly manifest + bin/node + LICENSE under Resources/runtime, the signed digest the manifest names, no binary field, entries/packages equal to the asar's runtime-entries.json, and on macOS hardened runtime with only its own entitlements (X1); the approved bundledRuntimes line is added to the installer ceilings only when that Node is packaged. Enforces shared system-font policy over emitted renderer assets.
 * [POS]: Production build verification shared by the private dist smoke; it contains no behavior test so the same file can later run inside the public build job. The dependency manifest owns what must exist, this file proves the packaged bytes agree
 */


import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, realpathSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { extractFile, listPackage, statFile } from "@electron/asar";
import { NODE_ENTITLEMENTS, runtimePaths } from "./node-runtime/after-pack.mjs";
import { assertSystemFontEntries } from "../../../packages/ui/src/styles/system-fonts.mjs";

const RECEIPT_SCHEMA = "bottega.dist-size-receipt/v1";

// 排除 glob 只有三种形状：前导 "**" 加斜杠（任意祖先，含嵌套 node_modules）、段内 "*"、
// 尾随斜杠加 "**"（整棵子树）。转成"路径中任一段序列匹配"的正则后，同时作用于
// asar 条目与 unpacked 相对路径。（块注释放不下这个 glob：星号加斜杠会提前收尾。）
function globToRegExp(glob) {
  const core = glob
    .replace(/^\*\*\//, "")
    .replace(/\/\*\*$/, "")
    .replace(/[.+^$(){}|[\]\\]/g, "\\$&")
    .replace(/\/\*\*\//g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replaceAll("\u0000", "/(?:.*/)?");
  return new RegExp(`(?:^|/)${core}(?:/|$)`);
}

function walkRelative(root, visit, depth = 0, maxDepth = 6) {
  if (depth > maxDepth || !existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    visit(path, entry);
    if (entry.isDirectory()) walkRelative(path, visit, depth + 1, maxDepth);
  }
}

/* 逻辑 unpacked payload：常规文件 size 之和，符号链接计 0 且不跟随，硬链接不去重。
   这是跨平台确定性的口径，不是操作系统报告的安装占用。 */
/** Packaged paths an exclusion glob should have removed: asar entries and unpacked files or directories, in input order. */
export function excludedLeaks({ globs, asarEntries, unpackedPaths }) {
  const excluded = globs.map(globToRegExp), hit = (path) => excluded.some((pattern) => pattern.test(path));
  return [...asarEntries.filter(hit).map((entry) => `asar:${entry}`), ...unpackedPaths.filter(hit).map((path) => `unpacked:${path}`)];
}
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

/** OPT-33 B: electron-builder 26's locale rule (ElectronFramework.js): a pack stays when a wanted name equals it or starts with it plus "-" or "_". */
export function keptLocalePacks(packs, wanted) {
  return packs.filter(pack => wanted.some(name => { const w = name.toLowerCase(), l = pack.toLowerCase(); return w === l || w.startsWith(`${l}-`) || w.startsWith(`${l}_`); }));
}
function electronLanguages(desktop) {
  const block = readFileSync(join(desktop, "electron-builder.yml"), "utf8").match(/^electronLanguages:\n((?: {2}- .*\n)+)/m);
  assert(block, "electron-builder.yml is missing its electronLanguages list");
  return [...block[1].matchAll(/^\s+-\s*(\S+)\s*$/gm)].map((match) => match[1]);
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

  /* 1b. A runtime package's optional dependency that is installed for this build's os/cpu is its native half (sharp →
     @img/sharp-<platform>-<arch>): it must be packaged too, unless an exclusion glob removes it on purpose. The npm
     collector drops optional dependencies silently; this is the check that would have caught it. */
  const excludedNames = (manifest.excludedGlobs ?? []).map(globToRegExp);
  const nativeMissing = [];
  for (const name of Object.keys(manifest.packages)) {
    let source;
    try { source = realpathSync(join(desktop, "node_modules", name)); } catch { continue; }
    const optional = Object.keys(JSON.parse(readFileSync(join(source, "package.json"), "utf8")).optionalDependencies ?? {});
    for (const dependency of optional) {
      let installed;
      try { installed = JSON.parse(readFileSync(join(source, "..", ...(name.startsWith("@") ? [".."] : []), dependency, "package.json"), "utf8")); }
      catch { continue; }
      const fits = (field, value) => !installed[field] || installed[field].includes(value);
      if (!fits("os", buildManifest.platform) || !fits("cpu", buildManifest.arch)) continue;
      if (excludedNames.some(pattern => pattern.test(`node_modules/${dependency}/package.json`))) continue;
      if (!readPackageJson(archive, entries, unpackedModules, dependency)) nativeMissing.push(`${name} → ${dependency}`);
    }
  }
  assert.equal(nativeMissing.length, 0, `运行时包的本平台原生可选依赖没有进包：\n  ${nativeMissing.join("\n  ")}`);

  /* 2. 被排除的 glob 在 asar 与 unpacked 都不得出现（文件与目录都算：unpacked 的 node_modules 里 sourcemap 是文件）。 */
  const unpackedPaths = [];
  // The whole tree: a map can sit at any depth inside a package.
  walkRelative(unpackedRoot, (path) => { unpackedPaths.push(relative(unpackedRoot, path).split(sep).join("/")); }, 0, Infinity);
  const leaked = excludedLeaks({ globs: manifest.excludedGlobs ?? [], asarEntries: [...entries], unpackedPaths });
  assert.equal(leaked.length, 0, `被排除的包进入了打包产物：${leaked.slice(0, 5).join(", ")}`);

  /* 3. extraResources 的每个目标都必须在 Resources 下存在。 */
  const absent = extraResourceTargets(desktop).filter((target) => !existsSync(join(resources, target)));
  assert.equal(absent.length, 0, `extraResources 目标缺失：${absent.join(", ")}`);
  /* TASK-14 S7: the extension signing anchor ships unprovisioned, or later a production root; a test root must never be packaged. */
  const trustAnchor = JSON.parse(readFileSync(join(resources, "extension-trust", "root.json"), "utf8"));
  assert(trustAnchor.schema === "bottega.extension-trust/v1" && (trustAnchor.state === "unprovisioned"
    || (trustAnchor.state === "provisioned" && trustAnchor.root?.signed?.environment === "production")), "extension-trust/root.json is not unprovisioned or a production root");
  assert(readFileSync(join(resources, "licenses/libsodium-0.8.4.txt")).equals(
    readFileSync(join(desktop, "../../packages/cloud-crypto/NOTICE.txt"))), "Packaged crypto ISC notice bytes differ");
  assertSystemFontEntries([...entries].filter(name => name.startsWith("/out/renderer/")),
    name => extractFile(archive, name.slice(1)).toString("utf8"));
  /* The copied Phosphor glyphs retain their MIT notice byte for byte. */
  for (const [fileName, source] of [["licenses/phosphor-icons-MIT.txt", "../../packages/ui/src/components/icons/PHOSPHOR-LICENSE.txt"]]) {
    const entry = `out/renderer/${fileName}`;
    assert(entries.has(`/${entry}`) && extractFile(archive, entry).equals(readFileSync(join(desktop, source))), `Missing or altered renderer licence: ${fileName}`);
  }
  const presenceResources = ["trayIcon.png", "trayIcon@2x.png"];
  if (buildManifest.platform === "darwin") presenceResources.push("trayTemplate.png", "trayTemplate@2x.png", "bin/screen-bridge");
  for (const name of presenceResources) {
    const path = join(resources, "presence", name);
    assert(existsSync(path) && lstatSync(path).isFile() && lstatSync(path).size > 0, `Missing presence resource: ${name}`);
  }
  if (buildManifest.platform === "darwin") {
    assert(lstatSync(join(resources, "presence/bin/screen-bridge")).mode & 0o111, "The presence helper must be executable");
    const capture = join(resources, "tunnel/bin/preview-capture");
    assert(existsSync(capture) && lstatSync(capture).isFile() && (lstatSync(capture).mode & 0o111), "Missing executable preview capture helper");
    // Bottega Dock ships through mac extraFiles, which a missing source only warns about.
    for (const name of ["system-dock-bridge", "bottega-dock-recovery", "dock-glass.node"]) {
      const path = join(resources, "system-dock/bin", name);
      assert(existsSync(path) && lstatSync(path).isFile() && (lstatSync(path).mode & 0o111), `Missing executable Bottega Dock helper: ${name}`);
    }
    const launchAgents = join(resources, "..", "Library", "LaunchAgents");
    assert(existsSync(launchAgents) && readdirSync(launchAgents).filter(name => name.endsWith(".dock-recovery.plist")).length === 1,
      "Exactly one Bottega Dock recovery LaunchAgent plist must ship in Contents/Library/LaunchAgents");
  }

  /* 3a. OPT-33 B: only the UI languages' Chromium locale packs ship (mac .lproj in Resources and the framework; win/linux locales/*.pak). */
  const wantedLanguages = electronLanguages(desktop);
  const packDirectories = buildManifest.platform === "darwin"
    ? [resources, join(buildManifest.appPath, "Contents/Frameworks/Electron Framework.framework/Resources")]
    : [join(buildManifest.appOutDir, "locales")];
  const extension = buildManifest.platform === "darwin" ? ".lproj" : ".pak";
  for (const directory of packDirectories.filter(existsSync)) {
    const packs = readdirSync(directory).filter(name => name.endsWith(extension)).map(name => name.slice(0, -extension.length));
    const unwanted = packs.filter(pack => !keptLocalePacks([pack], wantedLanguages).length);
    assert.equal(unwanted.length, 0, `Locale packs outside the UI languages shipped in ${directory}: ${unwanted.join(", ")}`);
    assert.ok(packs.length > 0, `No locale packs at all in ${directory}`);
  }

  /* 3b. TASK-34: the bundled Node exactly as runtime/node.ts reads it, and signed with its own entitlements only. */
  const bundledNode = verifyBundledNode({ resources, archive, entries, buildManifest });

  /* 3c. TASK-11 d3: the built-in Provider packages inside the asar, file by file against runtime-entries.json's pins. */
  log(`[packaged-payload] ${verifyProviderPackages({ archive, entries, runtimeManifest: runtimePaths(resources, buildManifest.platform, buildManifest.arch).manifest })} built-in Provider packages match their pins`);

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
  const payloadKey = `${buildManifest.platform}-${buildManifest.arch}`;
  const { asserted, over } = evaluateReleaseBudgets(budgets, { installers, payloadKey, payloadBytes, bundledNode });
  assert.equal(over.length, 0, `超出体积预算：${over.join("; ")}`);
  log(`[packaged-payload] ${asserted} budget(s) asserted for ${payloadKey}${asserted === 0 ? " (measure-only)" : ""}`);
  return receipt;
}

/**
 * Budgets for the current platform only; keys without a value are measure-only. The approved bundled-runtime line (installers
 * and unpacked payload) counts only when that runtime is in the package; a packaged runtime without an approved line fails.
 */
/* TASK-11 d3: each built-in Provider ships inside app.asar as a package of exactly these files, pinned (sha256 and bytes) by
   runtime-entries.json's providerPackages; one wrong byte there makes that Provider refuse in the shipped app. Electron main and
   the bridge read the packages from the asar, so the runtime manifest (what a plain Node reads outside it) never carries them. */
export const PROVIDER_PACKAGE_FILES = Object.freeze(["bottega.extension.json", "bottega.provider.json", "bridge.js"]);
/**
 * Returns the named failures of the built-in Provider packages. `shippedIds` are the package directories the asar holds;
 * `readPackage(id, directory)` gives a package's files as a Map of name → { bytes, link }, or null when the directory is absent.
 */
export function providerPackageFailures({ declared, shippedIds, manifestHasProviderPackages, readPackage }) {
  const failures = [];
  const ids = Object.keys(declared ?? {}).sort();
  if (ids.length === 0) failures.push("runtime-entries.json pins no providerPackages");
  for (const id of [...shippedIds].sort()) if (!ids.includes(id)) failures.push(`the asar ships a package directory for ${id}, which providerPackages does not pin`);
  for (const id of ids) {
    const pinned = declared[id];
    if (pinned.directory !== `providers/${id}`) { failures.push(`${id}: providerPackages names directory ${pinned.directory}, not providers/${id}`); continue; }
    const names = Object.keys(pinned.files ?? {}).sort();
    if (JSON.stringify(names) !== JSON.stringify([...PROVIDER_PACKAGE_FILES])) {
      failures.push(`${id}: providerPackages must pin exactly ${PROVIDER_PACKAGE_FILES.join(", ")}`); continue;
    }
    const shipped = readPackage(id, pinned.directory);
    if (!shipped) { failures.push(`${id}: package directory ${pinned.directory} is missing`); continue; }
    for (const name of PROVIDER_PACKAGE_FILES) {
      const file = shipped.get(name), pin = pinned.files[name];
      if (!file) failures.push(`${id}: ${name} is missing`);
      else if (file.link) failures.push(`${id}: ${name} is a link, not a file`);
      else if (createHash("sha256").update(file.bytes).digest("hex") !== pin.sha256 || file.bytes.length !== pin.bytes) failures.push(`${id}: ${name} does not match its pinned sha256 and size`);
    }
    for (const name of [...shipped.keys()].sort()) if (!PROVIDER_PACKAGE_FILES.includes(name)) failures.push(`${id}: unexpected file ${name}`);
  }
  if (manifestHasProviderPackages) failures.push("the runtime manifest carries providerPackages; the packages are read from the asar only");
  return failures;
}

/** readPackage for providerPackageFailures over an app.asar: a nested entry counts as an unexpected file; extractFile also reads unpacked files. */
export function asarPackageReader(archive, entries = new Set(listPackage(archive, { isPack: false }))) {
  return (id, directory) => {
    const prefix = `/${directory.replace(/^\/+|\/+$/g, "")}/`;
    const names = [...entries].filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length));
    if (names.length === 0) return null;
    const files = new Map();
    for (const name of names) {
      const path = `${prefix.slice(1)}${name}`, stat = statFile(archive, path, false);
      if ("files" in stat) { if (!names.some((other) => other.startsWith(`${name}/`))) files.set(name, { bytes: Buffer.alloc(0), link: false }); continue; }
      if ("link" in stat) { files.set(name, { bytes: Buffer.alloc(0), link: true }); continue; }
      files.set(name, { bytes: extractFile(archive, path), link: false });
    }
    return files;
  };
}

/** The d3 check over a real app.asar: throws with every named failure, returns how many packages matched. */
export function verifyProviderPackages({ archive, entries = new Set(listPackage(archive, { isPack: false })), runtimeManifest }) {
  const mainDirectory = dirname(JSON.parse(extractFile(archive, "package.json").toString("utf8")).main);
  const pinned = JSON.parse(extractFile(archive, `${mainDirectory}/runtime-entries.json`).toString("utf8")).providerPackages;
  const packagesPrefix = `/${mainDirectory}/providers/`;
  const shippedIds = [...new Set([...entries].filter(entry => entry.startsWith(packagesPrefix)).map(entry => entry.slice(packagesPrefix.length).split("/")[0]))];
  const readAsarPackage = asarPackageReader(archive, entries);
  const failures = providerPackageFailures({ declared: pinned, shippedIds, readPackage: (id, directory) => readAsarPackage(id, `${mainDirectory}/${directory}`),
    manifestHasProviderPackages: Boolean(runtimeManifest) && existsSync(runtimeManifest) && "providerPackages" in JSON.parse(readFileSync(runtimeManifest, "utf8")) });
  assert.equal(failures.length, 0, `Built-in Provider packages do not match runtime-entries.json:\n  ${failures.join("\n  ")}`);
  return Object.keys(pinned).length;
}

export function evaluateReleaseBudgets(budgets, { installers, payloadKey, payloadBytes, bundledNode }) {
  const line = bundledNode ? budgets.bundledRuntimes?.[bundledNode] : null;
  const over = [];
  let asserted = 0;
  const approved = (table, key) => {
    if (!bundledNode) return 0;
    const value = line?.[table]?.[key];
    if (!Number.isSafeInteger(value)) { over.push(`${key}: no approved line for ${bundledNode}`); return null; }
    return value;
  };
  for (const [id, bytes] of Object.entries(installers)) {
    const base = budgets.installers?.[id];
    if (!Number.isSafeInteger(base)) continue;
    const increase = approved("approvedIncreaseBytes", id);
    if (increase === null) continue;
    asserted += 1;
    if (bytes > base + increase) over.push(`${id} ${bytes} > ${base + increase}`);
  }
  const payloadBase = budgets.unpackedPayload?.[payloadKey];
  if (Number.isSafeInteger(payloadBase)) {
    const increase = approved("approvedUnpackedIncreaseBytes", payloadKey);
    if (increase !== null) {
      asserted += 1;
      if (payloadBytes > payloadBase + increase) over.push(`${payloadKey} payload ${payloadBytes} > ${payloadBase + increase}`);
    }
  }
  return { asserted, over };
}

/**
 * Returns the approved-budget key ("node <version> <platform>-<arch>") of the packaged Node, or null when this build has
 * no pinned Node (the hook refuses those, so a package without one fails here too).
 */
function verifyBundledNode({ resources, archive, entries, buildManifest }) {
  const { platform, arch } = buildManifest;
  const paths = runtimePaths(resources, platform, arch);
  assert(existsSync(paths.manifest), `The runtime manifest is missing: ${paths.manifest}`);
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  const { node } = manifest;
  assert.equal(manifest.schemaVersion, 1, "runtime manifest schemaVersion");
  assert(node && node.platform === platform && node.arch === arch, `The runtime manifest's Node is not ${platform}-${arch}`);
  assert.equal("binary" in node, false, "A packaged runtime manifest may not name a binary");
  const shipped = [];
  walkRelative(paths.root, (path, dirent) => { if (!dirent.isDirectory()) shipped.push(relative(paths.root, path).split(sep).join("/")); });
  assert.deepEqual(shipped.sort(), [relative(paths.root, paths.license), relative(paths.root, paths.binary), "runtime-manifest.json"].map(path => path.split(sep).join("/")).sort(),
    "Resources/runtime must hold exactly the manifest, bin/node and LICENSE");
  const bytes = readFileSync(paths.binary);
  assert(lstatSync(paths.binary).isFile() && (lstatSync(paths.binary).mode & 0o111), "The bundled Node must be an executable regular file");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), node.sha256, "The bundled Node is not the binary the manifest names");
  assert.equal(bytes.length, node.bytes, "The bundled Node's size differs from the manifest");
  // The manifest's copy of the foundation's entries must be the one the asar ships beside main.
  const main = JSON.parse(extractFile(archive, "package.json").toString("utf8")).main;
  const entriesFile = `${dirname(main)}/runtime-entries.json`;
  assert(entries.has(`/${entriesFile}`), `The asar has no ${entriesFile}`);
  const shippedEntries = JSON.parse(extractFile(archive, entriesFile).toString("utf8"));
  assert.equal(JSON.stringify({ entries: manifest.entries, packages: manifest.packages }),
    JSON.stringify({ entries: shippedEntries.entries, packages: shippedEntries.packages }), "The runtime manifest's entries/packages differ from the asar's runtime-entries.json");
  if (platform === "darwin") {
    const described = spawnSync("/usr/bin/codesign", ["-dv", paths.binary], { encoding: "utf8" }).stderr;
    assert.match(described, /flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/, "The bundled Node must be signed with the hardened runtime");
    const plist = spawnSync("/usr/bin/codesign", ["-d", "--entitlements", "-", "--xml", paths.binary]).stdout;
    const granted = Object.keys(JSON.parse(spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], { input: plist }).stdout.toString() || "{}"));
    assert.deepEqual(granted.sort(), [...NODE_ENTITLEMENTS].sort(), "X1: the bundled Node carries other than its own entitlements (inherited from entitlementsInherit?)");
  }
  return `node ${node.version} ${platform}-${arch}`;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const buildManifest = JSON.parse(readFileSync(join(desktop, "release", "build-manifest.json"), "utf8"));
  await verifyPackagedPayload({ desktop, buildManifest });
}
