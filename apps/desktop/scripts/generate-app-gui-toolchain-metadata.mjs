/**
 * [INPUT]: Depends on apps/desktop/runtime-dependencies.json (slice membership and appGui package set), the installed production dependency graph and lockfile, package/license bytes, compiler/query/preferences/workspace/export/Workbench source slices, signed Base UI components, UI Blocks, Starter bytes, and externally provisioned release/platform public keys
 * [OUTPUT]: Deterministically writes or checks gate-isolated manifests, recursive CycloneDX SBOMs, whitespace-canonical full-license NOTICE bundles, performance requirements, authoring/compatibility metadata, and fail-closed formal-release trust anchors
 * [POS]: App GUI release metadata authority; receipts consume generated digests instead of hand-maintained placeholders
 */

/* global Buffer, process */

import { createHash, createPublicKey } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(desktopRoot, "resources/app-gui-toolchain");
const desktopRequire = createRequire(join(desktopRoot, "package.json"));
const check = process.argv.includes("--check");
const desktopPackage = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8"));

/* 单一权威：清单里 roles 含 appGui 的包是编译器运行时集合，runtimeGates 是 slice 成员。
   metadata.ts 从同一份 JSON 派生版本表，package.json 的一致性由
   check-dependency-manifest.mjs 在构建前保证；这里只再核一次版本相等，
   让任何一处分叉在生成与 --check 两条路径上都立刻失败。 */
const runtimeDependencies = JSON.parse(await readFile(join(desktopRoot, "runtime-dependencies.json"), "utf8"));
const appGuiPackages = Object.entries(runtimeDependencies.packages)
  .filter(([, entry]) => entry.roles.includes("appGui"))
  .sort(([left], [right]) => compareText(left, right));
const dependencyNames = appGuiPackages.map(([name]) => name);
const gateDependencyNames = Object.fromEntries(
  ["gate-1", "gate-2", "gate-3"].map((gate) => [
    gate,
    appGuiPackages.filter(([, entry]) => (entry.runtimeGates ?? []).includes(gate)).map(([name]) => name),
  ])
);
const dependencies = Object.fromEntries(appGuiPackages.map(([name, entry]) => [name, entry.version]));
for (const [name, version] of Object.entries(dependencies)) {
  if (desktopPackage.dependencies[name] !== version) {
    throw new Error(`${name}: runtime-dependencies.json says ${version}, package.json says ${desktopPackage.dependencies[name]}`);
  }
}

const gateFiles = {
  "gate-1": [
    "electron/main/app-gui-compiler-entry.ts",
    "electron/main/apps/gui-build/admission.ts",
    "electron/main/apps/gui-build/source-analysis.ts",
    "electron/main/apps/gui-build/pipeline/compiler.ts",
    "electron/main/apps/gui-build/pipeline/dynamic-code-policy.ts",
    "electron/main/apps/gui-build/contracts.ts",
    "electron/main/apps/gui-build/metadata.ts",
    "electron/main/apps/gui-build/product-modules/app-react.ts",
    "electron/main/apps/gui-build/product-modules/bootstrap.ts",
    "electron/main/apps/gui-build/product-modules/virtual-contracts.ts",
    "electron/main/apps/gui-build/pipeline/portable.ts",
    "electron/main/apps/gui-build/pipeline/receipt-metadata.ts",
    "electron/main/apps/gui-build/pipeline/sandbox.ts",
    "electron/main/apps/gui-build/scaffold/component-scaffolder.ts",
    "electron/main/apps/gui-build/scaffold/contracts.ts",
    "electron/main/apps/gui-build/service.ts",
    "electron/main/apps/gui-build/pipeline/source-preparer.ts",
    "electron/main/apps/gui-build/pipeline/source-validator.ts",
    "electron/main/apps/gui-build/pipeline/seal.ts",
    "electron/main/apps/gui-cutover/cohort.ts",
    "electron/main/apps/gui-cutover/coordinator.ts",
    "electron/main/apps/gui-cutover/journal.ts",
    "electron/main/apps/gui-cutover/participants.ts",
    "electron/main/apps/gui-cutover/side-effects.ts",
    "shared/app-gui/contracts.ts",
    "shared/app-gui/cutover.ts",
    "shared/app-gui/support.ts",
  ],
  "gate-2": [
    "electron/main/app-gui-query-worker-entry.ts",
    "electron/main/apps/base-gui/api/query/query-executor.ts",
    "electron/main/apps/base-gui/api/query/query-v1.ts",
    "electron/main/apps/base-gui/api/query/query-worker.ts",
    "electron/main/apps/base-gui/compiled-workspace.ts",
    "electron/main/apps/base-gui/workspace-preview.ts",
    "electron/main/apps/preferences/schema.ts",
    "electron/main/apps/preferences/store.ts",
    "electron/main/apps/preferences/runtime.ts",
    "shared/app-gui/query.ts",
    "src/components/apps/surface/app-gui-surface.tsx",
  ],
  "gate-3": [
    "electron/main/apps/file-export/intent-store.ts",
    "electron/main/apps/file-export/manager.ts",
    "electron/main/apps/file-export/controller.ts",
    "electron/main/apps/gui-build/product-modules/blocks.ts",
    "src/components/apps/detail/app-workbench.tsx",
    "shared/app-gui/file-export.ts",
  ],
};
const authoringFiles = await walk(join(desktopRoot, "resources/app-gui-starters"));
authoringFiles.push(...await walk(join(desktopRoot, "resources/app-gui-components")));
authoringFiles.push("electron/main/apps/gui-build/product-modules/blocks.ts");
authoringFiles.sort(compareText);
const componentCatalog = JSON.parse(
  await readFile(join(desktopRoot, "resources/app-gui-components/catalog.json"), "utf8")
);
const installedPackageCache = new Map();
const packageGraphs = {};
for (const [gate, names] of Object.entries(gateDependencyNames)) {
  packageGraphs[gate] = await collectInstalledGraph(names);
}
const packages = mergePackages(Object.values(packageGraphs));
const lockfileDigest = sha256(await readFile(resolve(desktopRoot, "../../pnpm-lock.yaml")));

const outputs = new Map();
const sliceDigests = {};
for (const [id, paths] of Object.entries(gateFiles)) {
  const slicePackages = packageGraphs[id];
  const sliceSbom = createSbom(`bottega-react-v1/${id}`, slicePackages, gateDependencyNames[id]);
  const sliceNotice = createNotice(`Bottega App GUI ${id} Notices`, slicePackages);
  const slice = {
    schema: "bottega.app-gui-runtime-slice/v1",
    id,
    files: await describe(paths),
    runtimeSbomDigest: sha256(Buffer.from(json(sliceSbom))),
    noticesDigest: sha256(Buffer.from(sliceNotice)),
    authoringContracts: id === "gate-1"
      ? ["bottega-react-v1", "base-ui-authoring-v1"]
      : id === "gate-2"
        ? ["app-react-data-hooks-v1", "app-react-preferences-v1", "app-react-workspace-v1"]
        : ["bottega-ui-blocks-v1", "bottega-app-workbench-v1", "bottega-app-starters-v1", "file-export-v1"],
  };
  sliceDigests[id] = digest(slice);
  outputs.set(`slices/${id}.json`, json(slice));
  outputs.set(`slices/${id}.sbom.cdx.json`, json(sliceSbom));
  outputs.set(`slices/${id}.NOTICE.txt`, sliceNotice);
}

const authoringCatalog = {
  schema: "bottega.app-gui-authoring-catalog/v1",
  preset: "bottega-react-v1",
  componentSystem: "shadcn-base-ui-v1",
  componentSnapshotDigest: componentCatalog.snapshotDigest,
  iconLibraries: ["lucide", "phosphor"],
  blocks: "bottega-ui-blocks-v1",
  starters: ["crud", "dashboard", "kanban", "gallery", "editor"],
  files: await describe(authoringFiles),
};
outputs.set("authoring-catalog.json", json(authoringCatalog));

const compatibilitySupport = {
  schema: "bottega.app-gui-compatibility-support/v1",
  generationAdmission: {
    environmentVariable: "BOTTEGA_APP_GUI_ADMISSION_GATES",
    defaultOpen: ["gate-1", "gate-2", "gate-3"],
    semantics: "An exact comma-separated subset admits only new or rebuilt generations; installed sealed runtimes remain runnable.",
  },
  runContracts: [
    "base-gui-legacy-v1", "sealed-runtime-v3", "app-generation-cutover-v2",
    "base-gui-query-v1", "app-preferences-v1", "workspace-read-v1",
    "workspace-opaque-preview-v1", "host-actions-v1", "file-export-v1",
  ],
  authoringContracts: ["bottega-react-v1", "bottega-ui-blocks-v1", "bottega-app-starters-v1"],
  securityRevocations: [],
  migrationTargets: {},
};
outputs.set("compatibility-support.json", json(compatibilitySupport));

const performanceBaseline = {
  schema: "bottega.app-gui-performance-baseline/v1",
  status: "pending-external-platform-evidence",
  fixture: {
    rows: 10_000,
    columns: 20,
    maximumRowsJsonBytes: 20 * 1024 * 1024,
    filterNodes: 3,
    sortColumns: 2,
    projectionColumns: 5,
    aggregates: 2,
    descriptorDigest: digest({
      schema: "bottega.app-gui-performance-fixture/v1",
      rows: 10_000,
      columns: 20,
      includes: ["formula", "empty", "duplicate-sort-key"],
    }),
  },
  thresholds: {
    coldSurfaceTtiP95Ms: 1_500,
    warmSurfaceTtiP95Ms: 750,
    query10kP95Ms: 250,
    queryHardTimeoutMs: 500,
    interactionP95Ms: 100,
    readyLongTaskMaxMs: 100,
    startupLongTaskMaxMs: 200,
    mountedDomNodes: 2_000,
    mountedVirtualRows: 200,
    rendererHeapDeltaBytes: 128 * 1024 * 1024,
    initialQueries: 3,
    interactionQueries: 2,
  },
  requiredPlatforms: ["darwin-arm64", "linux-x64", "win32-x64"].map((platform) => ({
    platform,
    status: "pending",
    receipt: null,
    requiredIdentity: ["hardwareSku", "cpu", "ramBytes", "osBuild", "electronBuild", "powerMode", "fixtureDigest"],
  })),
  releasePolicy: "No performance number is release evidence until all three platform receipts match this descriptor and threshold set.",
};
outputs.set("app-gui-performance-baseline.json", json(performanceBaseline));

const sbom = createSbom("bottega-react-v1", packages, dependencyNames);
outputs.set("runtime-sbom.cdx.json", json(sbom));
const notice = createNotice("Bottega App GUI Toolchain Notices", packages);
outputs.set("NOTICE.txt", notice);
const formalReleaseTrust = await readFormalReleaseTrust();

const toolchainManifest = {
  schema: "bottega.app-gui-toolchain/v1",
  preset: "bottega-react-v1",
  target: "chromium-140",
  entryAbi: "default-zero-argument-react-component-v1",
  dependencies,
  lockfileDigest,
  formalReleaseTrust,
  platforms: ["darwin-arm64", "linux-x64", "win32-x64"],
  independentAdmissionGates: ["gate-1", "gate-2", "gate-3"],
  sliceDigests,
  authoringCatalogDigest: digest(authoringCatalog),
  compatibilitySupportDigest: digest(compatibilitySupport),
  performanceBaselineDigest: digest(performanceBaseline),
  runtimeSbomDigest: sha256(Buffer.from(json(sbom))),
  noticesDigest: sha256(Buffer.from(notice)),
  artifactPaths: {
    slices: "slices/",
    authoringCatalog: "authoring-catalog.json",
    compatibilitySupport: "compatibility-support.json",
    performanceBaseline: "app-gui-performance-baseline.json",
    runtimeSbom: "runtime-sbom.cdx.json",
    notices: "NOTICE.txt",
  },
};
outputs.set("toolchain-manifest.json", json(toolchainManifest));

const mismatches = [];
for (const [path, content] of outputs) {
  const target = join(outputRoot, path);
  if (check) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== content) mismatches.push(path);
  } else {
    const temporary = `${target}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, target);
  }
}
if (mismatches.length) {
  throw new Error(`App GUI metadata drift: ${mismatches.join(", ")}`);
}
process.stdout.write(check ? "[app-gui-metadata] PASS\n" : `[app-gui-metadata] wrote ${outputs.size} artifacts\n`);

async function collectInstalledGraph(rootNames) {
  const graph = new Map();
  const visit = async (name, issuerRoot = null) => {
    const root = await resolvePackageRoot(name, issuerRoot);
    const item = await readInstalledPackage(root);
    if (graph.has(item.ref)) return item.ref;
    graph.set(item.ref, item);
    for (const dependency of item.dependencyNames) {
      try {
        const dependencyRef = await visit(dependency, root);
        if (!item.dependencies.includes(dependencyRef)) item.dependencies.push(dependencyRef);
      } catch (error) {
        if (!item.optionalDependencies.has(dependency)) throw error;
      }
    }
    item.dependencies.sort(compareText);
    return item.ref;
  };
  for (const name of rootNames) await visit(name);
  return [...graph.values()].sort((left, right) => compareText(left.ref, right.ref));
}

async function resolvePackageRoot(name, issuerRoot) {
  /* 纯类型包（@types/react）的 exports 没有 "." 入口，require.resolve(name) 会抛
     ERR_PACKAGE_PATH_NOT_EXPORTED；根包与传递依赖一样先按相邻 node_modules 目录
     定位，require.resolve 只作 hoist 兜底。 */
  const adjacent = issuerRoot
    ? join(owningNodeModules(issuerRoot), name)
    : join(desktopRoot, "node_modules", name);
  const resolved = await realpath(adjacent).catch(() => null);
  if (resolved && await packageHasName(resolved, name)) return resolved;
  const scopedRequire = issuerRoot ? createRequire(join(issuerRoot, "package.json")) : desktopRequire;
  let current = dirname(scopedRequire.resolve(name));
  while (current !== dirname(current)) {
    if (await packageHasName(current, name)) return realpath(current);
    current = dirname(current);
  }
  throw new Error(`${name} package metadata is unavailable`);
}

function owningNodeModules(root) {
  let current = dirname(root);
  while (current !== dirname(current)) {
    if (basename(current) === "node_modules") return current;
    current = dirname(current);
  }
  throw new Error(`Package root is outside node_modules: ${root}`);
}

async function packageHasName(root, name) {
  const source = await readFile(join(root, "package.json"), "utf8").catch(() => "");
  return source ? JSON.parse(source).name === name : false;
}

async function readInstalledPackage(root) {
  const cached = installedPackageCache.get(root);
  if (cached) return cached;
  const value = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const license = typeof value.license === "string" ? value.license : "";
  if (!license || /SEE LICENSE|UNLICENSED|NOASSERTION/i.test(license)) {
    throw new Error(`${value.name}@${value.version} has no admitted SPDX license identity`);
  }
  if (dependencies[value.name] && value.version !== dependencies[value.name]) {
    throw new Error(`${value.name} installed version drift`);
  }
  const licenseFiles = await readLicenseFiles(root);
  if (!licenseFiles.length) throw new Error(`${value.name}@${value.version} has no vendored license bytes`);
  const ref = `pkg:npm/${encodeURIComponent(value.name)}@${value.version}`;
  const dependencyNames = [...new Set([
    ...Object.keys(value.dependencies ?? {}),
    ...Object.keys(value.optionalDependencies ?? {}),
    ...Object.keys(value.peerDependencies ?? {}),
  ])].sort(compareText);
  const item = {
    name: value.name,
    version: value.version,
    license,
    ref,
    packageDigest: await packageTreeDigest(root),
    licenseFiles,
    dependencyNames,
    optionalDependencies: new Set([
      ...Object.keys(value.optionalDependencies ?? {}),
      ...Object.entries(value.peerDependenciesMeta ?? {}).filter(([, meta]) => meta?.optional).map(([name]) => name),
    ]),
    dependencies: [],
  };
  installedPackageCache.set(root, item);
  return item;
}

async function readLicenseFiles(root) {
  const names = (await readdir(root)).filter((name) => /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name)).sort(compareText);
  return Promise.all(names.map(async (name) => ({ name, text: normalizeText(await readFile(join(root, name), "utf8")) })));
}

async function packageTreeDigest(root) {
  const hash = createHash("sha256");
  const visit = async (directory, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
      if (entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await lstat(path);
      if (stat.isDirectory()) { hash.update(`d\0${relativePath}\0`); await visit(path, relativePath); continue; }
      if (stat.isSymbolicLink()) { hash.update(`l\0${relativePath}\0${await readlink(path)}\0`); continue; }
      if (!stat.isFile()) throw new Error(`Unsupported package payload entry: ${relativePath}`);
      hash.update(`f\0${relativePath}\0${stat.size}\0`).update(await readFile(path)).update("\0");
    }
  };
  await visit(root);
  return `sha256:${hash.digest("hex")}`;
}

function mergePackages(graphs) {
  const merged = new Map();
  for (const graph of graphs) for (const item of graph) merged.set(item.ref, item);
  return [...merged.values()].sort((left, right) => compareText(left.ref, right.ref));
}

function createSbom(name, entries, rootNames) {
  const byName = new Map(entries.map((item) => [item.name, item]));
  const rootRef = `pkg:generic/${name}@1`;
  return {
    bomFormat: "CycloneDX", specVersion: "1.6", version: 1,
    metadata: {
      component: { type: "application", name, "bom-ref": rootRef },
      properties: [{ name: "bottega:pnpm-lockfile-sha256", value: lockfileDigest }],
    },
    components: entries.map((item) => ({
      type: "library", name: item.name, version: item.version, "bom-ref": item.ref, purl: item.ref,
      hashes: [{ alg: "SHA-256", content: item.packageDigest.slice(7) }],
      licenses: [{ license: { id: item.license } }],
      properties: item.licenseFiles.map((file) => ({ name: `bottega:license:${file.name}:sha256`, value: sha256(Buffer.from(file.text)) })),
    })),
    dependencies: [
      { ref: rootRef, dependsOn: rootNames.map((rootName) => byName.get(rootName)?.ref).filter(Boolean).sort(compareText) },
      ...entries.map((item) => ({ ref: item.ref, dependsOn: item.dependencies.filter((ref) => entries.some((candidate) => candidate.ref === ref)).sort(compareText) })),
    ],
  };
}

function createNotice(title, entries) {
  return normalizeNoticeText([
    title,
    "Generated from the exact installed production dependency graph and vendored license bytes. Do not edit by hand.",
    "",
    ...entries.flatMap((item) => [
      `================================================================================`,
      `${item.name}@${item.version} — ${item.license} — ${item.packageDigest}`,
      ...item.licenseFiles.flatMap((file) => [`--- ${file.name} ---`, file.text.trimEnd()]),
      "",
    ]),
  ].join("\n"));
}

function normalizeText(value) { return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n*$/, "\n"); }
function normalizeNoticeText(value) {
  return normalizeText(value).split("\n").map((line) => line.trimEnd()).join("\n");
}

async function readFormalReleaseTrust() {
  const releasePublicKey = await publicKeyIdentity("release-public-key.pem");
  const platformAttestationKeys = await Promise.all(
    ["darwin-arm64", "win32-x64", "linux-x64"].map(async (platform) => ({
      platform,
      path: `release-attestation-keys/${platform}.pem`,
      digest: await publicKeyIdentity(`release-attestation-keys/${platform}.pem`),
    }))
  );
  return {
    schema: "bottega.formal-release-trust/v1",
    status: releasePublicKey && platformAttestationKeys.every((item) => item.digest) ? "provisioned" : "unprovisioned",
    releasePublicKey: { path: "release-public-key.pem", digest: releasePublicKey },
    platformAttestationKeys,
  };
}

async function publicKeyIdentity(path) {
  const bytes = await readFile(join(outputRoot, path)).catch(() => null);
  if (!bytes) return null;
  const key = createPublicKey(bytes);
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${path} is not an Ed25519 public key`);
  return sha256(key.export({ type: "spki", format: "der" }));
}

async function describe(paths) {
  return Promise.all([...paths].sort(compareText).map(async (path) => {
    const bytes = await readFile(join(desktopRoot, path));
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
  }));
}

async function walk(root) {
  const paths = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(relative(desktopRoot, path).split(sep).join("/"));
    }
  };
  await visit(root);
  return paths;
}

function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function digest(value) { return sha256(Buffer.from(canonical(value))); }
function sha256(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => compareText(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function compareText(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }
