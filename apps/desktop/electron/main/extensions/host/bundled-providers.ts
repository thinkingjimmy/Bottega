/**
 * [INPUT]: Depends on node:crypto/fs, the public host-package manifest schema, the bundled package layout (shared/providers/bundled-package.ts), admitProviderPackage's bundled mode, and the runtime port's pins (each package's directory and its files' digests from runtime-entries.json).
 * [OUTPUT]: Provides BundledProviderPackage, BundledProviderRefused and admitBundledProviderPackages: every built-in Provider package verified byte for byte against its pins and admitted, or refused by name (P8).
 * [POS]: The startup registration of the built-in Provider packages (TASK-11 d3). They are read-only and trusted by the app's own build and signature, so there is no Registry entry, confirmation or copy; the bridge takes its module pin only from an admitted package here.
 */
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { HOST_PACKAGE_MANIFEST, hostPackageManifestSchema } from "@bottega/contracts/host/manifest";
import { PROVIDER_DESCRIPTOR_FILE } from "@bottega/contracts/host/provider-package";
import { BUNDLED_BRIDGE_ENTRY } from "../../../../shared/providers/bundled-package";
import { BUILTIN_PROVIDER_DESCRIPTORS } from "../../../../shared/providers/builtin";
import { canonicalDirectory } from "../manifest-adapter";
import { admitProviderPackage } from "./provider-package";

export type BundledProviderPackage = Readonly<{ providerId: string; root: string; bridge: Readonly<{ path: string; sha256: string }> }>;
export type BundledProviderPin = Readonly<{ root: string; files: Readonly<Record<string, Readonly<{ sha256: string }>>> }>;

export class BundledProviderRefused extends Error {
  constructor(readonly providerId: string,
    readonly reason: "package-missing" | "file-missing" | "file-unexpected" | "digest-mismatch" | "manifest-invalid" | "package-refused",
    detail: string) {
    super(`The built-in ${providerId} Provider package is refused (${reason}): ${detail}`);
    this.name = "BundledProviderRefused";
  }
}

const PACKAGE_FILES = [HOST_PACKAGE_MANIFEST, PROVIDER_DESCRIPTOR_FILE, BUNDLED_BRIDGE_ENTRY] as const;

async function admit(providerId: string, pin: (providerId: string) => BundledProviderPin): Promise<BundledProviderPackage> {
  const refuse = (reason: BundledProviderRefused["reason"], detail: string) => new BundledProviderRefused(providerId, reason, detail);
  let recorded: BundledProviderPin;
  try { const pinned = pin(providerId); recorded = { ...pinned, root: await canonicalDirectory(pinned.root) }; }
  catch (cause) { throw refuse("package-missing", (cause as Error).message); }
  const extra = Object.keys(recorded.files).filter(name => !(PACKAGE_FILES as readonly string[]).includes(name));
  if (extra.length) throw refuse("file-unexpected", extra.join(", "));
  /* Every file is checked before any is parsed: the admission below reads only bytes the build pinned. */
  const bytes = new Map<string, Buffer>();
  for (const name of PACKAGE_FILES) {
    const expected = recorded.files[name]?.sha256;
    if (!expected) throw refuse("file-missing", `${name} is not pinned`);
    const path = join(recorded.root, name);
    if (!(await lstat(path).then(info => info.isFile(), () => false))) throw refuse("file-missing", `${name} is not a regular file`);
    const content = await readFile(path);
    if (createHash("sha256").update(content).digest("hex") !== expected) throw refuse("digest-mismatch", name);
    bytes.set(name, content);
  }
  let manifest;
  try { manifest = hostPackageManifestSchema.parse(JSON.parse(bytes.get(HOST_PACKAGE_MANIFEST)!.toString("utf8"))); }
  catch (cause) { throw refuse("manifest-invalid", (cause as Error).message.slice(0, 300)); }
  if (manifest.provider?.id !== providerId || manifest.entries.bridge !== BUNDLED_BRIDGE_ENTRY) {
    throw refuse("manifest-invalid", `the manifest does not declare ${providerId} with ${BUNDLED_BRIDGE_ENTRY}`);
  }
  const admitted = await admitProviderPackage(recorded.root, manifest, { bundled: true });
  if (!admitted.ok) throw refuse("package-refused", `${admitted.refusal}: ${admitted.detail}`);
  return { providerId, root: recorded.root, bridge: { path: join(recorded.root, BUNDLED_BRIDGE_ENTRY), sha256: recorded.files[BUNDLED_BRIDGE_ENTRY]!.sha256 } };
}

/**
 * Admits the four built-ins at startup. Each settles on its own: a refused package refuses only its own Provider, by name, and nothing
 * falls back to a path outside the pinned set (P8). `get` answers the admitted package or throws that Provider's refusal.
 */
export async function admitBundledProviderPackages(pin: (providerId: string) => BundledProviderPin) {
  const results = new Map<string, BundledProviderPackage | BundledProviderRefused>();
  await Promise.all(BUILTIN_PROVIDER_DESCRIPTORS.map(async ({ providerId }) => {
    results.set(providerId, await admit(providerId, pin).catch((cause: unknown) =>
      cause instanceof BundledProviderRefused ? cause : new BundledProviderRefused(providerId, "package-missing", String(cause))));
  }));
  return {
    refused: () => [...results.values()].filter((value): value is BundledProviderRefused => value instanceof BundledProviderRefused),
    get(providerId: string): BundledProviderPackage {
      const result = results.get(providerId);
      if (!result) throw new BundledProviderRefused(providerId, "package-missing", "this host ships no such built-in");
      if (result instanceof BundledProviderRefused) throw result;
      return result;
    },
  };
}
export type BundledProviderPackages = Awaited<ReturnType<typeof admitBundledProviderPackages>>;
