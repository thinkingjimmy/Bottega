/**
 * [INPUT]: Depends on node:crypto/fs, the host-package manifest schema, d1's Provider package admission, the containment check, the shared Provider catalog, and the d4-0 catalog contract.
 * [OUTPUT]: Provides ProviderPackageSource, readProviderPackage (one package's descriptor and bridge pin through d1's admission, also read by d4c's sensitive roots) and createPackageProviderCatalog: the ProviderCatalogPort over the built-ins plus every installed Provider package, rebuilt on demand (a package Provider is available only while active, admitted, trusted, runnable and backed), publishing a snapshot only when it changes or an available package changes generation (a new revision even when its entry reads the same) and closing the bridge of a Provider that stops being available or whose package changes generation.
 * [POS]: TASK-11 d4a, the package-aware implementation of providers/host/catalog.ts. The foundation composes it over the Extension Registry and rebuilds it on every inventory change; d4b's DescriptorBackend (descriptor-backend.ts beside it) is what resolveBackend answers for an available package, and d4c's gate still decides every launch.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { HOST_PACKAGE_MANIFEST, hostPackageManifestSchema } from "@bottega/contracts/host/manifest";
import type { ProviderDescriptor, ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import { builtinProviderCatalog, createProviderCatalog, type ProviderCatalog } from "../../../../../shared/providers/catalog";
import type { ProviderCatalogSnapshot } from "../../../../../shared/providers/catalog-ipc";
import type { BackendDescriptor } from "../../../backends/types";
import { admitProviderPackage } from "../../../extensions/host/provider-package";
import { canonicalDirectory, containedExisting } from "../../../extensions/manifest-adapter";
import type { DescriptorBackendFactory, ProviderBackend, ProviderCatalogPort, ProviderPackageRef } from "../catalog";

/** One installed host package as the Registry records it; the catalog reads its active generation's files itself. */
export type ProviderPackageSource = Readonly<{
  installIdentity: string;
  /** The active generation's content digest, null when the package has no active generation. */
  contentDigest: string | null;
  generationId: string | null;
  state: "active" | "disabled";
  admission: "valid" | "misconfigured";
}>;

type Unavailable = NonNullable<ProviderCatalogSnapshot["entries"][number]["unavailableReason"]>;
type PackageEntry = Readonly<{ descriptor: ProviderDescriptor; ref: ProviderPackageRef; unavailable: Unavailable | null }>;

const MANIFEST_BYTES = 64 * 1024;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** What one package offers: its Provider's descriptor and bridge pin, or why it offers nothing (null: not a Provider package). */
export async function readProviderPackage(packageRoot: string): Promise<{ root: string; descriptor: ProviderDescriptor; bridge: { path: string; sha256: string } } | { refused: string } | null> {
  let manifest, root: string;
  try {
    root = await canonicalDirectory(packageRoot);
    const path = await containedExisting(root, HOST_PACKAGE_MANIFEST, "file");
    if ((await stat(path)).size > MANIFEST_BYTES) return { refused: "manifest too large" };
    manifest = hostPackageManifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (cause) { return { refused: `manifest unreadable: ${(cause as Error).message.slice(0, 200)}` }; }
  if (!manifest.provider) return null;
  const admitted = await admitProviderPackage(root, manifest);
  if (!admitted.ok) return { refused: `${admitted.refusal}: ${admitted.detail}` };
  try {
    const path = await containedExisting(root, manifest.entries.bridge!, "file");
    return { root, descriptor: admitted.descriptor, bridge: { path, sha256: sha256(await readFile(path)) } };
  } catch (cause) { return { refused: `bridge entry unreadable: ${(cause as Error).message.slice(0, 200)}` }; }
}

export function createPackageProviderCatalog(deps: Readonly<{
  /** The built-ins' host code, keyed by id. */
  builtins: ReadonlyMap<string, BackendDescriptor>;
  /** Every installed host package, disabled ones included. */
  packages(): readonly ProviderPackageSource[];
  packageRoot(contentDigest: string): string;
  /** d4b: main's side of a package Provider. Absent, a package Provider is listed but cannot run (`package-refused`). */
  factory?: DescriptorBackendFactory;
  /** d4c: a package whose trust verdict is refused. */
  trustRefused?(installIdentity: string): boolean;
  /** d4c: whether a package Provider may run at all (false in production while third-party modules are refused), so the catalog
      never advertises a Provider every use of which the gate would refuse. Absent: runnable. */
  runnable?(installIdentity: string): boolean;
  /** Called once when a Provider stops being available, or its package changes generation (`package-updated`, a stop cause, not a
      snapshot reason): its bridge closes, so no turn runs the old module, and only its own turns fail. */
  closeProvider(providerId: ProviderId, reason: Unavailable | "package-updated"): void | Promise<void>;
  log?(message: string): void;
}>): ProviderCatalogPort & { rebuild(): Promise<void> } {
  const log = deps.log ?? (message => console.warn(`[providers] ${message}`));
  const builtinDescriptors = builtinProviderCatalog.entries().map(entry => entry.descriptor);
  let packages = new Map<string, PackageEntry>();
  let catalog: ProviderCatalog = builtinProviderCatalog;
  let snapshot: ProviderCatalogSnapshot = { revision: 0, entries: [] };
  const backends = new Map<string, ProviderBackend>(); // `${id}\0${generation digest}` → backend
  const listeners = new Set<(value: ProviderCatalogSnapshot) => void>();
  let flight: Promise<void> | null = null, again = false;
  let generations = ""; // each available package Provider's digest: a new generation is news even when its entry reads the same

  const snapshotEntries = (): ProviderCatalogSnapshot["entries"] => [
    ...builtinDescriptors.map(descriptor => ({ id: descriptor.providerId, displayName: descriptor.displayName, source: "builtin" as const,
      available: true, capabilities: descriptor.capabilities, purposes: descriptor.purposes, configFields: descriptor.configFields })),
    ...[...packages.values()].map(({ descriptor, unavailable }) => ({ id: descriptor.providerId, displayName: descriptor.displayName,
      source: "package" as const, available: !unavailable, ...(unavailable ? { unavailableReason: unavailable } : {}),
      capabilities: descriptor.capabilities, purposes: descriptor.purposes, configFields: descriptor.configFields })),
  ];

  async function build() {
    const next = new Map<string, PackageEntry>();
    const contested = new Set<string>();
    const sources = [...deps.packages()].sort((a, b) => a.installIdentity.localeCompare(b.installIdentity));
    for (const source of sources) {
      if (!source.contentDigest) continue;
      const offered = await readProviderPackage(deps.packageRoot(source.contentDigest)).catch((cause: unknown) => ({ refused: String(cause) }));
      if (!offered) continue;
      if ("refused" in offered) { log(`${source.installIdentity}: not a usable Provider package (${offered.refused})`); continue; }
      const id = offered.descriptor.providerId;
      /* A contested id belongs to nobody: every package claiming it is refused, whatever order they were installed in (d4c's gate
         applies the same rule, so the catalog and admission never disagree about who supplies a Provider). */
      if (next.has(id) || contested.has(id)) {
        if (next.has(id)) log(`${next.get(id)!.ref.installIdentity}: Provider ${id} is also claimed by another package`);
        log(`${source.installIdentity}: Provider ${id} is also claimed by another package`);
        contested.add(id);
        const first = next.get(id);
        if (first) next.set(id, { ...first, unavailable: "package-refused" });
        continue;
      }
      const unavailable: Unavailable | null = source.state !== "active" ? "package-disabled"
        : source.admission !== "valid" ? "package-refused"
        : deps.trustRefused?.(source.installIdentity) ? "trust-refused"
        : !deps.factory || deps.runnable?.(source.installIdentity) === false ? "package-refused"
        : null;
      next.set(id, { descriptor: offered.descriptor, unavailable,
        ref: { installIdentity: source.installIdentity, root: offered.root, packageDigest: source.contentDigest, bridge: offered.bridge } });
    }
    /* A Provider that was listed and whose package is gone stays listed as removed until restart, so its Chats say why. */
    for (const [id, previous] of packages) {
      if (!next.has(id)) next.set(id, { ...previous, unavailable: "package-removed" });
    }
    const lost = [...packages].filter(([id, previous]) => !previous.unavailable && next.get(id)?.unavailable)
      .map(([id]) => [id, next.get(id)!.unavailable!] as const);
    const updated = [...packages].filter(([id, previous]) => !previous.unavailable && next.get(id) && !next.get(id)!.unavailable
      && next.get(id)!.ref.packageDigest !== previous.ref.packageDigest).map(([id]) => [id, "package-updated"] as const);
    packages = next;
    for (const key of [...backends.keys()]) {
      const [id, digest] = key.split("\0");
      const entry = packages.get(id!);
      if (!entry || entry.unavailable || entry.ref.packageDigest !== digest) backends.delete(key);
    }
    catalog = createProviderCatalog([...builtinDescriptors, ...[...packages.values()].filter(entry => !entry.unavailable).map(entry => entry.descriptor)]);
    const entries = snapshotEntries();
    const nextGenerations = [...packages].map(([id, entry]) => `${id}\0${entry.unavailable ? "" : entry.ref.packageDigest}`).join("\n");
    if (!isDeepStrictEqual(entries, snapshot.entries) || nextGenerations !== generations) {
      generations = nextGenerations;
      snapshot = { revision: snapshot.revision + 1, entries };
      for (const listener of listeners) listener(snapshot);
    }
    for (const [id, reason] of [...lost, ...updated]) await Promise.resolve(deps.closeProvider(id as ProviderId, reason)).catch((cause: unknown) => log(`closing ${id} failed: ${String(cause)}`));
  }

  /* Rebuilds never overlap: a change during one runs one more afterwards, so the last state always wins. */
  async function rebuild(): Promise<void> {
    if (flight) { again = true; return flight; }
    flight = (async () => { do { again = false; await build(); } while (again); })().finally(() => { flight = null; });
    return flight;
  }

  snapshot = { revision: 0, entries: snapshotEntries() };
  return {
    rebuild,
    catalog: () => catalog,
    snapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    resolveBackend(id) {
      const builtin = deps.builtins.get(id);
      if (builtin) return builtin;
      const entry = packages.get(id);
      if (!entry || entry.unavailable || !deps.factory) return null;
      const key = `${id}\0${entry.ref.packageDigest}`;
      let backend = backends.get(key);
      if (!backend) backends.set(key, backend = deps.factory(entry.descriptor, entry.ref));
      return backend;
    },
    packageOf(id) {
      const entry = packages.get(id);
      return entry && !entry.unavailable ? entry.ref : null;
    },
  };
}
