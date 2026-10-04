/**
 * [INPUT]: Depends on Node filesystem/path APIs and emitted renderer asset names and text.
 * [OUTPUT]: Provides systemFontFailures, assertSystemFontEntries, and assertSystemFontAssets for desktop/Web distribution checks.
 * [POS]: Shared build-only font policy; rejects bundled UI fonts and retired font families without entering product renderers.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FONT_FILE = /\.(?:woff2?|ttf|otf)$/i;
const FONT_RESOURCE = /(?:^|\/)(?:maple-cjk-[^/]+\.css|(?:maple-mono|geist)-OFL\.txt)$/i;
const RETIRED_FAMILY = /\b(?:Maple[ _-]*Mono|Geist|ZSFT-443)\b/i;

export function systemFontFailures(entries, readText) {
  const failures = [];
  for (const name of entries) {
    if (FONT_FILE.test(name) || FONT_RESOURCE.test(name)) failures.push(`Bundled UI font resource: ${name}`);
    if (/\.(?:css|js)$/.test(name) && RETIRED_FAMILY.test(readText(name))) failures.push(`Retired UI font family: ${name}`);
  }
  return failures;
}

export function assertSystemFontEntries(entries, readText) {
  const failures = systemFontFailures(entries, readText);
  if (failures.length) throw new Error(`System font policy failed:\n${failures.join("\n")}`);
}

export function assertSystemFontAssets(root) {
  const entries = [];
  const walk = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(join(directory, entry.name), `${name}/`);
      else if (entry.isFile()) entries.push(name);
    }
  };
  walk(root);
  assertSystemFontEntries(entries, name => readFileSync(join(root, name), "utf8"));
}
