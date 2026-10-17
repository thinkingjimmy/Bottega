/**
 * [INPUT]: Captured ordinary CSS/JSON/TypeScript sources and the locked from-code/craft extraction method.
 * [OUTPUT]: Exact token/themes, aliases, font/component inventory, source baseline and every unsupported item.
 * [POS]: Pure source interpretation; it neither executes source modules nor invents replacement values.
 */
import postcss, { type Declaration } from "postcss";
import valueParser from "postcss-value-parser";
import ts from "typescript";
import { posix } from "node:path";
import { designDigest, DesignDocumentError } from "../documents/model";
import { designSystemSchema, systemName, type DesignSystem, type SystemToken, type SystemAlias, type SystemComponent, type SystemUnsynced } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { validTokenValue } from "@ai-chat/cloud-protocol/artifacts/design/system/tokens";
import type { CapturedSource, CapturedSources } from "./sources";

type Definition = { name: string; value: string; kind: SystemToken["kind"] | null; theme: string; usage: string; source: CapturedSource; key: string };
const normalizedName = (value: string) => value.replace(/^--/, "").replaceAll("\\.", ".").replaceAll("/", "-");
const jsonText = (value: unknown): string | null => typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
function kindFor(name: string, value: string, type = ""): SystemToken["kind"] | null {
  if (/color/i.test(type) || /^(?:#|(?:rgb|hsl|oklch|oklab|lab|lch|color)\()/i.test(value)) return "color";
  if (/(?:font.?family|font.?stack|families)/i.test(name + type)) return "font-family";
  if (/line.?height/i.test(name + type)) return "line-height";
  if (/font.?weight/i.test(name + type)) return "font-weight";
  if (/letter.?spacing|tracking/i.test(name + type)) return "letter-spacing";
  if (/font.?size|(?:^|[._-])text(?:$|[._-])/i.test(name + type)) return "font-size";
  if (/radius|rounded/i.test(name + type)) return "radius";
  if (/shadow/i.test(name + type)) return "shadow";
  if (/space|spacing|gap|padding|(?:^|[._-])pad(?:$|[._-])/i.test(name + type)) return "spacing";
  if (/color|background|foreground|surface|ink|accent|primary|secondary|destructive|brand|(?:^|[-_.])(?:bg|border|ring|muted)(?:$|[-_.])/i.test(name + type)) return "color";
  return null;
}
export function cssDeclarationThemes(declaration: Declaration) {
  let parent: postcss.Container | postcss.Document | undefined = declaration.parent;
  const themes = new Set<string>(); let global = false, scoped = false, darkMedia = false;
  while (parent) {
    if (parent.type === "atrule") {
      const rule = parent as postcss.AtRule;
      if (rule.name === "theme") { global = true; themes.add("light"); }
      if (rule.name === "media" && /prefers-color-scheme\s*:\s*dark/i.test(rule.params)) darkMedia = true;
    }
    if (parent.type === "rule") {
      for (const selector of (parent as postcss.Rule).selectors.map(value => value.trim())) {
        const custom = /^(?:html|:root)?\[data-theme\s*=\s*["']?([A-Za-z0-9_.-]+)["']?\]$/.exec(selector)?.[1];
        if (custom) { global = true; themes.add(custom); }
        else if (/^(?:html)?\.dark$/.test(selector)) { global = true; themes.add("dark"); }
        else if (/^(?::root|(?:html)?\.light)$/i.test(selector)) { global = true; themes.add("light"); }
        else scoped = true;
      }
    }
    parent = parent.parent;
  }
  return global && !scoped ? darkMedia ? ["dark"] : [...themes] : [];
}
export const cssDeclarationTheme = (declaration: Declaration) => cssDeclarationThemes(declaration)[0] ?? null;
function sourceUsage(source: CapturedSource, key: string, line: number, comment?: string) {
  return comment?.trim().slice(0, 1000) || `Defined in ${source.record.path}:${line} (${key}).`;
}
export function extractCapturedSystem(capture: CapturedSources): DesignSystem {
  const definitions: Definition[] = [], unsynced: SystemUnsynced[] = [...capture.unsynced], components: SystemComponent[] = [], fonts: DesignSystem["tokens"]["fonts"] = [];
  const themes = new Map<string, { id: string; name: string }>();
  const omit = (source: CapturedSource, kind: SystemUnsynced["kind"], name: string, reason: string) => {
    if (unsynced.length >= 1024) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete extraction omission list exceeds its budget");
    unsynced.push({ path: source.record.path, kind, ...(name ? { name: name.slice(0, 240) } : {}), reason: reason.slice(0, 500) });
  };
  const add = (definition: Definition) => {
    if (!systemName.safeParse(definition.name).success || !systemName.max(32).safeParse(definition.theme).success) { omit(definition.source, "token", definition.name, "Source name or theme exceeds the closed token contract"); return; }
    if (!definition.kind) { omit(definition.source, "token", definition.name, "Could not classify this exact source value; no replacement was inferred"); return; }
    if (definition.key.length > 240) { omit(definition.source, "token", definition.name, "Exact source locator exceeds its bounded contract"); return; }
    if (!definition.value || definition.value.length > 1000) { omit(definition.source, "token", definition.name, "Source value exceeds the token budget"); return; }
    const duplicate = definitions.find(value => value.name === definition.name && value.theme === definition.theme);
    if (duplicate) {
      if (duplicate.value !== definition.value || duplicate.kind !== definition.kind) throw new DesignDocumentError("INVALID_DOCUMENT", `Ambiguous source definitions for ${definition.name} (${definition.theme})`, [{ file: definition.source.record.path, message: `Conflicts with ${duplicate.source.record.path}:${duplicate.key}` }]);
      omit(definition.source, "token", definition.name, `Repeated identical definition; canonical source is ${duplicate.source.record.path}:${duplicate.key}`); return;
    }
    if (definitions.length >= 1024) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete source token inventory exceeds its budget");
    themes.set(definition.theme, { id: definition.theme, name: definition.theme === "light" ? "Light" : definition.theme === "dark" ? "Dark" : definition.theme });
    definitions.push(definition);
  };
  const addFont = (source: CapturedSource, family: string, file: string, weight: string, style: string, key: string) => {
    const target = posix.normalize(posix.join(posix.dirname(source.record.path), file)), resource = capture.files.find(item => item.record.path === target);
    if (!resource || !/\.(?:woff2?|ttf|otf)$/i.test(target)) { omit(source, "font", family, `Font bytes were not captured: ${file.slice(0, 200)}`); return; }
    const header = resource.data.subarray(0, 4).toString("latin1"), binaryHeader = resource.data.length >= 4 ? resource.data.readUInt32BE(0) : 0;
    if (resource.data.length > 1024 * 1024 || !["wOFF", "wOF2", "OTTO", "ttcf"].includes(header) && binaryHeader !== 0x00010000) { omit(resource, "font", family, "Font is too large or its byte signature is invalid"); return; }
    if (!family || family.length > 200 || /[;{}<>\r\n]/.test(family) || !["normal", "italic", "oblique"].includes(style) ||
      !/^(?:(?:[1-9]\d{0,2}|1000)(?: (?:[1-9]\d{0,2}|1000))?|normal|bold)$/.test(weight)) { omit(source, "font", family, "Computed or unsupported font descriptors were not inferred"); return; }
    const font = { family, file: resource.record.capturedPath, sourceId: resource.record.id, definitionSourceId: source.record.id, sourceKey: key.slice(0, 240), weight, style: style as "normal" | "italic" | "oblique" };
    if (!fonts.some(item => item.family === family && item.file === font.file && item.weight === weight && item.style === style)) fonts.push(font);
  };
  const parseJson = (source: CapturedSource, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const object = value as { type?: { fonts?: unknown }; fonts?: unknown }, declarations = object.type?.fonts ?? object.fonts;
      if (Array.isArray(declarations)) for (const [index, item] of declarations.entries()) {
        if (!item || typeof item !== "object") continue;
        const font = item as { family?: unknown; file?: unknown; weight?: unknown; style?: unknown };
        if (typeof font.family === "string" && typeof font.file === "string") addFont(source, font.family, font.file,
          typeof font.weight === "number" || typeof font.weight === "string" ? String(font.weight) : "400", typeof font.style === "string" ? font.style : "normal", `json:/${object.type ? "type/" : ""}fonts/${index}`);
        else omit(source, "font", "", "JSON font has no literal family/file descriptors");
      }
    }
    const walk = (node: unknown, path: string[], theme = "light", type = "", usage = "", depth = 0): void => {
      if (depth > 16) { omit(source, "token", path.join("."), "JSON token nesting exceeds 16 levels"); return; }
      if (node && typeof node === "object" && !Array.isArray(node)) {
        const object = node as Record<string, unknown>;
        const nodeType = typeof object.$type === "string" ? object.$type : type;
        const description = typeof object.$description === "string" ? object.$description : typeof object.usage === "string" ? object.usage : usage;
        if ("$value" in object) { const literal = jsonText(object.$value);
          if (literal !== null) add({ name: normalizedName(path.join("-")), value: literal, kind: kindFor(path.join("-"), literal, nodeType), theme,
            usage: description || sourceUsage(source, path.join("."), 1), source, key: path.join(".") + ".$value" });
          else omit(source, "token", path.join("."), "Composite or computed JSON value was retained as source data"); return; }
        if (typeof object.name === "string" && "value" in object) {
          const name = normalizedName(object.name), values = object.value;
          const addValue = (item: unknown, itemTheme: string) => { const literal = jsonText(item);
            if (literal !== null) add({ name, value: literal, kind: kindFor(path.join("-") + "-" + name, literal, nodeType), theme: itemTheme,
              usage: description || sourceUsage(source, name, 1), source, key: `${path.join(".")}.${object.name}` });
            else omit(source, "token", name, "Composite token value is not a supported literal"); };
          if (values && typeof values === "object" && !Array.isArray(values)) for (const [itemTheme, item] of Object.entries(values)) addValue(item, itemTheme);
          else addValue(values, theme); return;
        }
        if (typeof object.name === "string" && "kind" in object && object.values && typeof object.values === "object") {
          for (const [itemTheme, item] of Object.entries(object.values)) { const literal = jsonText(item);
            if (literal !== null) add({ name: normalizedName(object.name), value: literal, kind: kindFor(object.name, literal, String(object.kind)), theme: itemTheme,
              usage: description || sourceUsage(source, object.name, 1), source, key: `${path.join(".")}.${object.name}` }); } return;
        }
        for (const [key, item] of Object.entries(object)) {
          if (key.startsWith("$") || ["meta", "source", "version", "schemaVersion", "name", "themes", "fonts", "usage", "sample", "description"].includes(key)) continue;
          if (key === "light" || key === "dark") walk(item, path, key, nodeType, description, depth + 1);
          else if (key === "tokens") walk(item, path, theme, nodeType, description, depth + 1);
          else walk(item, [...path, key], theme, nodeType, description, depth + 1);
        } return;
      }
      if (Array.isArray(node)) { for (const [index, item] of node.entries()) walk(item, [...path, String(index)], theme, type, usage, depth + 1); return; }
      const literal = jsonText(node);
      if (literal !== null && path.length) add({ name: normalizedName(path.join("-")), value: literal, kind: kindFor(path.join("-"), literal, type), theme,
        usage: usage || sourceUsage(source, path.join("."), 1), source, key: path.join(".") });
    };
    walk(value, []);
  };
  for (const source of capture.files) {
    const path = source.record.path;
    if (!/\.(?:css|json|[cm]?js|jsx|tsx?)$/i.test(path)) {
      if (/\.(?:woff2?|ttf|otf)$/i.test(path)) { /* Listed after reading real @font-face declarations. */ }
      else if (!/\.mdx?$/i.test(path)) omit(source, "asset", "", "Original resource captured; no usage guide was supplied");
      continue;
    }
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(source.data); }
    catch { omit(source, "source", "", "Source is not valid UTF-8; bytes remain captured"); continue; }
    if (/\.css$/i.test(path)) {
      try {
        const ast = postcss.parse(text, { from: path });
        ast.walkDecls(declaration => {
          if (!declaration.prop.startsWith("--")) return;
          const declaredThemes = cssDeclarationThemes(declaration);
          if (!declaredThemes.length) { omit(source, "token", declaration.prop, "Scoped declaration is retained in source; editing a system token cannot replace that local scope"); return; }
          const name = normalizedName(declaration.prop), comment = declaration.prev()?.type === "comment" ? (declaration.prev() as postcss.Comment).text : undefined;
          for (const theme of declaredThemes) add({ name, value: declaration.value, kind: kindFor(name, declaration.value), theme,
            usage: sourceUsage(source, declaration.prop, declaration.source?.start?.line ?? 1, comment), source, key: `${theme}:${declaration.prop}:${declaration.source?.start?.line ?? 1}` });
        });
        ast.walkAtRules("font-face", rule => {
          const entries = new Map<string, string>(); rule.walkDecls(declaration => { entries.set(declaration.prop.toLowerCase(), declaration.value); });
          const family = entries.get("font-family")?.replace(/^['"]|['"]$/g, "");
          if (!family) { omit(source, "font", "", "Font-face has no literal family"); return; }
          const refs: string[] = []; valueParser(entries.get("src") ?? "").walk(node => { if (node.type === "function" && node.value === "url") { const first = node.nodes[0]; if (first && (first.type === "word" || first.type === "string")) refs.push(first.value); } });
          for (const ref of refs) {
            const style = entries.get("font-style") ?? "normal", weight = entries.get("font-weight") ?? "400";
            addFont(source, family, ref, weight, style, `css:@font-face:${rule.source?.start?.line ?? 1}`);
          }
        });
      } catch (error) { if (error instanceof DesignDocumentError) throw error; omit(source, "source", "", "CSS syntax could not be parsed; original bytes were retained"); }
    } else if (/\.json$/i.test(path)) {
      try { parseJson(source, JSON.parse(text)); }
      catch (error) { if (error instanceof DesignDocumentError) throw error; omit(source, "source", "", "JSON syntax could not be parsed; original bytes were retained"); }
    } else {
      const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const literal = (node: ts.Expression, keys: string[] = [], depth = 0): unknown => {
        if (depth > 16) { omit(source, "token", keys.join("."), "Literal source nesting exceeds 16 levels"); return undefined; }
        if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression, keys, depth + 1);
        if (ts.isStringLiteralLike(node)) return node.text;
        if (ts.isNumericLiteral(node)) return Number(node.text);
        if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
        if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
        if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
        if (node.kind === ts.SyntaxKind.NullKeyword) return null;
        if (ts.isArrayLiteralExpression(node)) return node.elements.map((item, index) => literal(item, [...keys, String(index)], depth + 1));
        if (ts.isObjectLiteralExpression(node)) {
          const object: Record<string, unknown> = Object.create(null);
          for (const property of node.properties) {
            if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) && !ts.isStringLiteralLike(property.name) && !ts.isNumericLiteral(property.name)) {
              omit(source, "token", keys.join("."), "Computed/spread JavaScript token data was not executed or inferred"); continue;
            }
            object[property.name.text] = literal(property.initializer, [...keys, property.name.text], depth + 1);
          } return object;
        }
        omit(source, "token", keys.join("."), "JavaScript expression was not executed or inferred"); return undefined;
      };
      const exported = (node: ts.Node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
      const addComponent = (name: string, exportName = name) => {
        if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) return;
        if (/(?:Context|Provider)$/.test(name)) { omit(source, "component", name, "Context/provider is an inventory item, not a standalone preview component"); return; }
        const previous = components.find(value => value.name === name);
        if (previous) { omit(source, "component", name, `Duplicate public name; canonical entry is ${previous.entry}`); return; }
        if (components.length >= 128) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete component inventory exceeds its budget");
        components.push({ name, exportName, sourceId: source.record.id, entry: path, sourceDigest: source.record.digest,
          closureDigest: designDigest(JSON.stringify(capture.files.map(file => [file.record.capturedPath, file.record.digest]))),
          closure: capture.files.map(file => file.record.capturedPath), mode: "static", reason: "Source was inventoried; this component has not been mounted in the controlled renderer" });
        omit(source, "component", name, "Not mounted: select this actual export for controlled local compilation");
      };
      for (const node of ast.statements) {
        if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && exported(node) && node.name) addComponent(node.name.text, ts.getModifiers(node)?.some(value => value.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : node.name.text);
        if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          if (/theme|token|palette|color|spacing|radius|typography|font/i.test(declaration.name.text)) {
            const data = literal(declaration.initializer, [declaration.name.text]); if (data !== undefined) parseJson(source, { [declaration.name.text]: data });
          } else if (exported(node) && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer) || ts.isCallExpression(declaration.initializer))) addComponent(declaration.name.text);
        }
        if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) for (const entry of node.exportClause.elements) if (!entry.isTypeOnly && !node.isTypeOnly) addComponent(entry.name.text);
        if (ts.isExportAssignment(node)) {
          if (ts.isIdentifier(node.expression)) addComponent(node.expression.text, "default");
          else if (ts.isObjectLiteralExpression(node.expression)) parseJson(source, literal(node.expression));
          else omit(source, "component", "default", "Unnamed default export cannot be assigned a source component identity without a user choice");
        }
      }
    }
  }
  if (themes.size > 8) throw new DesignDocumentError("BUDGET_EXCEEDED", "Source defines more than eight themes");
  if (!themes.size) themes.set("light", { id: "light", name: "Light" });
  const tokens = new Map<string, SystemToken>(), aliases: SystemAlias[] = [];
  const referenceName = (value: string, json = false) => {
    const name = normalizedName(value); return json && !definitions.some(definition => definition.name === name) ? name.replaceAll(".", "-") : name;
  };
  const resolveLength = (definition: Definition, seen: Set<string> = new Set()): string | null => {
    const match = /^(?:var\(--([A-Za-z0-9_.\\-]+)\)|\{([A-Za-z0-9_.-]+)\})$/.exec(definition.value);
    if (!match) return definition.value;
    const name = referenceName(match[1] ?? match[2]!, Boolean(match[2])); if (seen.has(name) || seen.size >= 16) return null; seen.add(name);
    const target = definitions.find(value => value.name === name && value.theme === definition.theme) ?? definitions.find(value => value.name === name && value.theme === "light");
    return target ? resolveLength(target, seen) : null;
  };
  for (const definition of definitions) {
    const match = /^(?:var\(--([A-Za-z0-9_.\\-]+)\)|\{([A-Za-z0-9_.-]+)\})$/.exec(definition.value), reference = match?.[1] ?? match?.[2];
    if (reference && definition.kind === "color") {
      aliases.push({ name: definition.name, target: referenceName(reference, Boolean(match?.[2])), theme: definition.theme, usage: definition.usage,
        sourceId: definition.source.record.id, sourceKey: definition.key }); continue;
    }
    const value = reference ? resolveLength(definition) : definition.value;
    if (value === null) { omit(definition.source, "token", definition.name, "Local value dependency is missing or cyclic; no value was guessed"); continue; }
    const token = tokens.get(definition.name);
    if (token && token.kind !== definition.kind) throw new DesignDocumentError("INVALID_DOCUMENT", `Token family differs across themes: ${definition.name}`);
    if (token) { token.values[definition.theme] = value; token.origins[definition.theme] = { sourceId: definition.source.record.id, sourceKey: definition.key }; }
    else tokens.set(definition.name, { name: definition.name, kind: definition.kind!, values: { [definition.theme]: value }, usage: definition.usage,
      sourceId: definition.source.record.id, sourceKey: definition.key,
      origins: { [definition.theme]: { sourceId: definition.source.record.id, sourceKey: definition.key } } });
    if (!validTokenValue(definition.kind!, value)) omit(definition.source, "token", definition.name, "Exact source value preserved; generated CSS cannot safely represent it. Any improved value requires an explicit user override.");
  }
  for (const font of capture.files.filter(file => /\.(?:woff2?|ttf|otf)$/i.test(file.record.path))) if (!fonts.some(value => value.sourceId === font.record.id)) omit(font, "font", "", "Captured font has no usable source font-face descriptor");
  const baseline = { tokens: [...tokens.values()], aliases, components };
  if (tokens.size > 512 || aliases.length > 512 || fonts.length > 32) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete system token, alias or font inventory exceeds its bounded contract");
  const orderedThemes = [...themes.values()].sort((a, b) => a.id === "light" ? -1 : b.id === "light" ? 1 : 0);
  return designSystemSchema.parse({ tokens: { schemaVersion: 1, themes: orderedThemes, tokens: baseline.tokens, fonts },
    aliases: { schemaVersion: 1, aliases }, sources: { schemaVersion: 1, files: capture.files.map(file => file.record), baseline: structuredClone(baseline), unsynced },
    components: { schemaVersion: 1, components } });
}
export const extractionDigest = (system: DesignSystem) => designDigest(JSON.stringify(system));
