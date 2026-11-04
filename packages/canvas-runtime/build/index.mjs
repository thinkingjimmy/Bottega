/**
 * [INPUT]: Fixed source archive, per-file identities, maintained source patch and local adapters.
 * [OUTPUT]: Verified maintained source reconstruction, compiled editor assets and source/bridge/build/package/lock-bound receipt.
 * [POS]: Canvas source build entry; generated bundles are outputs only.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, lstatSync, copyFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { log } from "node:console";
import { fileURLToPath, URL } from "node:url";
import { compile } from "./compile.mjs";
import { verifiedFontLibrary } from "./fonts.mjs";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha256 = data => createHash("sha256").update(data).digest("hex");
const origin = JSON.parse(readFileSync(join(root, "source/origin.json"), "utf8"));
const archive = join(root, "source/upstream.tar.gz");
if (sha256(readFileSync(archive)) !== origin.sourceSha256) throw new Error("Canvas source archive changed");
const source = join(root, ".build/source");
rmSync(source, { recursive: true, force: true });
mkdirSync(source, { recursive: true });
execFileSync("tar", ["-xzf", archive, "-C", source]);
const expected = new Map(JSON.parse(readFileSync(join(root, "source/files.json"), "utf8")).map(file => [file.path, file]));
function walk(directory) {
  return readdirSync(directory).sort().flatMap(name => { const file = join(directory, name), stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error("Canvas source cannot contain symlinks");
    if (stat.isDirectory()) return walk(file);
    const path = relative(source, file).replaceAll("\\", "/"), data = readFileSync(file), entry = expected.get(path);
    if (!entry || entry.bytes !== data.length || entry.sha256 !== sha256(data)) throw new Error("Canvas source identity mismatch: " + path);
    if (path.endsWith(".css") && /@font-face\s*\{[^}]*(?:Anthropicons|FizzyLake|SplitCaret)/i.test(data.toString("utf8")))
      throw new Error("Excluded editor font remains in production source: " + path);
    expected.delete(path); return [path];
  });
}
const sources = walk(source);
if (expected.size || sources.length !== origin.sourceFiles) throw new Error("Canvas source closure is incomplete");
execFileSync("patch", ["--batch", "--forward", "-p1", "-i", join(root, "source/maintenance.patch")], { cwd: source, stdio: "pipe" });
const adapters = join(root, "adapters"), target = join(source, "packages/design-runtime/src/adapters");
mkdirSync(target, { recursive: true });
const adapterFiles = readdirSync(adapters).filter(file => /\.tsx?$/.test(file));
for (const file of adapterFiles) copyFileSync(join(adapters, file), join(target, file));
const fontRegistry = readFileSync(join(source, "packages/design-runtime/src/cds/platform/root-font-size.tsx"), "utf8").match(/iconFontMetadata = JSON.parse\(`([\s\S]*?)`\)/);
if (!fontRegistry) throw new Error("Native icon registry is missing");
const iconNames = Object.keys(JSON.parse(fontRegistry[1]).icons).sort();
const mappedNames = [...readFileSync(join(adapters, "native-icons.ts"), "utf8").matchAll(/^ {2}"([^"]+)":/gm)].map(match => match[1]).sort();
if (JSON.stringify(iconNames) !== JSON.stringify(mappedNames)) throw new Error("Native SVG icon coverage is incomplete");
const fontLibrary = verifiedFontLibrary(root);
const output = await compile(root, source, fontLibrary);
const receipt = { origin, fontLibraryInputs: fontLibrary.inputs, sourceFiles: sources.length, maintenanceSha256: sha256(readFileSync(join(root, "source/maintenance.patch"))),
  adapters: adapterFiles.map(path => ({ path, sha256: sha256(readFileSync(join(adapters, path))) })),
  buildScripts: [...readdirSync(join(root, "build")).filter(path => /\.(?:mjs|[jt]sx?)$/.test(path)), "projects/ui.ts", "projects/copy.ts"].sort().map(path => ({ path, sha256: sha256(readFileSync(join(root, "build", path))) })),
  packageSha256: sha256(readFileSync(join(root, "package.json"))), lockSha256: sha256(readFileSync(resolve(root, "../../pnpm-lock.yaml"))), outputs: output };
writeFileSync(join(root, "dist/build.json"), JSON.stringify(receipt, null, 2) + "\n");
log("Maintained Canvas built: " + output.length + " browser files; " + sources.length + " verified source inputs.");
