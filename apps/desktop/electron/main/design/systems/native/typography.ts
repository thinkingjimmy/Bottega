/**
 * [INPUT]: Canonical system tokens and typography references, original editor groups and explicit token mutation port.
 * [OUTPUT]: One original text-style row per reference group and canonical value edits with preserved identities/themes and reconciled source-added tokens.
 * [POS]: System typography adapter; group metadata contains references, never a second set of values.
 */
import { systemName, systemTypographySchema, systemTypeProperties, type DesignSystem, type SystemToken } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { validTokenValue } from "@ai-chat/cloud-protocol/artifacts/design/system/tokens";
type Typography = NonNullable<DesignSystem["tokens"]["typography"]>;
type Property = keyof typeof systemTypeProperties;
export type EditorTypeStyle = { name: string; family: string; usage: string; sample: string; fontSize: string; lineHeight: string; fontWeight: string; letterSpacing: string; fontStyle: "normal" | "italic" | "oblique"; opticalSize: number | null };
export type EditorTypeGroup = { name: string; family: string; note: string; styles: EditorTypeStyle[] };
const defaults = { fontSize: "16px", lineHeight: "1.5", fontWeight: "400", letterSpacing: "0", fontStyle: "normal", opticalSize: null } as const;
function references(system: DesignSystem): Typography {
  const family = system.tokens.tokens.find(token => token.kind === "font-family")?.name ?? "";
  const result: Typography = structuredClone(system.tokens.typography ?? { groups: [{ name: "Typography", family, note: "", styles: [] }] });
  const referenced = new Set(result.groups.flatMap(group => group.styles.flatMap(style => Object.values(style.tokens))));
  const names = new Set(result.groups.flatMap(group => group.styles.map(style => style.name)));
  for (const token of system.tokens.tokens) {
    const property = (Object.entries(systemTypeProperties) as [Property, SystemToken["kind"]][]).find(([, kind]) => token.kind === kind)?.[0];
    if (!property || referenced.has(token.name)) continue;
    let group = result.groups.find(group => group.styles.length < 80);
    if (!group) {
      if (result.groups.length >= 12) throw new Error("Typography exceeds the editor group budget");
      let name = "Typography", suffix = 2;
      while (result.groups.some(group => group.name === name)) name = "Typography " + suffix++;
      group = { name, family, note: "", styles: [] }; result.groups.push(group);
    }
    let name = token.name, suffix = 2;
    while (names.has(name)) { const tail = "-" + suffix++; name = token.name.slice(0, 64 - tail.length) + tail; }
    names.add(name); referenced.add(token.name);
    group.styles.push({ name, family, usage: token.usage, sample: "The quick brown fox jumps over the lazy dog.", tokens: { [property]: token.name } });
  }
  return systemTypographySchema.parse(result);
}
export function projectTypography(system: DesignSystem): EditorTypeGroup[] {
  const first = system.tokens.themes[0]!.id;
  return references(system).groups.map(group => ({ ...group, styles: group.styles.map(style => {
    const values = { ...defaults } as Pick<EditorTypeStyle, Property>;
    for (const [property, name] of Object.entries(style.tokens) as [Property, string][]) {
      const token = system.tokens.tokens.find(token => token.name === name && token.kind === systemTypeProperties[property]);
      if (!token) throw new Error("Typography names a missing or incompatible token: " + name);
      const value = token.values[first] ?? Object.values(token.values)[0]!;
      if (property === "opticalSize") values.opticalSize = Number(value);
      else if (property === "fontStyle") values.fontStyle = value as EditorTypeStyle["fontStyle"];
      else values[property] = value;
    }
    return { name: style.name, family: style.family, usage: style.usage, sample: style.sample, ...values };
  }) }));
}
export function applyTypography(system: DesignSystem, groups: readonly EditorTypeGroup[], families: Readonly<Record<string, string>>, put?: (name: string, kind: SystemToken["kind"], values: Record<string, string>, usage: string) => void): Typography {
  const previous = references(system), projected = projectTypography(system), first = system.tokens.themes[0]!.id, names = new Set<string>();
  const result: Typography = { groups: groups.map(group => ({ name: group.name, family: group.family, note: group.note, styles: group.styles.map(style => {
    if (names.has(style.name)) throw new Error("Typography style names must be unique"); names.add(style.name); systemName.parse(style.name);
    if (style.family && !Object.hasOwn(families, style.family)) throw new Error("Choose an existing typography family");
    const prior = previous.groups.flatMap(group => group.styles).find(value => value.name === style.name), old = projected.flatMap(group => group.styles).find(value => value.name === style.name);
    const tokens = { ...prior?.tokens };
    for (const [property, kind] of Object.entries(systemTypeProperties) as [Property, SystemToken["kind"]][]) {
      const value = style[property];
      if (property === "opticalSize" && value === null) { delete tokens.opticalSize; continue; }
      if (old && value === old[property]) continue;
      const text = String(value); if (!validTokenValue(kind, text)) throw new Error("Unsupported typography value: " + property);
      const name = tokens[property] ?? systemName.parse(style.name + "." + kind), existing = system.tokens.tokens.find(token => token.name === name);
      if (existing && existing.kind !== kind) throw new Error("Typography cannot change a token kind");
      if (existing && !prior?.tokens[property]) throw new Error("Typography token name already exists: " + name);
      tokens[property] = name; put?.(name, kind, { ...existing?.values, [first]: text }, style.usage);
    }
    return { name: style.name, family: style.family, usage: style.usage, sample: style.sample, tokens };
  }) })) };
  for (const group of result.groups) if (group.family && !Object.hasOwn(families, group.family)) throw new Error("Choose an existing group font family");
  return systemTypographySchema.parse(result);
}
