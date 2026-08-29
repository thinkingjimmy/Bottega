/**
 * [INPUT]: Depends on Base column metadata and caller-provided dependency value resolution
 * [OUTPUT]: Provides bounded formula parse/evaluate/dependency/cycle APIs plus quote-aware display/storage field-reference mapping
 * [POS]: The shared read-only formula kernel; main and renderer consume identical pure semantics without filesystem, DOM, or platform access
 */

import type { BaseCellValue, BaseColumn } from "./base-values";

export const BASE_FORMULA_EXPRESSION_LIMIT = 4_096;
export const BASE_FORMULA_TOKEN_LIMIT = 512;
export const BASE_FORMULA_DEPTH_LIMIT = 32;
export const BASE_FORMULA_STEP_LIMIT = 2_048;
export const BASE_FORMULA_OUTPUT_BYTE_LIMIT = 16 * 1024;
export const BASE_FORMULA_MEMO_LIMIT = 1_024;

export type BaseFormulaResultType = "number" | "text" | "boolean";
export type BaseFormulaErrorCode =
  | "#REF!"
  | "#DIV/0!"
  | "#TYPE!"
  | "#ERROR!"
  | "#LIMIT!";

type Scalar = string | number | boolean;
type Token =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "ref"; value: string }
  | { kind: "name"; value: string }
  | { kind: "symbol"; value: string }
  | { kind: "eof" };

type Node =
  | { kind: "literal"; value: Scalar }
  | { kind: "ref"; columnId: string }
  | { kind: "unary"; operator: "+" | "-"; value: Node }
  | { kind: "binary"; operator: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

export type ParsedBaseFormula = {
  ast: Node;
  dependencies: readonly string[];
  resultType: BaseFormulaResultType;
};

export type BaseFormulaParseResult =
  | { ok: true; value: ParsedBaseFormula }
  | { ok: false; error: BaseFormulaErrorCode; message: string };

export type BaseFormulaEvaluation =
  | { ok: true; value: Scalar }
  | { ok: false; error: BaseFormulaErrorCode };

export function parseBaseFormula(
  expression: string,
  columns: readonly BaseColumn[] = []
): BaseFormulaParseResult {
  if (!expression.trim()) return parseFailure("公式不能为空");
  if (utf8Bytes(expression) > BASE_FORMULA_EXPRESSION_LIMIT) {
    return parseFailure("公式过长", "#LIMIT!");
  }
  try {
    const parser = new Parser(tokenize(expression));
    const ast = parser.parse();
    assertAstDepth(ast);
    const dependencies = [...collectDependencies(ast)].sort();
    return {
      ok: true,
      value: {
        ast,
        dependencies,
        resultType: inferResultType(
          ast,
          new Map(columns.map((column) => [column.id, resultTypeOf(column)]))
        ),
      },
    };
  } catch (cause) {
    const error = formulaError(cause);
    return { ok: false, error: error.code, message: error.message };
  }
}

export function evaluateBaseFormula(
  parsed: ParsedBaseFormula,
  resolve: (columnId: string) => BaseCellValue | undefined
): BaseFormulaEvaluation {
  let steps = 0;
  try {
    const value = evaluate(parsed.ast, resolve, () => {
      steps += 1;
      if (steps > BASE_FORMULA_STEP_LIMIT) {
        throw fault("#LIMIT!", "公式求值步数超限");
      }
    });
    if (utf8Bytes(String(value)) > BASE_FORMULA_OUTPUT_BYTE_LIMIT) {
      return { ok: false, error: "#LIMIT!" };
    }
    return { ok: true, value };
  } catch (cause) {
    return { ok: false, error: formulaError(cause).code };
  }
}

export function baseFormulaDependencies(expression: string) {
  const parsed = parseBaseFormula(expression);
  return parsed.ok ? parsed.value.dependencies : [];
}

export function findBaseFormulaCycle(columns: readonly BaseColumn[]) {
  const formulas = new Map(
    columns
      .filter((column) => column.type === "formula" && column.formula)
      .map((column) => [column.id, column.formula!] as const)
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const trail: string[] = [];
  const visit = (columnId: string): string[] | null => {
    if (visiting.has(columnId)) {
      return [...trail.slice(trail.indexOf(columnId)), columnId];
    }
    if (visited.has(columnId)) return null;
    visiting.add(columnId);
    trail.push(columnId);
    for (const dependency of baseFormulaDependencies(
      formulas.get(columnId)?.expression ?? ""
    )) {
      if (!formulas.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    trail.pop();
    visiting.delete(columnId);
    visited.add(columnId);
    return null;
  };
  for (const columnId of formulas.keys()) {
    const cycle = visit(columnId);
    if (cycle) return cycle;
  }
  return null;
}

export function formulaExpressionForDisplay(
  expression: string,
  columns: readonly BaseColumn[]
) {
  const names = new Map(columns.map((column) => [column.id, column.name]));
  return rewriteFieldRefs(expression, (id) => names.get(id) ?? id);
}

export function formulaExpressionForStorage(
  expression: string,
  columns: readonly BaseColumn[]
) {
  const byName = new Map<string, string[]>();
  for (const column of columns) {
    const matches = byName.get(column.name) ?? [];
    matches.push(column.id);
    byName.set(column.name, matches);
  }
  return rewriteFieldRefs(expression, (name) => {
    const ids = byName.get(name);
    if (!ids) return name;
    if (ids.length !== 1) throw fault("#REF!", `列名 ${name} 不唯一`);
    return ids[0]!;
  });
}

/* 只在字符串字面量之外重写 {…}。tokenizer 会解码转义，拿它重序列化会
   改写用户原文；这里直接沿原始字符前进，字符串段连同转义逐字节搬运。 */
function rewriteFieldRefs(
  expression: string,
  map: (inner: string) => string
): string {
  let output = "";
  let index = 0;
  while (index < expression.length) {
    const char = expression[index]!;
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < expression.length) {
        const next = expression[index]!;
        index += 1;
        if (next === "\\") {
          index += 1;
          continue;
        }
        if (next === '"') break;
      }
      output += expression.slice(start, index);
      continue;
    }
    if (char === "{") {
      const end = expression.indexOf("}", index + 1);
      if (end < 0) {
        output += expression.slice(index);
        break;
      }
      const inner = expression.slice(index + 1, end).trim();
      output += `{${map(inner)}}`;
      index = end + 1;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let nesting = 0;
  const push = (token: Token) => {
    tokens.push(token);
    if (tokens.length > BASE_FORMULA_TOKEN_LIMIT) {
      throw fault("#LIMIT!", "公式 token 数超限");
    }
  };
  while (index < expression.length) {
    const char = expression[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "{") {
      const end = expression.indexOf("}", index + 1);
      if (end < 0) throw fault("#ERROR!", "字段引用缺少右花括号");
      const value = expression.slice(index + 1, end).trim();
      if (!value) throw fault("#REF!", "字段引用不能为空");
      push({ kind: "ref", value });
      index = end + 1;
      continue;
    }
    if (char === '"') {
      let value = "";
      index += 1;
      for (;;) {
        if (index >= expression.length) {
          throw fault("#ERROR!", "字符串缺少结束引号");
        }
        const next = expression[index++]!;
        if (next === '"') break;
        if (next === "\\") {
          const escaped = expression[index++];
          if (escaped === undefined) throw fault("#ERROR!", "转义不完整");
          value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
        } else {
          value += next;
        }
      }
      push({ kind: "string", value });
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(expression.slice(index));
    if (number) {
      push({ kind: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(index));
    if (name) {
      push({ kind: "name", value: name[0].toUpperCase() });
      index += name[0].length;
      continue;
    }
    const pair = expression.slice(index, index + 2);
    if ([">=", "<=", "!=", "==", "<>"].includes(pair)) {
      push({ kind: "symbol", value: pair });
      index += 2;
      continue;
    }
    if ("+-*/(),=<>".includes(char)) {
      if (char === "(") {
        nesting += 1;
        if (nesting > BASE_FORMULA_DEPTH_LIMIT) {
          throw fault("#LIMIT!", "公式 AST 深度超限");
        }
      }
      if (char === ")") nesting -= 1;
      push({ kind: "symbol", value: char });
      index += 1;
      continue;
    }
    throw fault("#ERROR!", `无法识别字符 ${char}`);
  }
  push({ kind: "eof" });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse() {
    const value = this.comparison();
    if (this.current().kind !== "eof") throw fault("#ERROR!", "公式尾部无效");
    return value;
  }

  private comparison() {
    let left = this.additive();
    while (this.symbol("=") || this.symbol("==") || this.symbol("!=") ||
      this.symbol("<>") || this.symbol(">") || this.symbol(">=") ||
      this.symbol("<") || this.symbol("<=")) {
      const operator = (this.take() as Extract<Token, { kind: "symbol" }>).value;
      left = { kind: "binary", operator, left, right: this.additive() };
    }
    return left;
  }

  private additive() {
    let left = this.multiplicative();
    while (this.symbol("+") || this.symbol("-")) {
      const operator = (this.take() as Extract<Token, { kind: "symbol" }>).value;
      left = { kind: "binary", operator, left, right: this.multiplicative() };
    }
    return left;
  }

  private multiplicative() {
    let left = this.unary();
    while (this.symbol("*") || this.symbol("/")) {
      const operator = (this.take() as Extract<Token, { kind: "symbol" }>).value;
      left = { kind: "binary", operator, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Node {
    if (this.symbol("+") || this.symbol("-")) {
      const operator = (this.take() as Extract<Token, { kind: "symbol" }>).value as "+" | "-";
      return { kind: "unary", operator, value: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    const token = this.take();
    if (token.kind === "number" || token.kind === "string") {
      return { kind: "literal", value: token.value };
    }
    if (token.kind === "ref") return { kind: "ref", columnId: token.value };
    if (token.kind === "name") {
      if (token.value === "TRUE" || token.value === "FALSE") {
        return { kind: "literal", value: token.value === "TRUE" };
      }
      this.expect("(");
      const args: Node[] = [];
      if (!this.symbol(")")) {
        do args.push(this.comparison()); while (this.consume(","));
      }
      this.expect(")");
      validateFunction(token.value, args.length);
      return { kind: "call", name: token.value, args };
    }
    if (token.kind === "symbol" && token.value === "(") {
      const value = this.comparison();
      this.expect(")");
      return value;
    }
    throw fault("#ERROR!", "公式缺少值");
  }

  private current() { return this.tokens[this.index]!; }
  private take() { return this.tokens[this.index++]!; }
  private symbol(value: string) {
    const token = this.current();
    return token.kind === "symbol" && token.value === value;
  }
  private consume(value: string) {
    if (!this.symbol(value)) return false;
    this.index += 1;
    return true;
  }
  private expect(value: string) {
    if (!this.consume(value)) throw fault("#ERROR!", `公式缺少 ${value}`);
  }
}

function validateFunction(name: string, count: number) {
  const ranges: Record<string, [number, number]> = {
    IF: [3, 3], AND: [1, 32], OR: [1, 32], NOT: [1, 1],
    CONCAT: [1, 32], LEN: [1, 1], UPPER: [1, 1], LOWER: [1, 1], ROUND: [1, 2],
  };
  const range = ranges[name];
  if (!range) throw fault("#ERROR!", `不支持函数 ${name}`);
  if (count < range[0] || count > range[1]) {
    throw fault("#ERROR!", `${name} 参数数量无效`);
  }
}

function evaluate(
  node: Node,
  resolve: (columnId: string) => BaseCellValue | undefined,
  step: () => void
): Scalar {
  step();
  if (node.kind === "literal") return node.value;
  if (node.kind === "ref") {
    const value = resolve(node.columnId);
    if (value === undefined) throw fault("#REF!", "字段不存在或为空");
    if (typeof value === "object") throw fault("#TYPE!", "对象值不能进入公式");
    if (typeof value === "string" && isFormulaError(value)) {
      throw fault(value, value);
    }
    return value;
  }
  if (node.kind === "unary") {
    const value = numberValue(evaluate(node.value, resolve, step));
    return node.operator === "-" ? -value : value;
  }
  if (node.kind === "binary") {
    const left = evaluate(node.left, resolve, step);
    const right = evaluate(node.right, resolve, step);
    if (["=", "==", "!=", "<>", ">", ">=", "<", "<="].includes(node.operator)) {
      const order = compareScalar(left, right);
      if (node.operator === "=" || node.operator === "==") return order === 0;
      if (node.operator === "!=" || node.operator === "<>") return order !== 0;
      if (node.operator === ">") return order > 0;
      if (node.operator === ">=") return order >= 0;
      if (node.operator === "<") return order < 0;
      return order <= 0;
    }
    const a = numberValue(left);
    const b = numberValue(right);
    if (node.operator === "+") return finite(a + b);
    if (node.operator === "-") return finite(a - b);
    if (node.operator === "*") return finite(a * b);
    if (b === 0) throw fault("#DIV/0!", "除数不能为零");
    return finite(a / b);
  }
  if (node.name === "IF") {
    const condition = evaluate(node.args[0]!, resolve, step);
    return evaluate(booleanValue(condition) ? node.args[1]! : node.args[2]!, resolve, step);
  }
  const values = node.args.map((arg) => evaluate(arg, resolve, step));
  if (node.name === "AND") return values.every(booleanValue);
  if (node.name === "OR") return values.some(booleanValue);
  if (node.name === "NOT") return !booleanValue(values[0]!);
  if (node.name === "CONCAT") return values.map(String).join("");
  if (node.name === "LEN") return [...String(values[0]!)].length;
  if (node.name === "UPPER") return String(values[0]!).toLocaleUpperCase();
  if (node.name === "LOWER") return String(values[0]!).toLocaleLowerCase();
  const digits = values.length === 2 ? numberValue(values[1]!) : 0;
  if (!Number.isInteger(digits) || digits < -12 || digits > 12) {
    throw fault("#TYPE!", "ROUND 位数无效");
  }
  const factor = 10 ** digits;
  return finite(Math.round(numberValue(values[0]!) * factor) / factor);
}

function inferResultType(
  node: Node,
  columnTypes: ReadonlyMap<string, BaseFormulaResultType>
): BaseFormulaResultType {
  if (node.kind === "literal") {
    if (typeof node.value === "number") return "number";
    if (typeof node.value === "boolean") return "boolean";
    return "text";
  }
  if (node.kind === "ref") return columnTypes.get(node.columnId) ?? "text";
  if (node.kind === "unary") return "number";
  if (node.kind === "binary") {
    return ["=", "==", "!=", "<>", ">", ">=", "<", "<="].includes(node.operator)
      ? "boolean"
      : "number";
  }
  if (["AND", "OR", "NOT"].includes(node.name)) return "boolean";
  if (["CONCAT", "UPPER", "LOWER"].includes(node.name)) return "text";
  if (["LEN", "ROUND"].includes(node.name)) return "number";
  const branchTypes = [
    inferResultType(node.args[1]!, columnTypes),
    inferResultType(node.args[2]!, columnTypes),
  ];
  return branchTypes[0] === branchTypes[1] ? branchTypes[0]! : "text";
}

function resultTypeOf(column: BaseColumn): BaseFormulaResultType {
  if (column.type === "number") return "number";
  if (column.type === "checkbox") return "boolean";
  if (column.type === "formula") return column.formula?.resultType ?? "text";
  return "text";
}

function collectDependencies(node: Node, result = new Set<string>()) {
  if (node.kind === "ref") result.add(node.columnId);
  if (node.kind === "unary") collectDependencies(node.value, result);
  if (node.kind === "binary") {
    collectDependencies(node.left, result);
    collectDependencies(node.right, result);
  }
  if (node.kind === "call") node.args.forEach((arg) => collectDependencies(arg, result));
  return result;
}

function assertAstDepth(node: Node, depth = 1) {
  if (depth > BASE_FORMULA_DEPTH_LIMIT) {
    throw fault("#LIMIT!", "公式 AST 深度超限");
  }
  if (node.kind === "unary") assertAstDepth(node.value, depth + 1);
  if (node.kind === "binary") {
    assertAstDepth(node.left, depth + 1);
    assertAstDepth(node.right, depth + 1);
  }
  if (node.kind === "call") {
    node.args.forEach((arg) => assertAstDepth(arg, depth + 1));
  }
}

function numberValue(value: Scalar) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw fault("#TYPE!", "需要数字");
  }
  return value;
}

function booleanValue(value: Scalar) {
  if (typeof value !== "boolean") throw fault("#TYPE!", "需要布尔值");
  return value;
}

function finite(value: number) {
  if (!Number.isFinite(value)) throw fault("#TYPE!", "数字越界");
  return Object.is(value, -0) ? 0 : value;
}

function compareScalar(left: Scalar, right: Scalar) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function isFormulaError(value: string): value is BaseFormulaErrorCode {
  return ["#REF!", "#DIV/0!", "#TYPE!", "#ERROR!", "#LIMIT!"].includes(value);
}

function parseFailure(message: string, code: BaseFormulaErrorCode = "#ERROR!") {
  return { ok: false as const, error: code, message };
}

function fault(code: BaseFormulaErrorCode, message: string) {
  return Object.assign(new Error(message), { code });
}

function formulaError(cause: unknown) {
  if (cause && typeof cause === "object" && "code" in cause &&
    typeof cause.code === "string" && isFormulaError(cause.code)) {
    return { code: cause.code, message: cause instanceof Error ? cause.message : cause.code };
  }
  return { code: "#ERROR!" as const, message: cause instanceof Error ? cause.message : "公式无效" };
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
