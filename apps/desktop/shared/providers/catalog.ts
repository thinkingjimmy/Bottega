/**
 * [INPUT]: Depends on the Provider contract's bounded id and descriptor schema, the built-in descriptors, their CLI facts and host traits
 * [OUTPUT]: Provides createProviderCatalog (entries — descriptor with CLI facts, host traits — in a requested order, a lookup that answers `unknown` instead of throwing, the default provider), builtinProviderCatalog, DEFAULT_PROVIDER_ID, knownBackend (the one narrowing from a catalog id to a runnable backend, null when unknown) effectiveProvider (a stored choice read as {stored, effective, storedState}, never undefined) and effectiveDefaultProvider (the default Agent: a listed package Provider reads back as itself), providerIpcTarget / withProviderTarget (an IPC channel's received id as a backend or a ProviderIpcRefusal: malformed before any lookup, unknown by name)
 * [POS]: The single host Provider catalog (TASK-11 (a), provider-catalog.md §2.1). Callers outside providers/<id>/ ask it instead of naming ids; traits and implementation hooks join each entry in later slices
 */
import { agentBackendIdSchema } from "../platform/agent-schema";
import { providerDescriptorSchema, providerIdSchema, type ProviderDescriptor, type ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import { BUILTIN_PROVIDER_DESCRIPTORS } from "./builtin";
import { BUILTIN_PROVIDER_FACTS } from "./builtin-facts";
import { providerTraits, type ProviderTraits } from "./traits";
import type { AgentBackendId } from "../ipc/agent/agent-ipc";
import type { ProviderIpcRefusal } from "./catalog-ipc";

export type CatalogEntry = Readonly<{ id: ProviderId; descriptor: ProviderDescriptor; traits: ProviderTraits }>;
/* An id this host does not ship, or one outside the bounded form, is `unknown`: a display renders a neutral fallback, an
   execution boundary refuses with `unknown-provider`. Neither ever throws or reads as "capability absent". */
export type CatalogLookup = Readonly<{ known: true; entry: CatalogEntry }> | Readonly<{ known: false; id: string }>;

export type ProviderCatalog = {
  /** Every entry, those named in `order` first (in that order, unknown and repeated ids skipped), then the rest in catalog order. */
  entries(order?: readonly string[]): readonly CatalogEntry[];
  get(id: string): CatalogLookup;
  /** The first installed entry in `order`, else the first entry in `order`. */
  defaultProvider(installed?: (id: ProviderId) => boolean, order?: readonly string[]): ProviderId;
};

export function createProviderCatalog(descriptors: readonly ProviderDescriptor[]): ProviderCatalog {
  const byId = new Map<string, CatalogEntry>();
  for (const descriptor of descriptors) {
    if (byId.has(descriptor.providerId)) throw new Error(`duplicate provider ${descriptor.providerId}`);
    byId.set(descriptor.providerId, Object.freeze({ id: providerIdSchema.parse(descriptor.providerId), descriptor, traits: providerTraits(descriptor.providerId) }));
  }
  if (!byId.size) throw new Error("a provider catalog needs at least one entry");
  const all = [...byId.values()];
  const entries = (order: readonly string[] = []) => {
    const named = [...new Set(order)].flatMap(id => byId.get(id) ?? []);
    return [...named, ...all.filter(entry => !named.includes(entry))];
  };
  return {
    entries,
    get: id => {
      const entry = providerIdSchema.safeParse(id).success ? byId.get(id) : undefined;
      return entry ? { known: true, entry } : { known: false, id };
    },
    defaultProvider: (installed = () => true, order) => {
      const ordered = entries(order);
      return (ordered.find(entry => installed(entry.id)) ?? ordered[0]!).id;
    },
  };
}

/* The built-ins' CLI facts join their descriptors here, not in builtin.ts, which the provider bridge bundles for the tool schemas. */
export const builtinProviderCatalog = createProviderCatalog(BUILTIN_PROVIDER_DESCRIPTORS.map(descriptor =>
  providerDescriptorSchema.parse({ ...descriptor, ...(Object.hasOwn(BUILTIN_PROVIDER_FACTS, descriptor.providerId) ? BUILTIN_PROVIDER_FACTS[descriptor.providerId] : {}) })));

/**
 * TASK-11 S3: the one narrowing from a stored or received id to a backend this host can run today. Unknown or malformed ids, and a
 * catalog entry no built-in backend serves yet, are null: a caller reads them as unavailable, never as a throw or a cast.
 */
export function knownBackend(catalog: ProviderCatalog, id: string): AgentBackendId | null {
  const lookup = catalog.get(id);
  if (!lookup.known) return null;
  const backend = agentBackendIdSchema.safeParse(lookup.entry.id);
  return backend.success ? backend.data : null;
}

/** The provider a default parameter, a fresh setting or a Chat created without a choice starts from: the catalog's first entry. */
export const DEFAULT_PROVIDER_ID = builtinProviderCatalog.defaultProvider() as AgentBackendId;

export type EffectiveProvider = Readonly<{ stored: string | null; effective: AgentBackendId; storedState: "known" | "unknown" | "absent" }>;

/** A stored Provider choice read now: a gone or fifth id stays as stored and reads as unavailable; `effective` is never undefined. */
export function effectiveProvider(stored: string | null | undefined, catalog: ProviderCatalog, order: readonly string[]): EffectiveProvider {
  const value = stored ?? null, direct = value === null ? null : knownBackend(catalog, value);
  if (direct) return { stored: value, effective: direct, storedState: "known" };
  const fallback = order.map(id => knownBackend(catalog, id)).find((id): id is AgentBackendId => id !== null)
    ?? knownBackend(catalog, catalog.defaultProvider()) ?? DEFAULT_PROVIDER_ID;
  return { stored: value, effective: fallback, storedState: value === null ? "absent" : "unknown" };
}

/**
 * TASK-11 S3-c: what an id-taking IPC channel does with the id it received. A malformed id is refused before any lookup or path; a
 * well-formed id no runnable backend answers to is named; neither is ever a throw or a cast.
 */
export function providerIpcTarget(raw: unknown, catalog: ProviderCatalog): Readonly<{ backend: AgentBackendId }> | ProviderIpcRefusal {
  const id = providerIdSchema.safeParse(raw);
  if (!id.success) return { status: "invalid-input" };
  const backend = knownBackend(catalog, id.data);
  return backend ? { backend } : { status: "unknown-provider", id: id.data };
}

/** Runs `run` with the backend an IPC channel received, or answers its refusal; the channel handlers' one shape for an id argument. */
export function withProviderTarget<T>(raw: unknown, catalog: ProviderCatalog, run: (backend: AgentBackendId) => T): T | ProviderIpcRefusal {
  const target = providerIpcTarget(raw, catalog);
  return "backend" in target ? run(target.backend) : target;
}

/**
 * The default Agent read now (TASK-11 S3-d): a stored id the live catalog lists (a built-in, or a package Provider while it is available)
 * reads back as itself; otherwise the effective built-in, as effectiveProvider reads it. The stored value is always kept. The title Agent
 * stays on effectiveProvider: a package Provider has no title path this period.
 */
export function effectiveDefaultProvider(stored: string | null | undefined, catalog: ProviderCatalog, order: readonly string[]):
  Readonly<{ stored: string | null; effective: ProviderId; storedState: EffectiveProvider["storedState"] }> {
  const value = stored ?? null;
  if (value !== null && catalog.get(value).known) return { stored: value, effective: value, storedState: "known" };
  return effectiveProvider(value, catalog, order);
}

