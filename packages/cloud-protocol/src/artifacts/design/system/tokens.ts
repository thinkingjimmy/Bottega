/**
 * [INPUT]: Versioned tokens and aliases; all values remain exact source data.
 * [OUTPUT]: Safe generated CSS, per-theme alias resolution and bounded unsupported-value diagnostics.
 * [POS]: One-way token projection; generated CSS is never a second source of values.
 */
import type { DesignSystem, SystemToken } from "./model";

export function validTokenValue(kind: SystemToken["kind"], value: string) {
  if (!value || value.length > 1000 || /[;{}<>\\]/.test(value) || Array.from(value).some(character => character.charCodeAt(0) < 32) || /(?:url|expression|var)\s*\(/i.test(value)) return false;
  if (kind === "color") return /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ||
    /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([a-z\d.%+\-\s/,]+\)$/i.test(value);
  if (kind === "font-family") return value.length <= 200 && !/[()]/.test(value) &&
    (value.match(/"/g)?.length ?? 0) % 2 === 0 && (value.match(/'/g)?.length ?? 0) % 2 === 0;
  if (kind === "font-weight") return /^(?:[1-9]\d{0,2}|1000)(?: (?:[1-9]\d{0,2}|1000))?$/.test(value) || /^(?:normal|bold)$/.test(value);
  if (kind === "shadow") return value.length <= 400 && /^[A-Za-z\d #%(),./+_-]+$/.test(value) &&
    (value.match(/\(/g)?.length ?? 0) === (value.match(/\)/g)?.length ?? 0);
  if (kind === "line-height" && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return Number(value) < 10;
  return /^(?:-?\d+(?:\.\d+)?|-?\.\d+)(?:px|rem|em|%|ch|ex|vw|vh|vmin|vmax)?$/.test(value);
}
export const cssTokenName = (name: string) => name.replaceAll(".", "\\.");
export function resolvedSystemToken(system: DesignSystem, name: string, theme: string): { token: SystemToken; value: string } | null {
  const first = system.tokens.themes[0]!.id, seen = new Set<string>();
  let current = name;
  for (let depth = 0; depth <= 16; depth++) {
    if (seen.has(current)) return null; seen.add(current);
    const token = system.tokens.tokens.find(value => value.name === current);
    const alias = system.aliases.aliases.find(value => value.name === current && value.theme === theme) ??
      (token?.values[theme] === undefined ? system.aliases.aliases.find(value => value.name === current && value.theme === first) : undefined);
    if (alias) { current = alias.target; continue; }
    const value = token?.values[theme] ?? token?.values[first];
    return token && value !== undefined ? { token, value } : null;
  }
  return null;
}
export const resolvedSystemValue = (system: DesignSystem, name: string, theme: string) => resolvedSystemToken(system, name, theme)?.value ?? null;
export function generatedSystemCss(system: DesignSystem, title: string) {
  const lines = [`/* ${title.replace(/[*/\r\n<>]/g, "").slice(0, 250)} — generated from tokens.json and aliases.json */`];
  for (const [index, theme] of system.tokens.themes.entries()) {
    lines.push(`${index ? "" : ":root, "}[data-theme="${theme.id}"] {`);
    const names = new Set([...system.tokens.tokens.map(token => token.name), ...system.aliases.aliases.map(alias => alias.name)]);
    for (const name of names) {
      const token = system.tokens.tokens.find(token => token.name === name);
      const alias = system.aliases.aliases.find(value => value.name === name && value.theme === theme.id) ??
        (token?.values[theme.id] === undefined ? system.aliases.aliases.find(value => value.name === name && value.theme === system.tokens.themes[0]!.id) : undefined);
      if (alias) {
        const target = resolvedSystemToken(system, alias.target, theme.id);
        if (target && validTokenValue(target.token.kind, target.value)) lines.push(`  --${cssTokenName(alias.name)}: var(--${cssTokenName(alias.target)});`);
      } else {
        const value = token?.values[theme.id] ?? token?.values[system.tokens.themes[0]!.id];
        if (token && value !== undefined && validTokenValue(token.kind, value)) lines.push(`  --${cssTokenName(token.name)}: ${value};`);
      }
    }
    lines.push("}");
  }
  for (const font of system.tokens.fonts) {
    const family = font.family.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    lines.push(`@font-face { font-family: "${family}"; src: url("${font.file}"); font-weight: ${font.weight}; font-style: ${font.style}; font-display: swap; }`);
  }
  return lines.join("\n") + "\n";
}
