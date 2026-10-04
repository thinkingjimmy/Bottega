/**
 * [INPUT]: Depends on the Provider contract types, the shared Provider catalog and its renderer snapshot, and the BackendDescriptor type.
 * [OUTPUT]: Provides ProviderBackend (a backend whose id is any bounded Provider id), ProviderPackageRef, DescriptorBackendFactory, ProviderCatalogPort (with packageOf, an available package Provider's bridge pin), providerCatalogSnapshotSchema (the snapshot's shape, main-side so the preload's leaf has no zod), builtinProviderCatalogPort (the four built-ins, never changing), catalogSnapshot, providerCatalogPublisher / ProviderCatalogSnapshotInvalid (a snapshot that breaks the schema is never sent: the read refuses by name, a push is dropped, both logged) and registerProviderCatalog (the main window's snapshot read and change push through it), and installProviderCatalog / providerCatalog / composedProviderCatalog (null before composition).
 * [POS]: The dynamic Provider catalog's contract (TASK-11 d4-0). packages/package-catalog.ts implements the package-aware port (d4a); d4b's DescriptorBackend is what `resolveBackend` answers for a package id; S3 and S4 read `catalog()` and `snapshot()` instead of a closed id list.
 */
import type { ProviderDescriptor, ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import { builtinProviderCatalog, type ProviderCatalog } from "../../../../shared/providers/catalog";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { providerDescriptorSchema, providerIdSchema } from "@ai-chat/cloud-protocol/contracts/provider";
import { PROVIDER_CATALOG_CHANNEL, PROVIDER_UNAVAILABLE_REASONS, type ProviderCatalogSnapshot } from "../../../../shared/providers/catalog-ipc";
import { rendererIpc } from "../../registration/ipc-registrar";
import type { BackendDescriptor } from "../../backends/types";

/* The four built-ins plus installed Provider packages; the bound keeps a snapshot finite whatever is installed. */
const PROVIDER_CATALOG_LIMIT = 32;

/** The snapshot's shape, kept in main so the shared leaf the preload imports carries no zod. */
export const providerCatalogSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  entries: z.array(z.object({
    id: providerIdSchema,
    displayName: providerDescriptorSchema.shape.displayName,
    source: z.enum(["builtin", "package"]),
    available: z.boolean(),
    unavailableReason: z.enum(PROVIDER_UNAVAILABLE_REASONS).optional(),
    capabilities: providerDescriptorSchema.shape.capabilities,
    purposes: providerDescriptorSchema.shape.purposes,
    configFields: providerDescriptorSchema.shape.configFields,
  }).strict().refine(entry => entry.available === !entry.unavailableReason, "an unavailable entry names its reason, an available one none"))
    .max(PROVIDER_CATALOG_LIMIT)
    .refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length, "one entry per Provider"),
}).strict() satisfies z.ZodType<ProviderCatalogSnapshot>;

export type { ProviderBackend } from "../../backends/types";
import type { ProviderBackend } from "../../backends/types";

/** An admitted, active Provider package as main knows it; its bridge module is loaded only by the bridge, from verified bytes. */
export type ProviderPackageRef = Readonly<{ installIdentity: string; root: string; packageDigest: string;
  bridge: Readonly<{ path: string; sha256: string }> }>;

/** Main's side of a package Provider, driven only by its descriptor (d4b); package code never runs in main. */
export type DescriptorBackendFactory = (descriptor: ProviderDescriptor, pkg: ProviderPackageRef) => ProviderBackend;

export type ProviderCatalogPort = Readonly<{
  /** The current catalog: built-ins, then active Provider packages. Ask again after a change; an entry is never mutated. */
  catalog(): ProviderCatalog;
  /** What the renderer lists; a package Provider that has gone stays as unavailable with its reason. */
  snapshot(): ProviderCatalogSnapshot;
  /** Called with every new snapshot; returns the unsubscribe. */
  subscribe(listener: (snapshot: ProviderCatalogSnapshot) => void): () => void;
  /** Host code for a built-in, the DescriptorBackend of an active package's Provider, else null: an id never resolves to another backend. */
  resolveBackend(id: string): ProviderBackend | null;
  /** An available package Provider's package (its bridge module pin); null for a built-in or anything unavailable. */
  packageOf(id: string): ProviderPackageRef | null;
}>;

/** The renderer's view of a catalog: every entry available (unavailable ones are added by the package-aware port). */
export function catalogSnapshot(catalog: ProviderCatalog, revision: number, source: (id: ProviderId) => "builtin" | "package"): ProviderCatalogSnapshot {
  return { revision, entries: catalog.entries().map(({ id, descriptor }) => ({ id, displayName: descriptor.displayName, source: source(id),
    available: true, capabilities: descriptor.capabilities, purposes: descriptor.purposes, configFields: descriptor.configFields })) };
}

/** The four built-ins only; the registry is passed in so this contract imports no Provider's code. */
export function builtinProviderCatalogPort(builtins: ReadonlyMap<string, BackendDescriptor>): ProviderCatalogPort {
  const snapshot = catalogSnapshot(builtinProviderCatalog, 0, () => "builtin");
  return {
    catalog: () => builtinProviderCatalog,
    snapshot: () => snapshot,
    subscribe: () => () => {},
    resolveBackend: id => builtins.get(id) ?? null,
    packageOf: () => null,
  };
}

export class ProviderCatalogSnapshotInvalid extends Error {
  constructor(detail: string) { super(`The Provider catalog snapshot is invalid and was not sent: ${detail.slice(0, 500)}`); this.name = "ProviderCatalogSnapshotInvalid"; }
}

/**
 * Main validates what it sends, so the renderer reads the snapshot as its type and never re-parses it. A snapshot that breaks the schema
 * is never sent: the read refuses with a named error and a push is dropped, both logged.
 */
export function providerCatalogPublisher(port: ProviderCatalogPort, send: (snapshot: ProviderCatalogSnapshot) => void,
  log: (message: string) => void = message => console.error(`[providers] ${message}`)) {
  const checked = (snapshot: ProviderCatalogSnapshot) => {
    const parsed = providerCatalogSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) throw new ProviderCatalogSnapshotInvalid(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    return parsed.data;
  };
  return {
    read() {
      try { return checked(port.snapshot()); } catch (cause) { log((cause as Error).message); throw cause; }
    },
    release: port.subscribe(snapshot => {
      try { send(checked(snapshot)); } catch (cause) { log((cause as Error).message); }
    }),
  };
}

/** The main window's read of the catalog and its change push (d4a); App windows do not list Providers. */
export function registerProviderCatalog(port: ProviderCatalogPort, window: BrowserWindow, rendererUrl: string) {
  const publisher = providerCatalogPublisher(port, snapshot => { if (!window.isDestroyed()) window.webContents.send(PROVIDER_CATALOG_CHANNEL.changed, snapshot); });
  rendererIpc(rendererUrl, "the Provider catalog is available to the main window only")
    .roles("main")
    .handle(PROVIDER_CATALOG_CHANNEL.snapshot, (...args) => {
      if (args.length) throw new Error("The Provider catalog snapshot accepts no arguments");
      return publisher.read();
    });
  window.once("closed", publisher.release);
}

let installed: ProviderCatalogPort | null = null;
/** The composition root installs this process's catalog once; null clears it (tests). */
export function installProviderCatalog(port: ProviderCatalogPort | null) { installed = port; }
/** The composed catalog, or null before composition (the Provider resolver then answers the built-ins alone). */
export function composedProviderCatalog(): ProviderCatalogPort | null { return installed; }
export function providerCatalog(): ProviderCatalogPort {
  if (!installed) throw new Error("No Provider catalog is composed in this process.");
  return installed;
}
