/**
 * [INPUT]: Depends on canonical authored App schemas, content hashing and bounded logical files.
 * [OUTPUT]: Projects portable paths and encodes/verifies source-only App envelopes with independent cloud and origin digests.
 * [POS]: Portable byte contract shared by desktop export, cloud verification and fixed-ID installation.
 */
import { z } from "zod";
import { sha256Schema } from "../blobs";
import { hashBytes } from "../blobs/transfer";
import { canonicalJson } from "../encryption/encoding";
import { appManifestSchema } from "./schemas/manifest";
import { parseSemVer } from "./schemas/semver";
import { appBaseDataMigrationFileSchema } from "./schemas/migrations";
import { portableCommandPath } from "./schemas/command";
import { PACKAGE_ALLOWLIST, PACKAGE_BUDGET } from "./schemas/package-policy";

export const APP_SOURCE_LIMITS = { bytes: PACKAGE_BUDGET.totalBytes, files: PACKAGE_BUDGET.files, depth: PACKAGE_BUDGET.depth,
  fileBytes: PACKAGE_BUDGET.fileBytes, wireBytes: 24 * 1024 * 1024 } as const;
const sourcePaths = PACKAGE_ALLOWLIST.filter(path => path !== "data/base.json" && !path.startsWith(".bottega/"));
const exact = new Set<string>(sourcePaths.filter(path => !path.endsWith("/**")));
const prefixes = sourcePaths.filter(path => path.endsWith("/**")).map(path => path.slice(0, -2));
const appSourcePathSchema = portableCommandPath.refine(path => path !== "." && path.normalize("NFC") === path &&
  path.split("/").length <= APP_SOURCE_LIMITS.depth &&
  (exact.has(path) || prefixes.some(prefix => path.startsWith(prefix))) &&
  !path.split("/").some(segment => ["node_modules", ".git", ".bottega", "dist", "build", "target"].includes(segment) || /^\.env(?:\.|$)/i.test(segment)),
"App source path is outside the portable allowlist");
export const isPortableAppSourcePath = (path: string) => appSourcePathSchema.safeParse(path).success;
const fileSchema = z.object({ path: appSourcePathSchema, bytes: z.number().int().nonnegative().max(APP_SOURCE_LIMITS.bytes),
  sha256: sha256Schema, content: z.string().max(Math.ceil(APP_SOURCE_LIMITS.bytes / 3) * 4)
    .refine(value => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)) }).strict();
const envelopeSchema = z.object({ schema: z.literal("bottega.cloud-app-source/v1"), manifestDigest: sha256Schema,
  sourcePackageDigest: sha256Schema, originGenerationDigest: sha256Schema.nullable(), files: z.array(fileSchema).min(2).max(APP_SOURCE_LIMITS.files) }).strict();
type AppSourceFile = { path: string; bytes: Uint8Array };
export type AppSourceEnvelope = z.infer<typeof envelopeSchema>;
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const compare = (a: string, b: string) => {
  const left = encoder.encode(a), right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
};
function sourceDigest(files: AppSourceEnvelope["files"]) {
  return hashBytes(encoder.encode(canonicalJson({ schema: "bottega.cloud-app-source/v1", files: files.map(({ content: _content, ...file }) => file) })));
}
function checkFileSet(files: Array<{ path: string; bytes: number }>) {
  if (files.length > APP_SOURCE_LIMITS.files || files.reduce((sum, file) => sum + file.bytes, 0) > APP_SOURCE_LIMITS.bytes ||
    new Set(files.map(file => file.path.toLocaleLowerCase("en-US"))).size !== files.length) throw new Error("app-source-budget-or-path-conflict");
  const paths = new Set(files.map(file => file.path.toLocaleLowerCase("en-US")));
  for (let i = 0; i < files.length; i++) {
    if (files[i]!.bytes > APP_SOURCE_LIMITS.fileBytes) throw new Error("app-source-file-budget");
    appSourcePathSchema.parse(files[i]!.path);
    const parts = files[i]!.path.toLocaleLowerCase("en-US").split("/");
    for (let depth = 1; depth < parts.length; depth++) if (paths.has(parts.slice(0, depth).join("/"))) throw new Error("app-source-path-conflict");
    if (i && compare(files[i - 1]!.path, files[i]!.path) >= 0) throw new Error("app-source-order-invalid");
  }
}
export function encodeAppSourcePackage(files: readonly AppSourceFile[], originGenerationDigest: string | null): Uint8Array {
  const ordered = [...files].sort((a, b) => compare(a.path, b.path));
  checkFileSet(ordered.map(file => ({ path: file.path, bytes: file.bytes.byteLength })));
  const manifestFile = ordered.find(file => file.path === "app.json");
  if (!manifestFile) throw new Error("app-manifest-missing");
  const packed = ordered.map(file => ({ path: file.path, bytes: file.bytes.byteLength, sha256: hashBytes(file.bytes), content: toBase64(file.bytes) }));
  const envelope = envelopeSchema.parse({ schema: "bottega.cloud-app-source/v1", files: packed, originGenerationDigest,
    manifestDigest: hashBytes(encoder.encode(canonicalJson(JSON.parse(decoder.decode(manifestFile.bytes))))), sourcePackageDigest: sourceDigest(packed) });
  const bytes = encoder.encode(canonicalJson(envelope));
  verifyAppSourcePackage(bytes); return bytes;
}
export function verifyAppSourcePackage(bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > APP_SOURCE_LIMITS.wireBytes) throw new Error("app-source-wire-budget");
  const envelope = envelopeSchema.parse(JSON.parse(decoder.decode(bytes)));
  checkFileSet(envelope.files);
  const files = envelope.files.map(file => {
    const bytes = fromBase64(file.content);
    if (bytes.byteLength !== file.bytes || hashBytes(bytes) !== file.sha256) throw new Error("app-source-file-integrity");
    return { path: file.path, bytes };
  });
  if (sourceDigest(envelope.files) !== envelope.sourcePackageDigest) throw new Error("app-source-digest-mismatch");
  const read = (path: string) => {
    const file = files.find(file => file.path === path); if (!file) throw new Error("app-source-required-file-missing");
    return JSON.parse(decoder.decode(file.bytes)) as unknown;
  };
  const authored = read("app.json"), manifest = appManifestSchema.parse(authored);
  if (manifest.kind !== "base") throw new Error("app-source-base-only");
  if (hashBytes(encoder.encode(canonicalJson(authored))) !== envelope.manifestDigest) throw new Error("app-manifest-digest-mismatch");
  const compatibility = z.object({ schema: z.literal("bottega.app-compat/v1"), minBottegaVersion: z.string().refine(value => Boolean(parseSemVer(value))) }).strict().parse(read("app.compat.json"));
  if (files.some(file => file.path.startsWith("migrations/") && file.path !== "migrations/base.json")) throw new Error("app-migration-unsupported");
  const migrationFile = files.find(file => file.path === "migrations/base.json");
  if (migrationFile && migrationFile.bytes.byteLength > 512 * 1024) throw new Error("app-migration-budget");
  const migration = migrationFile ? appBaseDataMigrationFileSchema.parse(read(migrationFile.path)) : null;
  const requiresMigration = Boolean(migration?.migrations.some(item => item.addColumns.length || Object.keys(item.defaultValues).length || item.aliases.length));
  return { files, manifest, manifestDigest: envelope.manifestDigest, sourcePackageDigest: envelope.sourcePackageDigest,
    originGenerationDigest: envelope.originGenerationDigest, minBottegaVersion: compatibility.minBottegaVersion,
    migrationDigest: requiresMigration ? hashBytes(encoder.encode(canonicalJson(migration))) : null,
    dataCoverage: manifest.gui?.capabilities.includes("workspace-read") ? "partial" as const : "base-only" as const };
}
function toBase64(bytes: Uint8Array) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3 * 8192) result += btoa(String.fromCharCode(...bytes.subarray(i, i + 3 * 8192)));
  return result;
}
function fromBase64(value: string) {
  const binary = atob(value); return Uint8Array.from(binary, character => character.charCodeAt(0));
}
