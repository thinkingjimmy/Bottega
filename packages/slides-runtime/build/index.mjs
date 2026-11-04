/**
 * [INPUT]: Fixed approved Slides archive, per-file identities, source patches and common native adapters.
 * [OUTPUT]: Verified source reconstruction and exact source, build, bridge, package, lock and output receipt.
 * [POS]: Maintained Slides build entry; generated bundles are never maintenance inputs.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, lstatSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { log } from "node:console";
import { compile } from "./compile.mjs";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha = data => createHash("sha256").update(data).digest("hex");
const origin = JSON.parse(readFileSync(join(root, "source/origin.json"), "utf8"));
if (sha(readFileSync(join(root, "source/upstream.tar.gz"))) !== origin.sourceSha256 ||
    sha(readFileSync(join(root, "source/line-exceptions.json"))) !== origin.lineExceptionsSha256) throw new Error("Slides fixed source scope changed");
const scope = JSON.parse(readFileSync(join(root, "source/line-exceptions.json"), "utf8"));
const exceptions = new Set((Array.isArray(scope) ? scope : scope.files).map(row => row.path));
if (exceptions.size !== 81) throw new Error("Slides approved line exception scope is incomplete");
const source = join(root, ".build/source");
rmSync(source, { recursive: true, force: true }); mkdirSync(source, { recursive: true });
execFileSync("tar", ["-xzf", join(root, "source/upstream.tar.gz"), "-C", source]);
const expected = new Map(JSON.parse(readFileSync(join(root, "source/files.json"), "utf8")).map(file => [file.path, file]));
const walk = directory => readdirSync(directory).sort().flatMap(name => {
  const path = join(directory, name), stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Slides source symlinks are prohibited");
  if (stat.isDirectory()) return walk(path);
  const member = relative(source, path).replaceAll("\\", "/"), entry = expected.get(member), data = readFileSync(path);
  if (!entry || data.length !== entry.bytes || sha(data) !== entry.sha256) throw new Error("Slides source identity changed: " + member);
  if (entry.lfLines > 800 && !exceptions.has(member)) throw new Error("Unapproved oversized Slides source: " + member);
  if (/\.(?:woff2?|otf|ttf)$/.test(member) || (member.endsWith(".css") && /@font-face\s*\{[^}]*(?:Anthropicons|FizzyLake|SplitCaret)/i.test(data.toString("utf8"))))
    throw new Error("Excluded UI font in Slides source: " + member);
  expected.delete(member); return [member];
});
const members = walk(source);
if (expected.size || members.length !== origin.sourceFiles) throw new Error("Slides source closure is incomplete");
execFileSync("patch", ["--batch", "--forward", "-p1", "-i", join(root, "source/maintenance.patch")], { cwd: source });
const adapters = readdirSync(join(root, "adapters")).filter(name => /\.tsx?$/.test(name));
const target = join(source, "packages/slides-runtime/src/adapters"); mkdirSync(target, { recursive: true });
for (const name of adapters) {
  const text = readFileSync(join(root, "adapters", name), "utf8").replaceAll("../../canvas-runtime/", resolve(root, "../canvas-runtime") + "/");
  writeFileSync(join(target, name), text);
}
const uiSource = readFileSync(join(source, "packages/slides-runtime/src/ui/interactions.ts"), "utf8");
const registry = uiSource.match(/iconFontManifest = JSON.parse\(`([\s\S]*?)`\)/);
const glyphSource = readFileSync(join(source, "packages/slides-runtime/src/rendering/icon-font.ts"), "utf8");
const glyphs = glyphSource.match(/iconFontGlyphs = JSON.parse\(\s*' ([^']+)'/);
if (!registry || !glyphs) throw new Error("Original Slides icon registries are missing");
const commonNames = [...readFileSync(resolve(root, "../canvas-runtime/adapters/native-icons.ts"), "utf8").matchAll(/^ {2}"([^"]+)":/gm)].map(match => match[1]);
const aliasSource = readFileSync(join(root, "adapters/native-icon.tsx"), "utf8");
const mappingSource = aliasSource.slice(aliasSource.indexOf("const aliases:"), aliasSource.indexOf("for (const [name, target]"));
const declared = new Set([...commonNames, ...[...mappingSource.matchAll(/(?:^|[\s,])([A-Za-z][A-Za-z0-9_]*):/gm)].map(match => match[1])]);
const required = new Set([...Object.keys(JSON.parse(registry[1]).icons), ...Object.keys(JSON.parse(glyphs[1]))]);
for (const name of required) if (!declared.has(name)) throw new Error("Missing Slides SVG icon: " + name);
const bridges = ["host.ts", "comments.ts", "downloads.ts", "transport.ts"].map(name => {
  const path = resolve(root, "../canvas-runtime/build", name), data = readFileSync(path);
  writeFileSync(join(root, ".build", name), data.toString().replaceAll("../.build/source/", "./source/").replaceAll("./projects/ui", resolve(root, "../canvas-runtime/build/projects/ui")));
  return { path: "../canvas-runtime/build/" + name, sha256: sha(data) };
});
bridges.push(...["projects/ui.ts", "projects/copy.ts"].map(name => ({ path: "../canvas-runtime/build/" + name, sha256: sha(readFileSync(resolve(root, "../canvas-runtime/build", name))) })));
const outputs = await compile(root, source);
const identities = folder => readdirSync(join(root, folder)).filter(name => /\.(?:mjs|[jt]sx?)$/.test(name)).sort()
  .map(path => ({ path, sha256: sha(readFileSync(join(root, folder, path))) }));
const receipt = { origin, sourceFiles: members.length, maintenanceSha256: sha(readFileSync(join(root, "source/maintenance.patch"))),
  buildScripts: identities("build"), adapters: identities("adapters"), bridges,
  sharedAdapters: readdirSync(resolve(root, "../canvas-runtime/adapters")).filter(name => /\.tsx?$/.test(name)).sort()
    .map(name => ({ path: "../canvas-runtime/adapters/" + name, sha256: sha(readFileSync(resolve(root, "../canvas-runtime/adapters", name))) })),
  sharedProtocol: ["../cloud-protocol/src/artifacts/design/native/font-face.ts"].map(path => ({ path, sha256: sha(readFileSync(resolve(root, path))) })),
  packageSha256: sha(readFileSync(join(root, "package.json"))), lockSha256: sha(readFileSync(resolve(root, "../../pnpm-lock.yaml"))), outputs };
writeFileSync(join(root, "dist/build.json"), JSON.stringify(receipt, null, 2) + "\n");
log("Maintained Slides built: " + outputs.length + " files; " + members.length + " verified source inputs.");
