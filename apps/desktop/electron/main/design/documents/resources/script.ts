/**
 * [INPUT]: Acorn syntax trees, lexical binding scopes and immutable JavaScript text.
 * [OUTPUT]: Actual import/export and unshadowed static fetch argument spans; no literal/comment matching.
 * [POS]: Script resource analysis; dynamic expressions and runtime overrides remain unchecked.
 */
import { parse, type Node } from "acorn";
import type { DesignReference } from "./types";
type Ast = Node & Record<string, unknown>;
type Scope = { parent?: Scope; function: boolean; bindings: Set<string>; dynamic?: boolean };
const ast = (value: unknown): Ast | null => value && typeof value === "object" && "type" in value ? value as Ast : null;
const name = (value: unknown): string | null => { const node = ast(value); return node?.type === "Identifier" ? node.name as string : null; };
const bound = (scope: Scope, identifier: string): boolean => scope.bindings.has(identifier) || Boolean(scope.parent && bound(scope.parent, identifier));
function bind(value: unknown, scope: Scope) {
  const node = ast(value); if (!node) return;
  const identifier = name(node);
  if (identifier) { scope.bindings.add(identifier); return; }
  if (node.type === "AssignmentPattern") bind(node.left, scope);
  else if (node.type === "RestElement") bind(node.argument, scope);
  else if (node.type === "ArrayPattern") for (const item of node.elements as unknown[]) bind(item, scope);
  else if (node.type === "ObjectPattern") for (const item of node.properties as Ast[]) bind(item.type === "RestElement" ? item.argument : item.value, scope);
}
export function scriptReferences(text: string, base = 0): DesignReference[] {
  let root: Node;
  try { root = parse(text, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }); }
  catch {
    try { root = parse(text, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }); }
    catch { return []; } // Syntax/interaction remains a renderer check; never guess positions in invalid code.
  }
  const result: DesignReference[] = [], calls: { node: Ast; scope: Scope }[] = [], mutations: { node: Ast; scope: Scope }[] = [];
  const source = (value: unknown) => {
    const node = ast(value);
    if (node?.type === "Literal" && typeof node.value === "string")
      result.push({ kind: "load", url: node.value, start: base + node.start + 1, end: base + node.end - 1 });
  };
  const globalFetch = (value: unknown, scope: Scope) => {
    const node = ast(value); if (!node) return false;
    if (name(node) === "fetch") return !bound(scope, "fetch");
    const object = name(node.object), property = node.computed ? ast(node.property)?.value : name(node.property);
    return node.type === "MemberExpression" && property === "fetch" && Boolean(object && ["window", "globalThis", "self"].includes(object) && !bound(scope, object));
  };
  const visit = (node: Ast, parent: Scope) => {
    let scope = parent;
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") bind(node.id, parent);
    if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) {
      scope = { parent, function: true, bindings: new Set(), dynamic: parent.dynamic }; bind(node.id, scope);
      for (const parameter of node.params as unknown[]) bind(parameter, scope);
    } else if (["BlockStatement", "CatchClause", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement", "StaticBlock", "ClassDeclaration", "ClassExpression", "WithStatement"].includes(node.type)) {
      scope = { parent, function: node.type === "StaticBlock", bindings: new Set(), dynamic: node.type === "WithStatement" || parent.dynamic };
      if (node.type === "CatchClause") bind(node.param, scope);
      if (node.type.startsWith("Class")) bind(node.id, scope);
    }
    if (node.type === "VariableDeclaration") {
      let target = scope; if (node.kind === "var") while (!target.function && target.parent) target = target.parent;
      for (const declaration of node.declarations as Ast[]) bind(declaration.id, target);
    }
    if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers as Ast[]) bind(specifier.local, scope);
      source(node.source);
    }
    if (node.type === "ImportExpression" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") source(node.source);
    if (node.type === "CallExpression") calls.push({ node, scope });
    if (node.type === "AssignmentExpression" || node.type === "UpdateExpression") mutations.push({ node: ast(node.left ?? node.argument)!, scope });
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const item of value) { const child = ast(item); if (child) visit(child, scope); } }
      else { const child = ast(value); if (child) visit(child, scope); }
    }
  };
  visit(root as Ast, { function: true, bindings: new Set() });
  const overridden = mutations.some(value => globalFetch(value.node, value.scope));
  if (!overridden) for (const call of calls) if (!call.scope.dynamic && globalFetch(call.node.callee, call.scope)) source((call.node.arguments as unknown[])[0]);
  return result;
}
