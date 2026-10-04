/**
 * [INPUT]: User import-map JSON and original virtual document/module URLs.
 * [OUTPUT]: Normalized import maps and a serializable resolver shared by preparation and the opaque runtime.
 * [POS]: Offline module resolution; preserves aliases, scope precedence and blocked mappings without loading code.
 */
type SpecifierMap = [string, string | null][];
export type ArtifactModuleMap = { imports: SpecifierMap; scopes: [string, SpecifierMap][] };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const urlLike = (value: string, base: string): string | null => {
  try { return /^(?:\/|\.\.?\/)/.test(value) ? new URL(value, base).href : new URL(value).href; }
  catch { return null; }
};
export function artifactModuleMap(sources: string[], base: string): ArtifactModuleMap {
  const imports = new Map<string, string | null>(), scopes = new Map<string, Map<string, string | null>>();
  const merge = (target: Map<string, string | null>, input: unknown) => {
    if (!record(input)) return;
    const entries = new Map<string, string | null>();
    for (const [key, value] of Object.entries(input)) {
      if (!key) continue;
      const normalized = urlLike(key, base) ?? key;
      const address = typeof value === "string" ? urlLike(value, base) : null;
      entries.set(normalized, normalized.endsWith("/") && !address?.endsWith("/") ? null : address);
    }
    for (const [key, address] of entries) if (!target.has(key)) target.set(key, address);
  };
  for (const source of sources) {
    let input: unknown;
    try { input = JSON.parse(source); } catch { continue; }
    if (!record(input)) continue;
    if ("imports" in input && !record(input.imports) || "scopes" in input && !record(input.scopes)) continue;
    merge(imports, input.imports);
    if (!record(input.scopes)) continue;
    for (const [key, value] of Object.entries(input.scopes)) {
      if (!record(value)) continue;
      let scope: string;
      try { scope = new URL(key, base).href; } catch { continue; }
      const entries = scopes.get(scope) ?? new Map<string, string | null>();
      merge(entries, value); scopes.set(scope, entries);
    }
  }
  const sorted = <T>(entries: Iterable<[string, T]>) => [...entries].sort(([a], [b]) => b.length - a.length);
  return { imports: sorted(imports), scopes: sorted(scopes).map(([scope, entries]) => [scope, sorted(entries)]) };
}
// This function is serialized into the opaque document; keep its helpers self-contained.
export function resolveArtifactModule(map: ArtifactModuleMap, specifier: string, base: string): string | null {
  let url: URL | undefined;
  try { url = /^(?:\/|\.\.?\/)/.test(specifier) ? new URL(specifier, base) : new URL(specifier); } catch { /* Bare specifier. */ }
  const normalized = url?.href ?? specifier;
  const match = (entries: SpecifierMap): string | null | undefined => {
    for (const [key, address] of entries) {
      if (key === normalized) return address;
      if (!key.endsWith("/") || !normalized.startsWith(key) || url && !["ftp:", "file:", "http:", "https:", "ws:", "wss:"].includes(url.protocol)) continue;
      if (address === null) return null;
      try {
        const result = new URL(normalized.slice(key.length), address).href;
        return result.startsWith(address) ? result : null;
      } catch { return null; }
    }
    return undefined;
  };
  for (const [scope, entries] of map.scopes) {
    if (scope !== base && !(scope.endsWith("/") && base.startsWith(scope))) continue;
    const result = match(entries); if (result !== undefined) return result;
  }
  const result = match(map.imports);
  return result === undefined ? normalized : result;
}
