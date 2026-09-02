/**
 * [INPUT]: Depends on Node fs/path and electron-builder.yml productName/linux executableName facts
 * [OUTPUT]: Provides readPackagedProduct and locateCurrentPlatformArtifact for deterministic macOS, Windows, and Linux unpacked-output selection
 * [POS]: Single artifact-layout adapter shared by dist orchestration and packaged smoke; product names are never hard-coded in either caller
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const yamlValue = (source, key) => {
  const match = source.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]+)`, "m"));
  if (!match) throw new Error(`electron-builder.yml 缺少 ${key}`);
  return match[1].trim().replace(/^['"]|['"]$/g, "");
};

export function readPackagedProduct(desktop) {
  const source = readFileSync(join(desktop, "electron-builder.yml"), "utf8");
  return {
    productName: yamlValue(source, "productName"),
    linuxExecutableName: yamlValue(source, "executableName"),
  };
}

export function locateCurrentPlatformArtifact(desktop, startedAt, platform = process.platform) {
  const release = join(desktop, "release");
  const product = readPackagedProduct(desktop);
  const layouts = {
    darwin: {
      directory: /^mac(?:-|$)/,
      app: `${product.productName}.app`,
      resources: (app) => join(app, "Contents", "Resources"),
      executable: (app) => join(app, "Contents", "MacOS", product.productName),
    },
    win32: {
      directory: /^win(?:-|$)/,
      app: `${product.productName}.exe`,
      resources: (_app, appOutDir) => join(appOutDir, "resources"),
      executable: (app) => app,
    },
    linux: {
      directory: /^linux(?:-|$)/,
      app: product.linuxExecutableName,
      resources: (_app, appOutDir) => join(appOutDir, "resources"),
      executable: (app) => app,
    },
  };
  const layout = layouts[platform];
  if (!layout) throw new Error(`不支持的打包平台 ${platform}`);
  const candidates = readdirSync(release)
    .filter((name) => layout.directory.test(name))
    .map((name) => join(release, name))
    .filter((directory) => statSync(directory).isDirectory())
    .map((appOutDir) => ({
      appOutDir,
      appPath: join(appOutDir, layout.app),
    }))
    .filter(({ appPath }) => existsSync(appPath))
    .filter(({ appPath }) => statSync(appPath).mtimeMs >= startedAt - 2_000)
    .sort(
      (left, right) =>
        statSync(right.appPath).mtimeMs - statSync(left.appPath).mtimeMs
    );
  const selected = candidates[0];
  if (!selected) {
    throw new Error(`本次 dist 未生成 ${platform} unpacked 产物`);
  }
  return {
    ...selected,
    platform,
    resourcesPath: layout.resources(selected.appPath, selected.appOutDir),
    executable: layout.executable(selected.appPath),
  };
}
