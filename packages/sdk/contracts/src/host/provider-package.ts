/**
 * [INPUT]: Depends on the host-package manifest type and the Provider descriptor type.
 * [OUTPUT]: Provides PROVIDER_DESCRIPTOR_FILE, ProviderPackageRefusal and checkProviderPackage: the structural rules every Provider package meets.
 * [POS]: Public, pure and host-independent, so an author (and the testing package) can run the same check the host runs first; the host adds its own policy on top (reserved ids, protected roots and environment names).
 */
import type { ProviderDescriptor } from "../model/provider";
import type { HostPackageManifest } from "./manifest";

/** The Provider descriptor a Provider package carries beside its manifest (schema bottega.provider-descriptor/v1, parsed strictly). */
export const PROVIDER_DESCRIPTOR_FILE = "bottega.provider.json";

export type ProviderPackageRefusal =
  | "not-a-provider-package"
  | "bridge-entry-missing"
  | "provider-id-mismatch"
  | "package-id-mismatch"
  | "discovery-command-not-a-name"
  | "sensitive-root-invalid";

/* A root a Provider asks the host to protect is also a root its own process may use, so it must name the CLI's own hidden state:
   `~/` then a hidden first segment, never a shared parent by itself. */
const SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;
const SHARED_PARENTS = new Set([".config", ".local", ".local/share", ".local/state", ".cache"]);
const COMMAND = /^[A-Za-z0-9._-]{1,64}$/;

function rootIsOwnState(path: string) {
  if (!path.startsWith("~/")) return false;
  const segments = path.slice(2).split("/");
  if (!segments.length || segments.length > 6) return false;
  if (!segments.every(segment => SEGMENT.test(segment) && segment !== "." && segment !== "..")) return false;
  if (!segments[0]!.startsWith(".")) return false;
  return !SHARED_PARENTS.has(segments.join("/"));
}

/** The structural rules: the manifest's Provider and the descriptor name the same Provider and package, the package has a bridge,
    discovery finds commands by name only, and every protected root is the CLI's own hidden state. */
export function checkProviderPackage(manifest: HostPackageManifest, descriptor: ProviderDescriptor):
  { ok: true } | { ok: false; refusal: ProviderPackageRefusal; detail: string } {
  const refuse = (refusal: ProviderPackageRefusal, detail: string) => ({ ok: false as const, refusal, detail });
  if (!manifest.provider) return refuse("not-a-provider-package", "the manifest declares no provider");
  if (!manifest.entries.bridge) return refuse("bridge-entry-missing", "a Provider package needs a bridge entry");
  if (descriptor.providerId !== manifest.provider.id) return refuse("provider-id-mismatch", `${descriptor.providerId} ≠ ${manifest.provider.id}`);
  if (descriptor.packageId !== manifest.packageId) return refuse("package-id-mismatch", `${descriptor.packageId} ≠ ${manifest.packageId}`);
  const command = descriptor.runtime.discovery.commands.find(value => !COMMAND.test(value) || value === "." || value === "..");
  if (command !== undefined) return refuse("discovery-command-not-a-name", command);
  const root = descriptor.sensitiveRoots.paths.find(path => !rootIsOwnState(path));
  if (root !== undefined) return refuse("sensitive-root-invalid", root);
  return { ok: true };
}
