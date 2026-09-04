/**
 * [INPUT]: Depends on TypeScript, the immutable source freeze receipt, and the fixed @bottega/app-react author module
 * [OUTPUT]: Provides one parse of the author source per snapshot — syntax trees plus aggregated import/re-export and App React binding sets
 * [POS]: gui-build source-semantics authority; admission, the source validator, and compiler receipts consume the same trees and the same binding truth
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import type { SourceFreezeReceipt } from "./contracts";

export type AuthorSourceModule = Readonly<{ path: string; tree: ts.SourceFile }>;

export type AuthorSourceAnalysis = Readonly<{
  modules: readonly AuthorSourceModule[];
  specifiers: ReadonlySet<string>;
  appReactBindings: ReadonlySet<string>;
}>;

/* 作者代码在一次构建里曾被解析三到四遍（准入、校验、收据、TypeChecker）。
   语法树是纯函数产物，谁先算出来谁就是权威；这里算一次，其余人只消费。 */
const AUTHOR_MODULE = /^gui\/src\/.+\.tsx?$/;

export async function analyzeAuthorSource(
  receipt: SourceFreezeReceipt
): Promise<AuthorSourceAnalysis> {
  const modules: AuthorSourceModule[] = [];
  const specifiers = new Set<string>();
  const appReactBindings = new Set<string>();
  for (const file of receipt.files) {
    if (!AUTHOR_MODULE.test(file.path)) continue;
    const source = await readFile(join(receipt.snapshotRoot, file.path), "utf8");
    const tree = ts.createSourceFile(
      file.path,
      source,
      ts.ScriptTarget.ESNext,
      true,
      file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    modules.push({ path: file.path, tree });
    collectModuleUsage(tree, specifiers, appReactBindings);
  }
  return { modules, specifiers, appReactBindings };
}

function collectModuleUsage(
  tree: ts.SourceFile,
  specifiers: Set<string>,
  appReactBindings: Set<string>
) {
  for (const node of tree.statements) {
    const specifier = moduleSpecifier(node);
    if (!specifier || isTypeOnly(node)) continue;
    specifiers.add(specifier);
    if (specifier === "@bottega/app-react") collectBindings(node, appReactBindings);
  }
}

function moduleSpecifier(node: ts.Statement) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) return node.moduleSpecifier.text;
  return null;
}

function isTypeOnly(node: ts.Statement) {
  return ts.isImportDeclaration(node)
    ? Boolean(node.importClause?.isTypeOnly)
    : ts.isExportDeclaration(node) && node.isTypeOnly;
}

function collectBindings(node: ts.Statement, bindings: Set<string>) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return;
    if (clause.name || clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.add("*");
      return;
    }
    for (const binding of clause.namedBindings?.elements ?? []) {
      if (!binding.isTypeOnly) bindings.add((binding.propertyName ?? binding.name).text);
    }
    return;
  }
  if (!ts.isExportDeclaration(node)) return;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) {
    bindings.add("*");
    return;
  }
  for (const binding of node.exportClause.elements) {
    if (!binding.isTypeOnly) bindings.add((binding.propertyName ?? binding.name).text);
  }
}
