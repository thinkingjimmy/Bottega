/**
 * [INPUT]: Depends on the Provider contract's types only (no zod: the preload imports this leaf).
 * [OUTPUT]: Provides PROVIDER_CATALOG_CHANNEL, PROVIDER_UNAVAILABLE_REASONS and ProviderCatalogSnapshot (the catalog as the renderer receives it; its schema is main's), ProviderCatalogBridge (`window.providerCatalog`, the main window's preload surface), ProviderIpcRefusal (what every id-taking IPC channel answers for a malformed or unknown Provider id) and isProviderIpcRefusal (the renderer clients' check on an answer).
 * [POS]: The Provider catalog's IPC contracts (TASK-11 d4-0, contract only): the renderer's view of the dynamic catalog, and the one refusal shape S3's channels and the usage limits share. Main publishes it (d4a); the renderer lists iterate it and never a closed id list (S4). A Provider a package supplied that has gone stays listed as unavailable, never silently dropped.
 */
import type { ProviderDescriptor, ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";

export const PROVIDER_CATALOG_CHANNEL = {
  /** A read: the current snapshot. */
  snapshot: "providers:catalog-snapshot",
  /** Main → renderer: a new snapshot, sent on every revision. */
  changed: "providers:catalog-changed",
} as const;

/** Why a listed Provider cannot be chosen now; a built-in is never unavailable here (its own setup state says why it cannot run). */
export const PROVIDER_UNAVAILABLE_REASONS = ["package-disabled", "package-removed", "package-refused", "trust-refused"] as const;

/** The catalog as the renderer receives it. Main validates its shape (providerCatalogSnapshotSchema in providers/host/catalog.ts);
    this leaf stays free of zod because the preload imports it. */
export type ProviderCatalogSnapshot = Readonly<{
  /** Increases with every change; a receiver ignores a revision it has already passed. */
  revision: number;
  entries: readonly Readonly<{
    id: ProviderId;
    displayName: string;
    source: "builtin" | "package";
    available: boolean;
    /** Present exactly when the entry is unavailable. */
    unavailableReason?: (typeof PROVIDER_UNAVAILABLE_REASONS)[number];
    capabilities: ProviderDescriptor["capabilities"];
    purposes: ProviderDescriptor["purposes"];
    /** Each configuration field and when a change to it takes effect (next turn, session creation, process start). */
    configFields: ProviderDescriptor["configFields"];
  }>[];
}>;

/** A malformed id is refused before any lookup or path; a well-formed id no Provider answers to is named, never thrown as an Error. */
export type ProviderIpcRefusal = Readonly<{ status: "invalid-input" }> | Readonly<{ status: "unknown-provider"; id: ProviderId }>;

/** The renderer clients' check on an answer that may be a refusal instead of the channel's value. A plain shape check that lives in
    this zod-free leaf, so the renderer entry never pulls in the catalog (its traits reach Base compute, which must stay lazy). */
export function isProviderIpcRefusal(value: unknown): value is ProviderIpcRefusal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = (value as { status?: unknown }).status;
  return status === "invalid-input" || (status === "unknown-provider" && typeof (value as { id?: unknown }).id === "string");
}

/** The main window's preload surface (`window.providerCatalog`): the current snapshot and every later one. */
export type ProviderCatalogBridge = Readonly<{
  snapshot(): Promise<ProviderCatalogSnapshot>;
  onChanged(listener: (snapshot: ProviderCatalogSnapshot) => void): () => void;
}>;
