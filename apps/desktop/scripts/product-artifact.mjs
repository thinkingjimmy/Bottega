/**
 * [INPUT]: Depends on Node fs/path/crypto, electron-builder.yml productName/linux executableName facts, and package.json version
 * [OUTPUT]: Provides readPackagedProduct, locateCurrentPlatformArtifact for deterministic macOS, Windows, and Linux unpacked-output selection, and locateInstallers/INSTALLER_IDS mapping the four canonical installer ids (darwin-arm64.dmg, darwin-arm64.zip, win32-x64.nsis, linux-x64.appimage) to exact fresh files with bytes and sha256
 * [POS]: Single artifact-layout adapter shared by dist orchestration, packaged smoke, and the payload verifier; product names and installer filenames are never hard-coded in any caller
 */

import { createHash } from "node:crypto";
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

/* ------------------------------------------------------------------------- *
 *  四个规范化 installer id。文件名由 electron-builder 的默认模式（mac）与 yml 的
 *  artifactName（win/linux）决定；linux 的 ${arch} 对 x64 展开为 x86_64，不是 x64。
 *  精确名 + 新鲜度 + 恰好一个三条缺一不可：release/ 里会躺着改名前的残留。
 * ------------------------------------------------------------------------- */
const INSTALLERS = Object.freeze({
  "darwin-arm64.dmg": { platform: "darwin", file: (product, version) => `${product}-${version}-arm64.dmg` },
  "darwin-arm64.zip": { platform: "darwin", file: (product, version) => `${product}-${version}-arm64-mac.zip` },
  "win32-x64.nsis": { platform: "win32", file: (product, version) => `${product}-${version}-windows-x64.exe` },
  "linux-x64.appimage": { platform: "linux", file: (product, version) => `${product}-${version}-linux-x86_64.AppImage` },
});

export const INSTALLER_IDS = Object.freeze(Object.keys(INSTALLERS));

export function installerFileName(id, productName, version) {
  const spec = INSTALLERS[id];
  if (!spec) throw new Error(`未知的 installer id ${id}`);
  return spec.file(productName, version);
}

function sha256File(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

export function locateInstallers(desktop, startedAt, platform = process.platform) {
  const release = join(desktop, "release");
  const { productName } = readPackagedProduct(desktop);
  const { version } = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
  const names = readdirSync(release);
  return Object.fromEntries(
    Object.entries(INSTALLERS)
      .filter(([, spec]) => spec.platform === platform)
      .map(([id, spec]) => {
        const expected = spec.file(productName, version);
        const matches = names.filter((name) => name === expected);
        if (matches.length !== 1) {
          throw new Error(`本次 dist 应恰好生成一个 ${id}（${expected}），实际 ${matches.length}`);
        }
        const path = join(release, expected);
        const stat = statSync(path);
        if (!stat.isFile() || stat.mtimeMs < startedAt - 2_000) {
          throw new Error(`${id} 早于本次 dist：${expected}`);
        }
        return [id, { path, bytes: stat.size, sha256: sha256File(path) }];
      })
  );
}
