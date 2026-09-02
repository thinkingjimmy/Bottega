/**
 * [INPUT]: Depends on TypeScript, esbuild local CSS modules, Tailwind Node/Oxide, immutable source validation, and fixed toolchain metadata
 * [OUTPUT]: Provides strict semantic typecheck plus exact local-alias/CSS-module resolution, deterministic React/Tailwind compiled-v3 runtime, and canonical receipt generation
 * [POS]: apps/gui-build/pipeline transform kernel; sandbox child invokes it and generation code consumes only validated output
 */
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { compile as compileTailwind } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { build as buildEsbuild, type Plugin } from "esbuild";
import ts from "typescript";
import type {
  AppGuiBuildFinding,
  AppGuiBuildReceipt,
  AppGuiCompiledV3CompatibilityRef,
  BaseAppManifest,
} from "../../../../../shared/apps-ipc";
import type { Sha256Digest } from "../../../../../shared/extensions-ipc";
import { appManifestSchema } from "../../install/manifest-schema";
import {
  APP_GUI_BUILD_BUDGET,
  type CompilerArtifact,
  type SealedCompilerInput,
  type SourceFreezeReceipt,
} from "../contracts";
import {
  authorPublicSpecifiers,
  canonicalDigest,
  sha256,
} from "../metadata";
import { validateCompiledGuiSource } from "./source-validator";
import {
  BLOCKS_RUNTIME_SOURCE,
  BLOCKS_TYPES_SOURCE,
} from "../product-modules/blocks";
import {
  CHARTS_RUNTIME_SOURCE,
  CHARTS_TYPES_SOURCE,
  SDK_TYPES_SOURCE,
} from "../product-modules/virtual-contracts";
import { SDK_RUNTIME_SOURCE } from "../product-modules/app-react";
import {
  bootstrapSource,
  type BootstrapRuntimeSlice,
} from "../product-modules/bootstrap";
import { analyzeAuthorModuleUsage } from "../source-analysis";
import { requiredGates } from "../admission";
import { loadReceiptMetadata } from "./receipt-metadata";

const require = createRequire(import.meta.url);
const APP_REACT_MODULE = "bottega:app-react";
const CHARTS_MODULE = "bottega:charts";
const BLOCKS_MODULE = "bottega:app-blocks";
const BOOTSTRAP_MODULE = "bottega:bootstrap";
const APP_ENTRY_MODULE = "bottega:app-entry";

export async function compilePreparedAppGui(input: SealedCompilerInput): Promise<CompilerArtifact> {
  const manifest = appManifestSchema.parse(
    JSON.parse(await readFile(join(input.snapshotRoot, "app.json"), "utf8"))
  );
  if (manifest.kind !== "base" || !manifest.gui?.build) {
    throw findingsError([{ code: "GUI_BUILD_MANIFEST_INVALID", file: "app.json", message: "compiled GUI build manifest is required" }]);
  }
  const sourceReceipt = await sourceReceiptFromSnapshot(input.snapshotRoot, input.sourcePackageDigest);
  const structural = await validateCompiledGuiSource(sourceReceipt, manifest.gui);
  if (structural.length) throw findingsError(structural);
  const diagnostics = semanticTypecheck(input.snapshotRoot, input.tempRoot);
  if (diagnostics.length) throw findingsError(diagnostics);
  const gates = await requiredGates(sourceReceipt, manifest);
  const compatibility = await compatibilityRef(
    manifest,
    sourceReceipt,
    input.transformContractDigest
  );
  const receiptMetadata = await loadReceiptMetadata(gates);

  await clearRootChildren(input.outputRoot);
  const runtimeGuiRoot = join(input.outputRoot, "gui");
  const assetsRoot = join(runtimeGuiRoot, "assets");
  await mkdir(assetsRoot, { recursive: true, mode: 0o700 });
  const tailwindCss = await buildTailwind(input.snapshotRoot);
  const bundled = await bundleReact(
    input.snapshotRoot,
    input.outputRoot,
    manifest,
    compatibility,
    gates
  );
  const emittedCss = bundled.filter((file) => file.path.endsWith(".css"));
  const combinedCss = Buffer.concat([
    Buffer.from(tailwindCss, "utf8"),
    ...emittedCss.map((file) => Buffer.concat([Buffer.from("\n"), file.bytes])),
  ]);
  const cssName = `styles-${sha256(combinedCss).slice(7, 19)}.css`;
  await writeFile(join(assetsRoot, cssName), combinedCss, { mode: 0o600 });

  const javascript = bundled.filter((file) => !file.path.endsWith(".css"));
  for (const file of javascript) {
    const target = join(input.outputRoot, file.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, file.bytes, { mode: 0o600 });
  }
  const bootstrap = javascript.find((file) => /sdk-bootstrap-[A-Z0-9]+\.js$/i.test(file.path));
  if (!bootstrap) throw findingsError([{ code: "GUI_BUILD_ARTIFACT_INVALID", file: "gui/index.html", message: "trusted bootstrap entry was not emitted" }]);
  const prepaintBytes = Buffer.from(PREPAINT_SOURCE, "utf8");
  const prepaintName = `prepaint-${sha256(prepaintBytes).slice(7, 19)}.js`;
  await writeFile(join(assetsRoot, prepaintName), prepaintBytes, { mode: 0o600 });
  const indexBytes = Buffer.from(renderIndex(prepaintName, cssName, basenameOf(bootstrap.path)), "utf8");
  await writeFile(join(runtimeGuiRoot, "index.html"), indexBytes, { mode: 0o600 });

  const runtimeFiles = await runtimeGuiFiles(runtimeGuiRoot);
  validateArtifactBudgets(runtimeFiles);
  const sourceGuiFiles = sourceReceipt.files.filter((file) => file.path.startsWith("gui/"));
  const componentFiles = sourceGuiFiles.filter((file) =>
    file.path === "gui/component-origins.json" ||
    file.path.startsWith("gui/.bottega/origin-blobs/sha256/")
  );
  const manifestDigest = canonicalDigest(manifest);
  const sourceGuiDigest = treeDigest("bottega.app-gui-source/v1", sourceGuiFiles);
  const runtimeGuiDigest = treeDigest("bottega.app-gui-runtime/v1", runtimeFiles);
  const contentDigest = await compiledRuntimeContentDigest(input.snapshotRoot, manifest, runtimeFiles);
  const receipt: AppGuiBuildReceipt = {
    preset: "bottega-react-v1",
    transformContractDigest: input.transformContractDigest,
    platformCompilerCustodyDigest: input.platformCompilerCustodyDigest,
    componentOriginsDigest: treeDigest("bottega.app-gui-component-origins/v1", componentFiles),
    allowlistDigest: canonicalDigest([...authorPublicSpecifiers(manifest.gui.build.iconLibrary)].sort()),
    ...receiptMetadata,
    compatibility,
    platform: platformIdentity(),
    manifestDigest,
    sourcePackageDigest: input.sourcePackageDigest,
    contentDigest,
    sourceGuiDigest,
    runtimeGuiDigest,
    iconLibrary: manifest.gui.build.iconLibrary,
    files: runtimeFiles,
  };
  const buildReceiptDigest = canonicalDigest(receipt);
  return { runtimeRoot: input.outputRoot, receipt, buildReceiptDigest };
}

function semanticTypecheck(
  snapshotRoot: string,
  tempRoot: string
): readonly AppGuiBuildFinding[] {
  const sourceRoot = join(snapshotRoot, "gui/src");
  const virtualRoot = join(tempRoot, "virtual-types");
  const sdkTypes = join(virtualRoot, "app-react.d.ts");
  const chartTypes = join(virtualRoot, "charts.d.ts");
  const blocksTypes = join(virtualRoot, "blocks.d.ts");
  const assetTypes = join(virtualRoot, "assets.d.ts");
  const virtualFiles = new Map<string, string>([
    [sdkTypes, SDK_TYPES_SOURCE],
    [chartTypes, CHARTS_TYPES_SOURCE],
    [blocksTypes, BLOCKS_TYPES_SOURCE],
    [assetTypes, 'declare module "*.module.css" { const classes: Readonly<Record<string, string>>; export default classes; }\ndeclare module "*.css" {}\ndeclare module "*.png" { const url: string; export default url; }\ndeclare module "*.jpg" { const url: string; export default url; }\ndeclare module "*.jpeg" { const url: string; export default url; }\ndeclare module "*.gif" { const url: string; export default url; }\ndeclare module "*.webp" { const url: string; export default url; }\ndeclare module "*.svg" { const url: string; export default url; }\ndeclare module "*.woff" { const url: string; export default url; }\ndeclare module "*.woff2" { const url: string; export default url; }\n'],
  ]);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    useDefineForClassFields: true,
    forceConsistentCasingInFileNames: true,
    /* Allowlisted dependency declarations are product-owned bytes. dnd-kit still names
       the React 18 global JSX namespace under React 19; author source remains strict. */
    skipLibCheck: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    baseUrl: sourceRoot,
    paths: {
      "@/*": ["*"],
      "@bottega/app-react": [sdkTypes],
      "@bottega/charts": [chartTypes],
      "@bottega/app-blocks": [blocksTypes],
    },
  };
  const roots = [...listSourceFilesSync(sourceRoot), assetTypes];
  const baseHost = ts.createCompilerHost(options, true);
  const typescriptLibRoot = dirname(require.resolve("typescript/lib/typescript.js"));
  const dependencyAnchor = join(dirname(dirname(require.resolve("react/package.json"))), "..", "__bottega_types__.ts");
  const host: ts.CompilerHost = {
    ...baseHost,
    getDefaultLibLocation: () => typescriptLibRoot,
    getDefaultLibFileName: (compilerOptions) =>
      join(typescriptLibRoot, ts.getDefaultLibFileName(compilerOptions)),
    fileExists: (path) => virtualFiles.has(path) || baseHost.fileExists(path),
    readFile: (path) => virtualFiles.get(path) ?? baseHost.readFile(path),
    getSourceFile: (path, languageVersion, onError, shouldCreateNewSourceFile) => {
      const virtual = virtualFiles.get(path);
      return virtual === undefined
        ? baseHost.getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(path, virtual, languageVersion, true, ts.ScriptKind.TS);
    },
    resolveModuleNameLiterals: (literals, containingFile) => literals.map((literal) => {
      const specifier = literal.text;
      if (specifier === "@bottega/app-react") return { resolvedModule: moduleResolution(sdkTypes) };
      if (specifier === "@bottega/charts") return { resolvedModule: moduleResolution(chartTypes) };
      if (specifier === "@bottega/app-blocks") return { resolvedModule: moduleResolution(blocksTypes) };
      const importer = specifier.startsWith(".") || specifier.startsWith("@/")
        ? containingFile
        : dependencyAnchor;
      return { resolvedModule: ts.resolveModuleName(specifier, importer, options, host).resolvedModule };
    }),
  };
  const program = ts.createProgram({ rootNames: roots, options, host });
  const findings = ts.getPreEmitDiagnostics(program).slice(0, APP_GUI_BUILD_BUDGET.findings).map((diagnostic) => diagnosticFinding(diagnostic, snapshotRoot));
  if (findings.length) return findings;
  const entry = program.getSourceFile(join(sourceRoot, "main.tsx"));
  if (!entry) return [{ code: "GUI_BUILD_SOURCE_MISSING", file: "gui/src/main.tsx", message: "compiled entry is missing" }];
  const module = program.getTypeChecker().getSymbolAtLocation(entry);
  const defaultExport = module && program.getTypeChecker().getExportsOfModule(module).find((symbol) => symbol.escapedName === "default");
  const declaration = defaultExport?.valueDeclaration ?? defaultExport?.declarations?.[0];
  const signatures = declaration
    ? program.getTypeChecker().getTypeOfSymbolAtLocation(defaultExport!, declaration).getCallSignatures()
    : [];
  if (signatures.length !== 1 || signatures[0]!.parameters.length !== 0) {
    return [{ code: "GUI_BUILD_ENTRY_ABI_INVALID", file: "gui/src/main.tsx", message: "default export must be one zero-argument React component" }];
  }
  return [];
}

async function buildTailwind(snapshotRoot: string) {
  const sourceRoot = join(snapshotRoot, "gui/src");
  const stylesheetPath = join(sourceRoot, "styles.css");
  const tailwindCssRoot = dirname(require.resolve("tailwindcss/index.css"));
  const stylesheet = await readFile(stylesheetPath, "utf8");
  const compiler = await compileTailwind(stylesheet, {
    base: sourceRoot,
    from: stylesheetPath,
    onDependency: () => undefined,
    customCssResolver: async (specifier, importerRoot) => {
      if (specifier === "tailwindcss") return join(tailwindCssRoot, "index.css");
      const candidate = specifier.startsWith("tailwindcss/")
        ? resolve(tailwindCssRoot, specifier.slice("tailwindcss/".length))
        : resolve(importerRoot, specifier);
      const allowed = [tailwindCssRoot, sourceRoot].some((root) =>
        candidate === root || candidate.startsWith(`${root}${sep}`)
      );
      return allowed && candidate.endsWith(".css") ? candidate : false;
    },
  });
  const scanner = new Scanner({
    sources: [{ base: sourceRoot, pattern: "**/*.{ts,tsx,js,jsx,html}", negated: false }],
  });
  return compiler.build(scanner.scan().sort());
}

async function bundleReact(
  snapshotRoot: string,
  outputRoot: string,
  manifest: BaseAppManifest,
  compatibility: AppGuiCompiledV3CompatibilityRef,
  gates: readonly import("../admission").AppGuiAdmissionGate[]
) {
  const output = await buildEsbuild({
    entryPoints: { "sdk-bootstrap": BOOTSTRAP_MODULE },
    absWorkingDir: snapshotRoot,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: ["chrome140"],
    jsx: "automatic",
    treeShaking: true,
    minify: true,
    legalComments: "none",
    sourcemap: false,
    charset: "utf8",
    write: false,
    metafile: true,
    outdir: join(outputRoot, "gui/assets"),
    entryNames: "[name]-[hash]",
    chunkNames: "chunk-[hash]",
    assetNames: "asset-[hash]",
    loader: {
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".webp": "file",
      ".gif": "file",
      ".svg": "file",
      ".woff": "file",
      ".woff2": "file",
      ".module.css": "local-css",
      ".css": "css",
    },
    nodePaths: [dirname(require.resolve("react/package.json")) + "/.."],
    plugins: [resolverPlugin(snapshotRoot, manifest, compatibility, gates)],
  });
  return output.outputFiles.map((file) => ({
    path: relative(outputRoot, file.path).split(sep).join("/"),
    bytes: Buffer.from(file.contents),
  }));
}

function resolverPlugin(
  snapshotRoot: string,
  manifest: BaseAppManifest,
  compatibility: AppGuiCompiledV3CompatibilityRef,
  gates: readonly import("../admission").AppGuiAdmissionGate[]
): Plugin {
  /* macOS /var is a symlink to /private/var. esbuild canonicalizes importer paths;
     the policy root must use the same identity or every legitimate author import
     looks foreign while compiling a temporary snapshot. */
  const sourceRoot = realpathSync(join(snapshotRoot, "gui/src"));
  const entry = join(sourceRoot, "main.tsx");
  const allowed = authorPublicSpecifiers(manifest.gui!.build!.iconLibrary);
  return {
    name: "bottega-app-gui-resolver",
    setup(build) {
      build.onResolve({ filter: /^bottega:/ }, (args) => ({ path: args.path, namespace: "bottega-product" }));
      build.onResolve({ filter: /^@bottega\/app-react$/ }, () => ({ path: APP_REACT_MODULE, namespace: "bottega-product" }));
      build.onResolve({ filter: /^@bottega\/charts$/ }, () => ({ path: CHARTS_MODULE, namespace: "bottega-product" }));
      build.onResolve({ filter: /^@bottega\/app-blocks$/ }, () => ({ path: BLOCKS_MODULE, namespace: "bottega-product" }));
      build.onResolve({ filter: /^[^./].*/, namespace: "bottega-product" }, (args) => {
        const graph: Readonly<Record<string, readonly string[]>> = {
          [BOOTSTRAP_MODULE]: [
            ...(gates.includes("gate-3") ? ["axe-core"] : []),
            "react",
            "react-dom",
            "react-dom/client",
          ],
          [APP_REACT_MODULE]: ["react"],
          [CHARTS_MODULE]: [
            "react",
            "echarts/core",
            "echarts/charts",
            "echarts/renderers",
            "echarts/components",
          ],
          [BLOCKS_MODULE]: ["react", "react/jsx-runtime", "@tanstack/react-virtual"],
        };
        return graph[args.importer]?.includes(args.path)
          ? { path: require.resolve(args.path) }
          : { errors: [{ text: `product dependency edge is not signed: ${args.importer} -> ${args.path}` }] };
      });
      build.onResolve({ filter: /^@\// }, (args) => {
        if (!args.importer.startsWith(sourceRoot)) return;
        const path = resolve(sourceRoot, args.path.slice(2));
        if (!path.startsWith(`${sourceRoot}${sep}`)) {
          return { errors: [{ text: "author alias escaped gui/src" }] };
        }
        const resolved = resolveLocalModule(path);
        return resolved
          ? { path: resolved }
          : { errors: [{ text: `author alias does not resolve: ${args.path}` }] };
      });
      build.onResolve({ filter: /^[^./].*/ }, (args) => {
        const authorOwned = [args.importer, args.resolveDir].some((path) =>
          path === sourceRoot || path.startsWith(`${sourceRoot}${sep}`)
        );
        if (!authorOwned) return;
        return allowed.has(args.path) || args.path === "react/jsx-runtime"
          ? { path: resolveAuthorSpecifier(args.path) }
          : { errors: [{ text: `author import is not public: ${args.path}` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "bottega-product" }, (args) => {
        if (args.path === BOOTSTRAP_MODULE) return {
          contents: bootstrapSource(APP_ENTRY_MODULE, runtimeSlice(compatibility, gates)),
          loader: "tsx",
          resolveDir: dirname(entry),
        };
        if (args.path === APP_ENTRY_MODULE) return { contents: `export { default } from ${JSON.stringify(entry)};`, loader: "tsx", resolveDir: dirname(entry) };
        if (args.path === APP_REACT_MODULE) return { contents: SDK_RUNTIME_SOURCE, loader: "tsx", resolveDir: dirname(entry) };
        if (args.path === CHARTS_MODULE) return { contents: CHARTS_RUNTIME_SOURCE, loader: "tsx", resolveDir: dirname(entry) };
        if (args.path === BLOCKS_MODULE) return { contents: BLOCKS_RUNTIME_SOURCE, loader: "tsx", resolveDir: dirname(entry) };
        return { errors: [{ text: "unknown product virtual module" }] };
      });
    },
  };
}

function resolveLocalModule(path: string) {
  return [path, `${path}.ts`, `${path}.tsx`, `${path}.js`, `${path}.jsx`, join(path, "index.ts"), join(path, "index.tsx")]
    .find((candidate) => existsSync(candidate));
}

function resolveAuthorSpecifier(specifier: string) {
  const phosphorPrefix = "@phosphor-icons/react/";
  if (specifier.startsWith(phosphorPrefix)) {
    const icon = specifier.slice(phosphorPrefix.length);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(icon)) throw new Error("invalid Phosphor icon subpath");
    return join(dirname(require.resolve("@phosphor-icons/react/package.json")), "dist/csr", `${icon}.es.js`);
  }
  return require.resolve(specifier);
}

async function compatibilityRef(
  manifest: BaseAppManifest,
  sourceReceipt: SourceFreezeReceipt,
  transformContractDigest: Sha256Digest
): Promise<AppGuiCompiledV3CompatibilityRef> {
  const gui = manifest.gui!;
  const sdkImports = await importedAppReactBindings(sourceReceipt);
  const dataBindings = new Set([
    "useBaseMeta",
    "useBaseRows",
    "useAttachment",
    "useBaseMutation",
  ]);
  const preferences = gui.preferences
    ? { kind: "app-preferences-v1" as const, schemaDigest: gui.preferences.schemaDigest, defaultsDigest: gui.preferences.defaultsDigest }
    : { kind: "none" as const };
  const workspace = gui.capabilities.includes("workspace-read")
    ? { kind: "workspace-read-v1" as const, scope: "design/" as const, opaquePreviewContractVersion: "workspace-opaque-preview-v1" as const }
    : { kind: "none" as const };
  const usesHostActions = sdkImports.has("*") ||
    sdkImports.has("useHostAction") ||
    sdkImports.has("useFileExport") ||
    Boolean(gui.hostActions?.length);
  const hostActions = usesHostActions
    ? { kind: "host-actions-v1" as const, required: ["open-data", "open-data-view", ...(gui.hostActions ?? [])] as const }
    : { kind: "none" as const };
  const contract: Omit<AppGuiCompiledV3CompatibilityRef, "sdkDigest"> = {
    kind: "compiled-v3",
    transformContractDigest,
    cutoverContractVersion: "app-generation-cutover-v2",
    dataSdk: sdkImports.has("*") || [...sdkImports].some((binding) => dataBindings.has(binding))
      ? { kind: "base-gui-data-v1", querySemanticsVersion: "base-gui-query-v1" }
      : { kind: "none" },
    preferences,
    workspace,
    hostActions,
  };
  return {
    ...contract,
    sdkDigest: canonicalDigest({
      schema: "bottega.app-react-runtime-slice/v1",
      contract,
      sourceDigest: sha256(Buffer.from(SDK_RUNTIME_SOURCE)),
    }),
  };
}

function runtimeSlice(
  compatibility: AppGuiCompiledV3CompatibilityRef,
  gates: readonly import("../admission").AppGuiAdmissionGate[]
): BootstrapRuntimeSlice {
  return {
    data: compatibility.dataSdk.kind !== "none",
    preferences: compatibility.preferences.kind !== "none",
    workspace: compatibility.workspace.kind !== "none",
    workbench: gates.includes("gate-3"),
  };
}

async function importedAppReactBindings(receipt: SourceFreezeReceipt) {
  const bindings = new Set<string>();
  for (const file of receipt.files) {
    if (!file.path.startsWith("gui/src/") || !/\.[jt]sx?$/.test(file.path)) continue;
    const source = await readFile(join(receipt.snapshotRoot, file.path), "utf8");
    const tree = ts.createSourceFile(
      file.path,
      source,
      ts.ScriptTarget.ESNext,
      false,
      ts.ScriptKind.TSX
    );
    analyzeAuthorModuleUsage(tree).appReactBindings.forEach((binding) =>
      bindings.add(binding)
    );
  }
  return bindings;
}

async function sourceReceiptFromSnapshot(snapshotRoot: string, digest: Sha256Digest): Promise<SourceFreezeReceipt> {
  const files = await walk(snapshotRoot);
  return { snapshotRoot, sourcePackageDigest: digest, files };
}

async function runtimeGuiFiles(root: string) {
  return walk(root);
}

/* 供给方（sandbox.ts prepareEmptyRoot）已保证 outputRoot 是空目录，这里只清子项。
   Linux bubblewrap 把 outputRoot 作为 bind-mount 挂进来，rmdir 挂载点必得 EBUSY，
   每一次 Linux 编译都会因此变成 GUI_BUILD_COMPILER_CRASH。 */
async function clearRootChildren(root: string) {
  const entries = await readdir(root).catch(() => []);
  for (const entry of entries) await rm(join(root, entry), { recursive: true, force: true });
}

async function walk(root: string) {
  const files: Array<{ path: string; bytes: number; sha256: Sha256Digest }> = [];
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        files.push({ path: relative(root, path).split(sep).join("/"), bytes: bytes.byteLength, sha256: sha256(bytes) });
      }
    }
  };
  await visit(root);
  return files;
}

async function compiledRuntimeContentDigest(
  snapshotRoot: string,
  manifest: BaseAppManifest,
  runtimeGuiFiles: readonly { path: string; bytes: number; sha256: Sha256Digest }[]
) {
  const source = await walk(snapshotRoot);
  const retained = source.filter((file) =>
    file.path !== "data/base.json" &&
    !file.path.startsWith("gui/")
  );
  const gui = runtimeGuiFiles.map((file) => ({ ...file, path: `gui/${file.path}` }));
  return treeDigest("bottega.app-runtime/v3", [...retained, ...gui]);
}

function treeDigest(domain: string, files: readonly { path: string; bytes: number; sha256: Sha256Digest }[]) {
  return canonicalDigest({ domain, files: [...files].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))) });
}

function validateArtifactBudgets(files: readonly { path: string; bytes: number }[]) {
  const js = files.filter((file) => file.path.endsWith(".js")).reduce((sum, file) => sum + file.bytes, 0);
  const css = files.filter((file) => file.path.endsWith(".css")).reduce((sum, file) => sum + file.bytes, 0);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (
    files.length > APP_GUI_BUILD_BUDGET.generatedFiles ||
    js > APP_GUI_BUILD_BUDGET.generatedJsBytes ||
    css > APP_GUI_BUILD_BUDGET.generatedCssBytes ||
    total > APP_GUI_BUILD_BUDGET.generatedBytes
  ) {
    throw findingsError([{ code: "GUI_BUILD_OUTPUT_LIMIT", file: "gui/", message: "generated App GUI exceeds a fixed output budget" }]);
  }
}

function diagnosticFinding(diagnostic: ts.Diagnostic, snapshotRoot: string): AppGuiBuildFinding {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").slice(0, APP_GUI_BUILD_BUDGET.findingMessageBytes);
  const file = diagnostic.file ? relative(snapshotRoot, diagnostic.file.fileName).split(sep).join("/") : "gui/src/";
  const location = diagnostic.file && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : null;
  return {
    code: "GUI_TYPECHECK_FAILED",
    file: file.startsWith("..") ? "gui/src/" : file,
    ...(location ? { line: location.line + 1, column: location.character + 1 } : {}),
    message,
  };
}

function moduleResolution(path: string): ts.ResolvedModuleFull {
  return { resolvedFileName: path, extension: ts.Extension.Dts, isExternalLibraryImport: false };
}

function listSourceFilesSync(root: string) {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const result: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if ([".ts", ".tsx"].includes(extname(entry.name))) result.push(path);
    }
  };
  visit(root);
  return result;
}

function platformIdentity(): AppGuiBuildReceipt["platform"] {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  if (process.platform === "win32" && process.arch === "x64") return "win32-x64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  throw findingsError([{ code: "GUI_COMPILER_SANDBOX_UNAVAILABLE", file: "app.json", message: "compiled App GUI is unsupported on this platform architecture" }]);
}

function renderIndex(prepaint: string, stylesheet: string, bootstrap: string) {
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Bottega App</title>\n<script src="./assets/${prepaint}"></script>\n<link rel="stylesheet" href="./assets/${stylesheet}">\n</head>\n<body>\n<div id="root"></div>\n<div id="bottega-portal-root"></div>\n<script type="module" src="./assets/${bootstrap}"></script>\n</body>\n</html>\n`;
}

function basenameOf(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function findingsError(findings: readonly AppGuiBuildFinding[]) {
  return Object.assign(new Error(findings[0]?.message ?? "App GUI build failed"), { code: findings[0]?.code, findings });
}

const PREPAINT_SOURCE = `(function(){"use strict";var p=new URLSearchParams(location.hash.slice(1));var d=document.documentElement;var c=p.get("colorScheme")==="dark"?"dark":"light";d.classList.toggle("dark",c==="dark");d.style.colorScheme=c;d.lang=p.get("lang")||"en";d.dataset.locale=p.get("locale")||d.lang;d.dataset.timeZone=p.get("timeZone")||"UTC";d.dataset.density=p.get("density")==="compact"?"compact":"comfortable";d.dataset.reducedMotion=p.get("reducedMotion")==="true"?"true":"false";})();\n`;

