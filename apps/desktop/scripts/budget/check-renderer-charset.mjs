/**
 * [INPUT]: Depends on TypeScript's parser, Node fs/path and the renderer-bundled source roots.
 * [OUTPUT]: Provides wideLiterals (non-Latin-1 characters in regex literals and String.raw templates) and a CLI that fails on any, with --self-test.
 * [POS]: Pre-build guard for the renderer's one-byte chunks; runs before electron-vite in the desktop build.
 */
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import console from "node:console";
import process from "node:process";
import ts from "typescript";

/* The build emits with charset "ascii", which escapes string content but leaves regex literals and String.raw exactly as
   written. One character above U+00FF there makes V8 hold the whole chunk as UTF-16, doubling its resident size. Build
   such patterns from string literals, or write the characters as \u escapes. */
const repo = resolve(import.meta.dirname, "../../../..");
export const ROOTS = ["apps/desktop/src", "packages/chat-ui/src", "packages/base-ui/src", "packages/base-core/src", "packages/ui/src"];
const SOURCE = /\.(tsx?|mjs|js)$/;
const TEST = /(\.test\.|\/__tests__\/|\/test-support\/)/;
const WIDE = /[\u0100-\uffff]/;

export function wideLiterals(fileName, text) {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const report = (node, kind) => {
    const source = node.getText(file);
    if (!WIDE.test(source)) return;
    found.push(`${fileName}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1} ${kind} ${source.slice(0, 80)}`);
  };
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) report(node, "regex");
    else if (ts.isTaggedTemplateExpression(node) && node.tag.getText(file) === "String.raw") report(node, "String.raw");
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function files(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && SOURCE.test(entry.name))
    .map(entry => resolve(entry.parentPath, entry.name))
    .filter(path => !TEST.test(path) && !path.includes("/node_modules/"));
}

function selfTest() {
  const planted = [
    ["regex.ts", "const a = /拒绝非主窗口|request-not-active/;"],
    ["raw.tsx", "const b = String.raw`请求已结束`;"],
  ];
  for (const [name, text] of planted) if (!wideLiterals(name, text).length) throw new Error(`self-test: ${name} was not caught`);
  const allowed = ["const c = new RegExp([\"拒绝非主窗口\"].join(\"|\"));", "const d = /\\u63a8\\u8350|café/;", "// 注释 /中文/"];
  for (const text of allowed) if (wideLiterals("ok.ts", text).length) throw new Error(`self-test: allowed form was flagged: ${text}`);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  selfTest();
  const found = ROOTS.flatMap(root => files(resolve(repo, root)))
    .flatMap(path => wideLiterals(relative(repo, path), readFileSync(path, "utf8")));
  if (found.length) {
    console.error(`Non-Latin-1 characters in regex literals or String.raw (the renderer chunk would load as UTF-16):\n${found.join("\n")}`);
    process.exit(1);
  }
  console.log("[renderer-charset] PASS");
}
