/**
 * [INPUT]: Closed design-system data, exact source digests and archive file names.
 * [OUTPUT]: Pure bounded structural errors and advisory source-value limitations.
 * [POS]: Cross-platform system checking; no I/O, registration or guessed replacement values.
 */
import { designSystemSchema, type DesignSystem } from "./model";
import { resolvedSystemValue, validTokenValue } from "./tokens";
export type SystemIssue = { file: string; message: string };
export function inspectDesignSystem(raw: unknown, files?: ReadonlySet<string>) {
  const issues: SystemIssue[] = [], advisories: SystemIssue[] = [];
  const issue = (file: string, message: string) => { if (issues.length < 32) issues.push({ file, message: message.slice(0, 500) }); };
  const advisory = (file: string, message: string) => { if (advisories.length < 32) advisories.push({ file, message: message.slice(0, 500) }); };
  const parsed = designSystemSchema.safeParse(raw);
  if (!parsed.success) {
    for (const value of parsed.error.issues) issue(`${String(value.path[0] ?? "system")}.json`, `${value.path.map(String).join(".")}: ${value.message}`);
    return { system: null, issues, advisories };
  }
  const system = parsed.data, themes = new Set(system.tokens.themes.map(theme => theme.id));
  if (themes.size !== system.tokens.themes.length) issue("tokens.json", "Theme IDs must be unique");
  const tokens = new Set(system.tokens.tokens.map(token => token.name));
  if (tokens.size !== system.tokens.tokens.length) issue("tokens.json", "Token names must be unique");
  const sourceIds = new Set(system.sources.files.map(source => source.id));
  if (sourceIds.size !== system.sources.files.length || new Set(system.sources.files.map(source => source.capturedPath)).size !== sourceIds.size) issue("sources.json", "Source IDs and captured paths must be unique");
  for (const source of system.sources.files) { if (files && !files.has(source.capturedPath)) issue("sources.json", `Missing captured source: ${source.capturedPath}`); }
  const origin = (value: { sourceId: string }, file: string) => { if (!sourceIds.has(value.sourceId)) issue(file, `Missing source: ${value.sourceId}`); };
  for (const token of system.tokens.tokens) {
    origin(token, "tokens.json");
    if (!Object.keys(token.values).length) issue("tokens.json", `Token ${token.name} has no values`);
    for (const [theme, value] of Object.entries(token.values)) {
      if (!themes.has(theme)) issue("tokens.json", `Token ${token.name} names unknown theme ${theme}`);
      if (!token.origins[theme] || !sourceIds.has(token.origins[theme]!.sourceId)) issue("tokens.json", `Token ${token.name} has no exact source for theme ${theme}`);
      if (!validTokenValue(token.kind, value)) advisory("tokens.json", `${token.name} (${theme}) is preserved exactly; its unsupported value is omitted from generated CSS`);
    }
    if (!token.usage.trim()) advisory("tokens.json", `${token.name} has no usage guidance`);
  }
  const aliasKeys = new Set<string>();
  for (const alias of system.aliases.aliases) {
    origin(alias, "aliases.json"); const key = `${alias.name}:${alias.theme}`;
    if (aliasKeys.has(key)) issue("aliases.json", `Duplicate alias ${key}`); aliasKeys.add(key);
    if (system.tokens.tokens.some(token => token.name === alias.name && token.values[alias.theme] !== undefined)) issue("aliases.json", `Token and alias duplicate ${alias.name} in theme ${alias.theme}`);
    if (!themes.has(alias.theme)) issue("aliases.json", `Alias ${alias.name} names an unknown theme`);
    if (resolvedSystemValue(system, alias.name, alias.theme) === null) issue("aliases.json", `Alias ${alias.name} is missing, cyclic or exceeds 16 links`);
  }
  for (const font of system.tokens.fonts) {
    origin(font, "tokens.json");
    if (!sourceIds.has(font.definitionSourceId)) issue("tokens.json", `Missing font descriptor source: ${font.family}`);
    if (!/^(?:(?:[1-9]\d{0,2}|1000)(?: (?:[1-9]\d{0,2}|1000))?|normal|bold)$/.test(font.weight) || /[;{}<>\r\n]/.test(font.family)) issue("tokens.json", `Invalid font descriptor: ${font.family}`);
    if (files && !files.has(font.file)) issue("tokens.json", `Missing font file: ${font.file}`);
  }
  const componentNames = new Set<string>();
  for (const component of system.components.components) {
    origin(component, "components.json");
    if (componentNames.has(component.name)) issue("components.json", `Duplicate component ${component.name}`); componentNames.add(component.name);
    if (files && component.closure.some(path => !files.has(path))) issue("components.json", `Incomplete captured closure: ${component.name}`);
    if (component.mode === "mounted" && (!component.evidence || !component.bundle || !component.bundleDigest || !component.preview)) issue("components.json", `Mounted component ${component.name} has no render evidence`);
    for (const path of [component.bundle, component.preview, component.evidence?.file]) { if (path && files && !files.has(path)) issue("components.json", `Missing component file: ${path}`); }
  }
  return { system: system as DesignSystem, issues, advisories };
}
