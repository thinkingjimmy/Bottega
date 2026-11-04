/**
 * [INPUT]: Exact approved source/archive identities, fixed 64-file scope, reviewable source patch and licensed SVG adapters.
 * [OUTPUT]: Verified maintained source reconstruction and deterministic source/build/output receipt.
 * [POS]: Design System source build owner; compiled files are outputs, never maintenance inputs.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "node:console";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha = data => createHash("sha256").update(data).digest("hex");
const origin = JSON.parse(readFileSync(join(root, "source/origin.json"), "utf8"));
if (origin.commit !== "e2864776f8bf97617af75f5b94ab3dbdd007634e" ||
  sha(readFileSync(join(root, "source/line-exceptions.json"))) !== "fded94c5367f0f65d21922e4a1a03e4681b6c1211880f001b03d2cc401a8263c") throw new Error("Design System approved source scope changed");
if (sha(readFileSync(join(root, "source/upstream.tar.gz"))) !== origin.sourceSha256) throw new Error("Design System source archive changed");
if (sha(readFileSync(join(root, "source/files.json"))) !== origin.sourceManifestSha256 ||
  sha(readFileSync(join(root, "source/preview-run.html"))) !== origin.previewRunner.sha256) throw new Error("Design System source manifest or preview identity changed");
const approved = new Map(JSON.parse(readFileSync(join(root, "source/line-exceptions.json"), "utf8")).files.map(file => [file.path, file]));
if (approved.size !== 64) throw new Error("Design System approved source scope changed");
const source = join(root, ".build/source");
rmSync(source, { recursive: true, force: true }); mkdirSync(source, { recursive: true });
execFileSync("tar", ["-xzf", join(root, "source/upstream.tar.gz"), "-C", source]);
const expected = new Map(JSON.parse(readFileSync(join(root, "source/files.json"), "utf8")).map(file => [file.path, file]));
const walk = directory => readdirSync(directory).sort().flatMap(name => {
  const path = join(directory, name), stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Design System source links are prohibited");
  if (stat.isDirectory()) return walk(path);
  const member = relative(source, path).replaceAll("\\", "/"), data = readFileSync(path), file = expected.get(member);
  if (!file || file.sha256 !== sha(data) || file.bytes !== data.length) throw new Error("Design System source identity changed: " + member);
  const exception = approved.get(member);
  if (file.lfLines > 800 && (!exception || exception.gitBlob !== file.upstreamBlob)) throw new Error("Unapproved oversized source: " + member);
  if (/\.(?:woff2?|ttf|otf)$/.test(member) || member.endsWith(".css") && /@font-face\s*\{[^}]*(?:Anthropicons|FizzyLake)/i.test(data.toString("utf8"))) throw new Error("Excluded editor font in Design System source");
  expected.delete(member); return [member];
});
const members = walk(source);
if (expected.size || members.length !== origin.sourceFiles) throw new Error("Design System source closure is incomplete");
execFileSync("patch", ["--batch", "--forward", "-p1", "-i", join(root, "source/maintenance.patch")], { cwd: source, stdio: "pipe" });
const adapter = readFileSync(join(root, "adapters/icons.tsx"), "utf8");
const target = join(source, "packages/design-system-runtime/src/adapters"); mkdirSync(target, { recursive: true });
for (const file of readdirSync(join(root, "adapters")).filter(path => /\.tsx?$/.test(path))) writeFileSync(join(target, file), readFileSync(join(root, "adapters", file), "utf8").replaceAll("../../canvas-runtime/", resolve(root, "../canvas-runtime") + "/"));
const interactions = readFileSync(join(source, "packages/design-system-runtime/src/ui/interactions.tsx"), "utf8");
const glyphs = interactions.match(/iconFontManifest = JSON.parse\(`([\s\S]*?)`\)/);
if (!glyphs) throw new Error("Design System icon manifest is missing");
const names = Object.keys(JSON.parse(glyphs[1]).icons).sort();
const mapping = readFileSync(resolve(root, "../canvas-runtime/adapters/native-icons.ts"), "utf8") + adapter;
const mapped = [...mapping.matchAll(/^ {2}"([^"]+)":/gm)].map(match => match[1]).sort();
if (JSON.stringify(names) !== JSON.stringify(mapped)) throw new Error("Design System SVG coverage is incomplete");
const { compile } = await import("./compile.mjs");
const built = await compile(root, source);
const shared = ["adapters/export-runtime.ts", "adapters/native-icon.tsx", "adapters/native-icons.ts", "adapters/custom-icons.ts", "adapters/asset-address.ts", "build/comments.ts", "build/transport.ts", "build/downloads.ts", "build/projects/ui.ts", "build/projects/copy.ts", ".build/source/packages/slides/src/editor/editor-host.ts", ".build/source/packages/slides/src/file-protocol.ts"].map(path => ({ path: "../canvas-runtime/" + path, sha256: sha(readFileSync(resolve(root, "../canvas-runtime", path))) }));
const receipt = { origin, sourceFiles: members.length, approvedOversizedFiles: approved.size, iconNames: names.length,
  editorReact: built.editorReact, previewReact: built.previewReact,
  maintenanceSha256: sha(readFileSync(join(root, "source/maintenance.patch"))),
  adapters: readdirSync(join(root, "adapters")).filter(path => /\.tsx?$/.test(path)).sort().map(path => ({ path, sha256: sha(readFileSync(join(root, "adapters", path))) })), shared,
  buildScripts: readdirSync(join(root, "build")).filter(path => /\.(?:mjs|ts)$/.test(path)).sort().map(path => ({ path, sha256: sha(readFileSync(join(root, "build", path))) })),
  packageSha256: sha(readFileSync(join(root, "package.json"))), lockSha256: sha(readFileSync(resolve(root, "../../pnpm-lock.yaml"))), outputs: built.outputs };
writeFileSync(join(root, "dist/build.json"), JSON.stringify(receipt, null, 2) + "\n");
log("Maintained Design System built: " + members.length + " source files; " + names.length + " SVG icons.");
