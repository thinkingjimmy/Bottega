/**
 * [INPUT]: Depends on the TypeScript syntax tree and lexical value declarations
 * [OUTPUT]: Provides scope-aware denial of dynamic-code, cross-frame, raw-transport, and remote-resource authorities
 * [POS]: gui-build source-policy analyzer; the single scanner for App-authored code, so comments and prose never reach a policy decision
 */

import ts from "typescript";

const DYNAMIC_AUTHORITIES = new Set([
  "eval",
  "Function",
  "Blob",
  "Worker",
  "SharedWorker",
  "WebAssembly",
  "createObjectURL",
]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self"]);
const CROSS_FRAME_OBJECTS = new Set(["parent", "top", "opener"]);
const RAW_TRANSPORT = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "postMessage",
  "BottegaBase",
]);
const RAW_TRANSPORT_MARKERS = [
  "/_sdk/base-api.js",
  "/_api/",
  "baseToken",
  "surfaceLeaseId",
] as const;
/* 只认真正的远端引用：绝对 http(s) 或协议相对前缀。`a/b`、`1/2`、注释里的
   `//` 都不是取数，把它们判死等于让每一行行内注释都构不出 App。 */
const ABSOLUTE_REMOTE = /https?:\/\/[^\s/?#]/i;
const PROTOCOL_RELATIVE_REMOTE = /^\/\/[^\s/?#]/;

type RuntimePolicyCode =
  | "GUI_BUILD_IMPORT_FORBIDDEN"
  | "GUI_BUILD_RAW_SDK_FORBIDDEN"
  | "GUI_BUILD_REMOTE_RESOURCE";
type Finding = Readonly<{ node: ts.Node; code: RuntimePolicyCode; message: string }>;
type Verdict = Readonly<{ code: RuntimePolicyCode; message: string }> | null;

export function findForbiddenRuntimeAuthorities(tree: ts.SourceFile): readonly Finding[] {
  const bindings = collectBindings(tree);
  const findings: Finding[] = [];
  const visit = (node: ts.Node) => {
    const verdict = forbiddenVerdict(node, bindings);
    if (verdict) {
      findings.push({ node, ...verdict });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return findings;
}

function forbiddenVerdict(
  node: ts.Node,
  bindings: ReadonlyMap<ts.Node, ReadonlySet<string>>
): Verdict {
  const literal = literalText(node);
  if (literal !== null) return literalVerdict(literal);
  const message = forbiddenMessage(node, bindings);
  if (message) return { code: "GUI_BUILD_IMPORT_FORBIDDEN", message };
  const transport = rawTransportMessage(node, bindings);
  return transport ? { code: "GUI_BUILD_RAW_SDK_FORBIDDEN", message: transport } : null;
}

/* 字符串字面量与模板片段是唯一能承载 URL 的语法位置；JSX 属性值本身就是
   StringLiteral，注释与 JSX 文本则不是，这正是行内注释不再被判死的原因。 */
function literalText(node: ts.Node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }
  return null;
}

function rawTransportMessage(
  node: ts.Node,
  bindings: ReadonlyMap<ts.Node, ReadonlySet<string>>
) {
  if (ts.isIdentifier(node) && isRuntimeReference(node)) {
    return RAW_TRANSPORT.has(node.text) && isUnbound(node, bindings)
      ? `Raw transport authority ${node.text} may not be referenced or aliased`
      : null;
  }
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return null;
  const accessed = ts.isElementAccessExpression(node)
    ? constantString(node.argumentExpression)
    : node.name.text;
  return accessed && RAW_TRANSPORT.has(accessed)
    ? `Raw transport authority ${accessed} may not be accessed as a property`
    : null;
}

function literalVerdict(text: string): Verdict {
  if (ABSOLUTE_REMOTE.test(text) || PROTOCOL_RELATIVE_REMOTE.test(text)) {
    return { code: "GUI_BUILD_REMOTE_RESOURCE", message: "remote resources are forbidden" };
  }
  const marker = RAW_TRANSPORT_MARKERS.find((item) => text.includes(item));
  return marker
    ? { code: "GUI_BUILD_RAW_SDK_FORBIDDEN", message: `Raw transport literal ${marker} is forbidden` }
    : null;
}

function forbiddenMessage(node: ts.Node, bindings: ReadonlyMap<ts.Node, ReadonlySet<string>>) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    if (node.tagName.getText().toLowerCase() === "script") {
      return "App-authored script elements are forbidden";
    }
  }
  if (ts.isIdentifier(node) && isRuntimeReference(node)) {
    if (DYNAMIC_AUTHORITIES.has(node.text) && isUnbound(node, bindings)) {
      return `Dynamic code authority ${node.text} may not be referenced or aliased`;
    }
    if (CROSS_FRAME_OBJECTS.has(node.text) && isUnbound(node, bindings)) {
      return `Cross-frame authority ${node.text} may not be referenced or aliased`;
    }
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const member = memberAccess(node, bindings);
    if (member?.global && member.name && DYNAMIC_AUTHORITIES.has(member.name)) {
      return `Dynamic code authority ${member.name} may not be accessed through a global object`;
    }
    if (member?.global && member.name && CROSS_FRAME_OBJECTS.has(member.name)) {
      return `Cross-frame authority ${member.name} may not be accessed through a global object`;
    }
    if (member?.global && member.computed && member.name === null) {
      return "Non-constant computed global authority access is forbidden";
    }
    if (member?.crossFrame) return "Cross-frame property access is forbidden";
  }
  if (!ts.isCallExpression(node)) return null;
  const reflective = reflectGet(node, bindings);
  if (reflective) return reflective;
  const name = calledName(node.expression);
  if (name === "setTimeout" || name === "setInterval") {
    const argument = node.arguments[0];
    if (argument && !isCallableArgument(argument)) {
      return `String-backed ${name} execution is forbidden`;
    }
  }
  if (
    name === "createElement" &&
    constantString(node.arguments[0])?.toLowerCase() === "script"
  ) return "App-authored script elements are forbidden";
  return null;
}

function memberAccess(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  bindings: ReadonlyMap<ts.Node, ReadonlySet<string>>
) {
  const root = expressionRoot(node.expression);
  if (!root || !isUnbound(root, bindings)) return null;
  const computed = ts.isElementAccessExpression(node);
  const name = computed
    ? constantString(node.argumentExpression)
    : node.name.text;
  return {
    computed,
    name,
    global: GLOBAL_OBJECTS.has(root.text),
    crossFrame: CROSS_FRAME_OBJECTS.has(root.text),
  };
}

function reflectGet(
  node: ts.CallExpression,
  bindings: ReadonlyMap<ts.Node, ReadonlySet<string>>
) {
  const expression = node.expression;
  if (
    !ts.isPropertyAccessExpression(expression) ||
    expression.name.text !== "get" ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "Reflect" ||
    !isUnbound(expression.expression, bindings)
  ) return null;
  const target = unwrap(node.arguments[0]);
  const property = constantString(node.arguments[1]);
  if (
    target &&
    ts.isIdentifier(target) &&
    CROSS_FRAME_OBJECTS.has(target.text) &&
    isUnbound(target, bindings)
  ) return "Reflective cross-frame property access is forbidden";
  if (
    target &&
    ts.isIdentifier(target) &&
    GLOBAL_OBJECTS.has(target.text) &&
    isUnbound(target, bindings) &&
    property &&
    CROSS_FRAME_OBJECTS.has(property)
  ) return "Reflective cross-frame authority access is forbidden";
  if (property && DYNAMIC_AUTHORITIES.has(property)) {
    return `Reflective dynamic code authority ${property} is forbidden`;
  }
  if (property === "postMessage") return "Reflective postMessage access is forbidden";
  return null;
}

function calledName(expression: ts.LeftHandSideExpression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) return constantString(expression.argumentExpression);
  return null;
}

function expressionRoot(expression: ts.Expression): ts.Identifier | null {
  const current = unwrap(expression);
  if (!current) return null;
  if (ts.isIdentifier(current)) return current;
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    return expressionRoot(current.expression);
  }
  return null;
}

function constantString(node: ts.Expression | undefined): string | null {
  const value = unwrap(node);
  if (!value) return null;
  if (ts.isStringLiteralLike(value)) return value.text;
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantString(value.left);
    const right = constantString(value.right);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isArrayLiteralExpression(value)) {
    const parts = value.elements.map((element) =>
      ts.isExpression(element) ? constantString(element) : null
    );
    return parts.some((part) => part === null) ? null : parts.join(",");
  }
  if (
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression) &&
    value.expression.name.text === "join" &&
    ts.isArrayLiteralExpression(unwrap(value.expression.expression) ?? value.expression.expression)
  ) {
    const target = constantString(value.expression.expression);
    const separator = value.arguments.length ? constantString(value.arguments[0]) : ",";
    if (target === null || separator === null) return null;
    const array = unwrap(value.expression.expression) as ts.ArrayLiteralExpression;
    const parts = array.elements.map((element) =>
      ts.isExpression(element) ? constantString(element) : null
    );
    return parts.some((part) => part === null) ? null : parts.join(separator);
  }
  if (ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  return null;
}

function unwrap(node: ts.Expression | undefined): ts.Expression | undefined {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current))
  ) current = current.expression;
  return current;
}

function isCallableArgument(node: ts.Expression) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isIdentifier(node);
}

function collectBindings(tree: ts.SourceFile) {
  const scopes = new Map<ts.Node, Set<string>>();
  const add = (scope: ts.Node, name: ts.BindingName | ts.Identifier) => {
    const names = bindingNames(name);
    const set = scopes.get(scope) ?? new Set<string>();
    for (const item of names) set.add(item);
    scopes.set(scope, set);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportClause(node)) {
      if (node.name && !node.isTypeOnly) add(tree, node.name);
      const bindings = node.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) add(tree, bindings.name);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) if (!element.isTypeOnly) add(tree, element.name);
      }
    } else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
      if (node.name) add(parentScope(node), node.name);
    } else if (ts.isVariableDeclaration(node)) {
      add(variableScope(node), node.name);
    } else if (ts.isParameter(node)) {
      add(parentFunction(node), node.name);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      add(node, node.variableDeclaration.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return scopes;
}

function bindingNames(name: ts.BindingName | ts.Identifier): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name)
  );
}

function variableScope(node: ts.VariableDeclaration) {
  const list = node.parent;
  const isVar = ts.isVariableDeclarationList(list) &&
    (list.flags & ts.NodeFlags.BlockScoped) === 0;
  let current: ts.Node = node.parent;
  while (current.parent) {
    if (isVar && (ts.isFunctionLike(current) || ts.isSourceFile(current))) return current;
    if (!isVar && isLexicalScope(current)) return current;
    current = current.parent;
  }
  return current;
}

function parentFunction(node: ts.Node) {
  let current = node.parent;
  while (current.parent && !ts.isFunctionLike(current)) current = current.parent;
  return current;
}

function parentScope(node: ts.Node) {
  let current = node.parent;
  while (current.parent && !isLexicalScope(current)) current = current.parent;
  return current;
}

function isLexicalScope(node: ts.Node) {
  return ts.isSourceFile(node) || ts.isFunctionLike(node) || ts.isBlock(node) ||
    ts.isCatchClause(node) || ts.isForStatement(node) || ts.isForInStatement(node) ||
    ts.isForOfStatement(node);
}

function isUnbound(identifier: ts.Identifier, scopes: ReadonlyMap<ts.Node, ReadonlySet<string>>) {
  let current: ts.Node | undefined = identifier;
  while (current) {
    if (isLexicalScope(current) && scopes.get(current)?.has(identifier.text)) return false;
    current = current.parent;
  }
  return true;
}

function isRuntimeReference(node: ts.Identifier) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node && parent.initializer !== node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isEnumDeclaration(parent)) && parent.name === node) return false;
  if (ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isTypeNode(parent) || ts.isTypeAliasDeclaration(parent) || ts.isInterfaceDeclaration(parent)) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  return true;
}
