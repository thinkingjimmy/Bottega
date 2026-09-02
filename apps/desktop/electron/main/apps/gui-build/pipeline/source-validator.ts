/**
 * [INPUT]: Depends on TypeScript syntax parsing, the shared runtime-authority analyzer, immutable source receipts, compiled GUI manifest, strict scaffold contracts, fixed author import metadata, and the preferences schema authority
 * [OUTPUT]: Provides compiled source layout, ABI, importer-domain, component-origin, preferences, CSS/SVG remote-reference, and raw-transport validation
 * [POS]: apps/gui-build/pipeline source policy; code policy runs on the syntax tree and only CSS/SVG keep a scoped byte check, so comments never fail a build
 */

import { readFile } from "node:fs/promises";
import { extname, join, posix } from "node:path";
import ts from "typescript";
import type {
  AppGuiBuildFinding,
  BaseGuiManifest,
} from "../../../../../shared/apps-ipc";
import type { SourceFreezeReceipt } from "../contracts";
import { authorPublicSpecifiers, canonicalJson, sha256 } from "../metadata";
import {
  validatePreferenceSchema,
  validatePreferenceValue,
} from "../../preferences/schema";
import {
  componentAuthorMirrorSchema,
  componentOriginsSchema,
} from "../scaffold/contracts";
import { findForbiddenRuntimeAuthorities } from "./dynamic-code-policy";

const FORBIDDEN_CONFIG = /(^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\..+)?\.json|vite\.config\.[^/]+|postcss\.config\.[^/]+|tailwind\.config\.[^/]+)$/i;
const FORBIDDEN_CSS_DIRECTIVE = /@(plugin|config|source)\b/i;
/* CSS 与 SVG 没有语法树可用，所以只扫真正会发起请求的位置：url() 目标、
   @import 目标、以及 href/src 引用。CSS 注释与 SVG 的 xmlns 命名空间标识符
   都不是取数，判死它们只会让作者写不出一行注释、画不出一张图。 */
const CSS_REMOTE_REFERENCE = /(?:url\(|@import\s+(?:url\()?)\s*["']?\s*(?:https?:)?\/\/[^\s/?#]/i;
const MARKUP_REMOTE_REFERENCE = /\b(?:xlink:href|href|src)\s*=\s*["']\s*(?:https?:)?\/\/[^\s/?#]/i;
const SCANNED_ASSETS = [".css", ".svg"];
const SCANNED_SOURCES = [".ts", ".tsx", ".js", ".jsx"];
export async function validateCompiledGuiSource(
  receipt: SourceFreezeReceipt,
  gui: BaseGuiManifest
): Promise<readonly AppGuiBuildFinding[]> {
  const findings: AppGuiBuildFinding[] = [];
  const files = new Set(receipt.files.map((file) => file.path));
  const add = (finding: AppGuiBuildFinding) => {
    if (findings.length < 100) findings.push(finding);
  };
  if (!gui.build) {
    add({ code: "GUI_BUILD_MANIFEST_INVALID", file: "app.json", message: "compiled GUI build manifest is missing" });
    return findings;
  }
  const required = [
    "gui/src/main.tsx",
    "gui/src/styles.css",
    "gui/components.json",
    "gui/component-origins.json",
  ];
  for (const path of required) {
    if (!files.has(path)) add({ code: "GUI_BUILD_SOURCE_MISSING", file: path, message: "required compiled GUI source file is missing" });
  }
  if (files.has("gui/index.html")) {
    add({ code: "GUI_BUILD_MANIFEST_INVALID", file: "gui/index.html", message: "compiled source must not provide runtime index.html" });
  }
  for (const path of files) {
    if (FORBIDDEN_CONFIG.test(path)) add({ code: "GUI_BUILD_IMPORT_FORBIDDEN", file: path, message: "App-controlled build configuration is forbidden" });
  }
  await validateComponents(receipt, gui, files, add);
  await validatePreferences(receipt, gui, files, add);
  await validateSourceFiles(receipt, gui, add);
  return findings;
}

async function validateComponents(
  receipt: SourceFreezeReceipt,
  gui: BaseGuiManifest,
  files: ReadonlySet<string>,
  add: (finding: AppGuiBuildFinding) => void
) {
  const componentsPath = "gui/components.json";
  const originsPath = "gui/component-origins.json";
  if (!files.has(componentsPath) || !files.has(originsPath) || !gui.build) return;
  const components = componentAuthorMirrorSchema.safeParse(
    await readJson(receipt.snapshotRoot, componentsPath, add)
  );
  if (
    !components.success ||
    components.data.iconLibrary !== gui.build.iconLibrary
  ) {
    add({ code: "GUI_BUILD_ICON_LIBRARY_MISMATCH", file: componentsPath, message: "components.json must be the strict Base UI mirror of the manifest icon library" });
  }
  const rawOrigins = componentOriginsSchema.safeParse(
    await readJson(receipt.snapshotRoot, originsPath, add)
  );
  if (!rawOrigins.success) {
    add({ code: "GUI_BUILD_COMPONENT_ORIGIN_INVALID", file: originsPath, message: "component origins manifest is invalid" });
    return;
  }
  const targets = new Set<string>();
  for (const origin of rawOrigins.data.files) {
    const validBlobPath = `gui/.bottega/origin-blobs/sha256/${origin.originFileDigest.slice(7)}`;
    if (
      !origin.path.startsWith("gui/src/components/ui/") ||
      origin.originBlobPath !== validBlobPath ||
      targets.has(origin.path) ||
      !files.has(origin.path) ||
      !files.has(origin.originBlobPath)
    ) {
      add({ code: "GUI_BUILD_COMPONENT_ORIGIN_INVALID", file: originsPath, message: `invalid component origin entry: ${origin.componentId}` });
      continue;
    }
    targets.add(origin.path);
    const baseBytes = await readFile(join(receipt.snapshotRoot, origin.originBlobPath));
    if (sha256(baseBytes) !== origin.originFileDigest) {
      add({ code: "GUI_BUILD_COMPONENT_ORIGIN_INVALID", file: origin.originBlobPath, message: "component origin blob digest mismatch" });
    }
  }
}

async function validatePreferences(
  receipt: SourceFreezeReceipt,
  gui: BaseGuiManifest,
  files: ReadonlySet<string>,
  add: (finding: AppGuiBuildFinding) => void
) {
  const schemaPath = "gui/preferences.schema.json";
  const defaultsPath = "gui/preferences.defaults.json";
  if (!gui.preferences) {
    if (files.has(schemaPath) || files.has(defaultsPath)) {
      add({ code: "GUI_BUILD_MANIFEST_INVALID", file: "app.json", message: "preference files require a manifest preferences identity" });
    }
    return;
  }
  if (!files.has(schemaPath) || !files.has(defaultsPath)) {
    add({ code: "GUI_BUILD_SOURCE_MISSING", file: schemaPath, message: "manifest-owned preference schema/defaults are missing" });
    return;
  }
  const schemaBytes = await readFile(join(receipt.snapshotRoot, schemaPath));
  const defaultsBytes = await readFile(join(receipt.snapshotRoot, defaultsPath));
  const schema = parseCanonicalJson(schemaBytes, schemaPath, add);
  const defaults = parseCanonicalJson(defaultsBytes, defaultsPath, add);
  if (sha256(Buffer.from(canonicalJson(schema))) !== gui.preferences.schemaDigest) {
    add({ code: "GUI_BUILD_MANIFEST_INVALID", file: schemaPath, message: "preference schema digest does not match the manifest" });
  }
  if (sha256(Buffer.from(canonicalJson(defaults))) !== gui.preferences.defaultsDigest) {
    add({ code: "GUI_BUILD_MANIFEST_INVALID", file: defaultsPath, message: "preference defaults digest does not match the manifest" });
  }
  if (!validatePreferenceSchema(schema) || !validatePreferenceValue(defaults, schema)) {
    add({ code: "GUI_BUILD_MANIFEST_INVALID", file: schemaPath, message: "preference schema/defaults use an unsupported or invalid shape" });
  }
}

async function validateSourceFiles(
  receipt: SourceFreezeReceipt,
  gui: BaseGuiManifest,
  add: (finding: AppGuiBuildFinding) => void
) {
  if (!gui.build) return;
  const allowed = authorPublicSpecifiers(gui.build.iconLibrary);
  const sourceFiles = receipt.files.filter((file) => file.path.startsWith("gui/src/"));
  const known = new Set(receipt.files.map((file) => file.path));
  for (const file of sourceFiles) {
    const extension = extname(file.path).toLowerCase();
    /* 二进制资产（png/woff/…）不参与文本策略：字节里偶然出现 `//` 不是取数。 */
    if (!SCANNED_SOURCES.includes(extension) && !SCANNED_ASSETS.includes(extension)) continue;
    const bytes = await readFile(join(receipt.snapshotRoot, file.path));
    const source = bytes.toString("utf8");
    if (SCANNED_ASSETS.includes(extension)) {
      if (CSS_REMOTE_REFERENCE.test(source) || MARKUP_REMOTE_REFERENCE.test(source)) {
        add({ code: "GUI_BUILD_REMOTE_RESOURCE", file: file.path, message: "remote resources are forbidden" });
      }
      if (extension === ".css" && FORBIDDEN_CSS_DIRECTIVE.test(source)) {
        add({ code: "GUI_BUILD_CSS_DIRECTIVE_FORBIDDEN", file: file.path, message: "@plugin, @config, and @source are forbidden" });
      }
      continue;
    }
    const kind = file.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const tree = ts.createSourceFile(file.path, source, ts.ScriptTarget.ESNext, true, kind);
    const syntaxDiagnostics = (tree as ts.SourceFile & {
      parseDiagnostics?: readonly ts.Diagnostic[];
    }).parseDiagnostics ?? [];
    if (syntaxDiagnostics.length) {
      add({ code: "GUI_TYPECHECK_FAILED", file: file.path, message: "source contains syntax errors" });
    }
    visitImports(tree, (specifier, node, dynamic, namespace) => {
      const location = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      const finding = (code: AppGuiBuildFinding["code"], message: string) => add({
        code,
        file: file.path,
        line: location.line + 1,
        column: location.character + 1,
        message,
      });
      if (dynamic) {
        finding("GUI_BUILD_IMPORT_FORBIDDEN", "App-authored dynamic import is forbidden");
        return;
      }
      if (specifier === "react-dom" || specifier === "react-dom/client") {
        finding("GUI_BUILD_ENTRY_ABI_INVALID", "ReactDOM and root ownership belong to the product bootstrap");
        return;
      }
      if (namespace && (specifier === "lucide-react" || specifier.startsWith("@phosphor-icons/react"))) {
        finding("GUI_BUILD_IMPORT_FORBIDDEN", "icon namespace imports are forbidden");
        return;
      }
      if (specifier.startsWith(".") || specifier.startsWith("@/")) {
        if (!resolvesInsideSource(file.path, specifier, known)) finding("GUI_BUILD_IMPORTER_DOMAIN_VIOLATION", "local import escapes gui/src or does not resolve");
        return;
      }
      if (!allowed.has(specifier)) {
        const iconMismatch =
          specifier === "lucide-react" || specifier.startsWith("@phosphor-icons/react");
        finding(iconMismatch ? "GUI_BUILD_ICON_LIBRARY_MISMATCH" : "GUI_BUILD_IMPORTER_DOMAIN_VIOLATION", "bare import is not in the exact author allowlist");
      }
    });
    for (const { node, code, message } of findForbiddenRuntimeAuthorities(tree)) {
      const location = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      add({ code, file: file.path, line: location.line + 1, column: location.character + 1, message });
    }
    if (file.path === "gui/src/main.tsx") validateEntrySyntax(tree, add);
  }
}

function visitImports(
  tree: ts.SourceFile,
  onImport: (specifier: string, node: ts.Node, dynamic: boolean, namespace: boolean) => void
) {
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      onImport(node.moduleSpecifier.text, node, false, Boolean(node.importClause?.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)));
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      onImport(node.moduleSpecifier.text, node, false, !node.exportClause || ts.isNamespaceExport(node.exportClause));
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      onImport(ts.isStringLiteral(argument) ? argument.text : "<dynamic>", node, true, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}

/* 语法层只判「唯一 default 且形状可能合法」，真正的 ABI 权威是 compiler.ts 里
   TypeChecker 的调用签名检查。`const App = () => …; export default App` 是 Agent
   最常见的产物，把它挡在语法层等于用一条更弱的规则否决更强的规则。 */
function validateEntrySyntax(tree: ts.SourceFile, add: (finding: AppGuiBuildFinding) => void) {
  const declared = tree.statements.filter((statement) =>
    ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  );
  const assigned = tree.statements.filter(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && statement.isExportEquals !== true
  );
  const invalid = (message: string) =>
    add({ code: "GUI_BUILD_ENTRY_ABI_INVALID", file: "gui/src/main.tsx", message });
  if (declared.length + assigned.length !== 1) {
    invalid("entry must provide exactly one zero-argument default React component");
    return;
  }
  const statement = declared[0] ?? assigned[0]!;
  if (ts.isClassDeclaration(statement)) {
    invalid("entry default export must be a function component, not a class");
    return;
  }
  if (ts.isFunctionDeclaration(statement)) {
    if (statement.parameters.length) invalid("entry default export must take no parameters");
    return;
  }
  if (!ts.isExportAssignment(statement)) {
    invalid("entry must provide exactly one zero-argument default React component");
    return;
  }
  const expression = statement.expression;
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    if (expression.parameters.length) invalid("entry default export must take no parameters");
    return;
  }
  if (!ts.isIdentifier(expression)) {
    invalid("entry default export must name a component or declare one inline");
  }
}

function resolvesInsideSource(importer: string, specifier: string, known: ReadonlySet<string>) {
  const importerDirectory = posix.dirname(importer);
  const base = specifier.startsWith("@/")
    ? `gui/src/${specifier.slice(2)}`
    : posix.normalize(posix.join(importerDirectory, specifier));
  if (!base.startsWith("gui/src/")) return false;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.css`, `${base}.module.css`, `${base}.png`, `${base}.jpg`, `${base}.jpeg`, `${base}.gif`, `${base}.webp`, `${base}.svg`, `${base}.woff`, `${base}.woff2`, `${base}/index.ts`, `${base}/index.tsx`].some((candidate) => known.has(candidate));
}

async function readJson(root: string, path: string, add: (finding: AppGuiBuildFinding) => void) {
  try {
    return JSON.parse(await readFile(join(root, path), "utf8"));
  } catch {
    add({ code: "GUI_BUILD_MANIFEST_INVALID", file: path, message: "file must contain valid JSON" });
    return null;
  }
}

function parseCanonicalJson(bytes: Buffer, file: string, add: (finding: AppGuiBuildFinding) => void) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (`${canonicalJson(value)}\n` !== bytes.toString("utf8") && canonicalJson(value) !== bytes.toString("utf8")) {
      add({ code: "GUI_BUILD_MANIFEST_INVALID", file, message: "JSON must use canonical stable encoding" });
    }
    return value;
  } catch {
    add({ code: "GUI_BUILD_MANIFEST_INVALID", file, message: "file must contain valid JSON" });
    return null;
  }
}
