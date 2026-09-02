/**
 * [INPUT]: Depends on TypeScript source trees and the fixed @bottega/app-react author module
 * [OUTPUT]: Provides one runtime import/re-export analysis for admission and receipt slicing
 * [POS]: gui-build source-semantics authority; admission and compiler consume the same binding truth
 */

import ts from "typescript";

export type AuthorModuleUsage = Readonly<{
  specifiers: ReadonlySet<string>;
  appReactBindings: ReadonlySet<string>;
}>;

export function analyzeAuthorModuleUsage(tree: ts.SourceFile): AuthorModuleUsage {
  const specifiers = new Set<string>();
  const appReactBindings = new Set<string>();
  for (const node of tree.statements) {
    const specifier = moduleSpecifier(node);
    if (!specifier || isTypeOnly(node)) continue;
    specifiers.add(specifier);
    if (specifier === "@bottega/app-react") collectBindings(node, appReactBindings);
  }
  return { specifiers, appReactBindings };
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
