/**
 * [INPUT]: Prior source baseline, current user values and a newly captured source inventory.
 * [OUTPUT]: Deterministic three-way differences and explicit conflict/deletion choices.
 * [POS]: Shared update semantics; callers supply their own current-source digest and CAS.
 */
import type { DesignSystem, SystemChange, SystemEntry } from "./model";
const keyFor = (family: SystemChange["family"], value: SystemEntry) => `${family}:${value.name}${family === "alias" ? ":" + (value as { theme: string }).theme : ""}`;
function semantic(value: SystemEntry | null) {
  if (!value) return "null";
  if ("kind" in value) return JSON.stringify([value.name, value.kind, Object.entries(value.values).sort(), value.usage]);
  if ("target" in value) return JSON.stringify([value.name, value.target, value.theme, value.usage]);
  return JSON.stringify([value.name, value.exportName, value.entry, value.sourceDigest, value.closureDigest]);
}
export function designSystemChanges(current: DesignSystem, incoming: DesignSystem): SystemChange[] {
  const result: SystemChange[] = [];
  for (const family of ["token", "alias", "component"] as const) {
    const name = family === "token" ? "tokens" : family === "alias" ? "aliases" : "components";
    const base = new Map(current.sources.baseline[name].map(value => [keyFor(family, value), value as SystemEntry]));
    const localValues = family === "token" ? current.tokens.tokens : family === "alias" ? current.aliases.aliases : current.components.components;
    const nextValues = family === "token" ? incoming.tokens.tokens : family === "alias" ? incoming.aliases.aliases : incoming.components.components;
    const local = new Map(localValues.map(value => [keyFor(family, value), value as SystemEntry]));
    const next = new Map(nextValues.map(value => [keyFor(family, value), value as SystemEntry]));
    for (const key of [...new Set([...base.keys(), ...next.keys()])].sort()) {
      const before = base.get(key) ?? null, after = next.get(key) ?? null;
      const alias = family === "alias" ? before ?? after : null;
      const equivalentToken = alias && "theme" in alias ? current.tokens.tokens.find(token => token.name === alias.name && token.values[alias.theme] !== undefined) : undefined;
      const now = local.get(key) ?? equivalentToken ?? null;
      if (semantic(before) === semantic(after)) continue;
      if (semantic(now) === semantic(after)) continue;
      const conflicted = semantic(before) !== semantic(now);
      result.push({ key, family, kind: conflicted ? "conflict" : !after ? "removed" : !before ? "added" : "changed",
        base: before, current: now, incoming: after, requiresDecision: conflicted || !after });
    }
  }
  return result;
}
export function mergeDesignSystem(current: DesignSystem, incoming: DesignSystem, decisions: Record<string, "keep" | "source" | "delete">) {
  const changes = designSystemChanges(current, incoming), validKeys = new Set(changes.map(change => change.key));
  if (Object.keys(decisions).some(key => !validKeys.has(key))) throw new Error("Update decisions do not match the current source difference");
  for (const change of changes) {
    if (change.requiresDecision && !decisions[change.key]) throw new Error(`Choose how to resolve ${change.key}. Your values are retained.`);
    if (!change.incoming && decisions[change.key] === "source") throw new Error(`Source ${change.key} was removed. Choose keep or delete.`);
    if (change.incoming && decisions[change.key] === "delete") throw new Error(`Delete is available only for a removed source entry: ${change.key}`);
  }
  const merged = structuredClone(current);
  const removeLiteral = (name: string, theme: string) => {
    merged.tokens.tokens = merged.tokens.tokens.filter(token => {
      if (token.name !== name) return true;
      delete token.values[theme]; delete token.origins[theme]; return Object.keys(token.values).length > 0;
    });
  };
  for (const family of ["token", "alias", "component"] as const) {
    const values = family === "token" ? merged.tokens.tokens : family === "alias" ? merged.aliases.aliases : merged.components.components;
    const map = new Map<string, SystemEntry>(values.map(value => [keyFor(family, value), value]));
    for (const change of changes.filter(change => change.family === family)) {
      const choice = decisions[change.key];
      if (choice === "keep") { const value = map.get(change.key); if (value) map.set(change.key, { ...value, override: true }); continue; }
      if (choice === "delete") { map.delete(change.key); if (family === "alias" && change.base && "theme" in change.base) removeLiteral(change.base.name, change.base.theme); continue; }
      if (change.incoming) {
        map.set(change.key, structuredClone(change.incoming));
        if (family === "alias" && "theme" in change.incoming) removeLiteral(change.incoming.name, change.incoming.theme);
        if (family === "token" && "values" in change.incoming) merged.aliases.aliases = merged.aliases.aliases.filter(alias => alias.name !== change.incoming!.name || !Object.hasOwn((change.incoming as DesignSystem["tokens"]["tokens"][number]).values, alias.theme));
      }
    }
    if (family === "token") merged.tokens.tokens = [...map.values()] as DesignSystem["tokens"]["tokens"];
    else if (family === "alias") merged.aliases.aliases = [...map.values()] as DesignSystem["aliases"]["aliases"];
    else merged.components.components = [...map.values()] as DesignSystem["components"]["components"];
  }
  merged.tokens.themes = [...new Map([...current.tokens.themes, ...incoming.tokens.themes].map(theme => [theme.id, theme])).values()];
  const fontKey = (value: DesignSystem["tokens"]["fonts"][number]) => JSON.stringify([value.family, value.weight, value.style]);
  const fonts = new Map(current.tokens.fonts.map(font => [fontKey(font), font]));
  const fontNotes: DesignSystem["sources"]["unsynced"] = [];
  for (const font of incoming.tokens.fonts) {
    const previous = fonts.get(fontKey(font));
    if (!previous) fonts.set(fontKey(font), font);
    else if (previous.file !== font.file) fontNotes.push({ path: incoming.sources.files.find(source => source.id === font.sourceId)!.path,
      kind: "font", name: font.family, reason: "Existing captured font retained. Source font bytes changed; choose an explicit font edit before replacing this face." });
  }
  merged.tokens.fonts = [...fonts.values()];
  const retained = current.sources.files.filter(source => merged.tokens.tokens.some(value => value.sourceId === source.id || Object.values(value.origins).some(origin => origin.sourceId === source.id)) ||
    merged.tokens.fonts.some(value => value.sourceId === source.id || value.definitionSourceId === source.id) || merged.aliases.aliases.some(value => value.sourceId === source.id) || merged.components.components.some(value => value.sourceId === source.id || value.closure.includes(source.capturedPath)));
  merged.sources = { ...incoming.sources, unsynced: [...incoming.sources.unsynced, ...fontNotes], files: [...new Map([...retained.map(source => ({ ...source, retained: true })), ...incoming.sources.files].map(source => [source.id, source])).values()] };
  return { system: merged, changes };
}
