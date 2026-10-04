/**
 * [INPUT]: Depends on the bounded Provider id, the provider catalog's one narrowing and effectiveProvider, and the Chat option schemas.
 * [OUTPUT]: Provides the stored form of the settings file's Provider fields (readProviderFields: tolerant per element, bounded), their
 *           projection onto AppSettings (projectProviderFields: the full order via projectProviderOrder, maps and choices for runnable
 *           backends only), the write of the three choices straight onto the stored form (patchProviderChoices: any well-formed id, an
 *           order that never loses an id) and of the two maps (mergeProviderMaps: untouched keys kept), plus PROVIDER_FIELD_LIMITS and PROVIDER_ORDER_LIMIT (the order's one bound: 32 non-built-in ids plus every built-in, on read, write and projection).
 * [POS]: TASK-11 S3-a: settings.json keeps a Provider this build does not know (a fifth id, or one gone since) exactly as stored and reads
 *        it as unavailable; a malformed id is dropped alone before any key or path, and only structural corruption fails the file.
 */
import { providerIdSchema } from "@ai-chat/cloud-protocol/contracts/provider-id-schema";
import type { AppSettings, DefaultChatOptionsByBackend } from "../../../shared/ipc/settings/settings-ipc";
import { builtinProviderCatalog, effectiveDefaultProvider, knownBackend, type ProviderCatalog } from "../../../shared/providers/catalog";
import { builtinAgent, turnOptionsSchema } from "../../../shared/chat-agent/options";

export const PROVIDER_FIELD_LIMITS = Object.freeze({ entries: 32, opaqueBytes: 4_096, opaqueTotalBytes: 131_072 });
/* The order's one bound, on read, on write and in the projection (review 0929-2 N02): at most `entries` ids that are not built-ins, and
   every built-in besides. The projection only ever appends built-ins, so it never outgrows it; an unknown id is never dropped to fit. */
export const PROVIDER_ORDER_LIMIT = PROVIDER_FIELD_LIMITS.entries + builtinProviderCatalog.entries().length;
const withinOrderBound = (order: readonly string[]) => order.filter(id => !builtinAgent(id)).length <= PROVIDER_FIELD_LIMITS.entries;
export type StoredProviderFields = {
  titleAgent: string | null;
  titleModelByBackend: Record<string, string | null>;
  /* A known Provider's value is Chat options; an unknown one's is opaque: never interpreted, merged or sent over IPC, only kept. */
  defaultChatOptionsByBackend: Record<string, unknown>;
  defaultBackend: string | null;
  providerOrder: string[];
};
export type ProjectedProviderFields = Pick<AppSettings, "titleAgent" | "titleModelByBackend" | "defaultChatOptionsByBackend" | "defaultBackend" | "providerOrder">;
type Warn = (message: string) => void;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && providerIdSchema.safeParse(value).success;
/* A malformed id may be a path or junk: the warning names where it was and how long it is, never the value. */
const dropped = (warn: Warn, field: string, position: number, value: unknown) =>
  warn(`[settings] ${field}: dropped a malformed Provider id at position ${position} (length ${typeof value === "string" ? value.length : typeof value})`);

function readId(value: unknown, field: string, warn: Warn): string | null {
  if (value === undefined || value === null) return null;
  if (validId(value)) return value;
  dropped(warn, field, 0, value);
  return null;
}
function readMap<T>(value: unknown, field: string, warn: Warn, entry: (value: unknown, id: string) => T | undefined): Record<string, T> {
  if (!isRecord(value)) throw new Error(`settings ${field} must be an object`);
  const out: Record<string, T> = {};
  Object.entries(value).forEach(([id, item], position) => {
    if (!validId(id)) { dropped(warn, field, position, id); return; }
    if (Object.keys(out).length >= PROVIDER_FIELD_LIMITS.entries) { warn(`[settings] ${field}: more than ${PROVIDER_FIELD_LIMITS.entries} Providers; the rest are dropped`); return; }
    const kept = entry(item, id);
    if (kept !== undefined) out[id] = kept;
  });
  return out;
}

export function readProviderFields(settings: Record<string, unknown>, warn: Warn): StoredProviderFields {
  let opaqueTotal = 0;
  const order: string[] = [];
  const rawOrder = settings.providerOrder;
  if (rawOrder !== undefined && !Array.isArray(rawOrder)) throw new Error("settings providerOrder must be an array");
  (rawOrder as unknown[] | undefined)?.forEach((id, position) => {
    if (!validId(id)) { dropped(warn, "providerOrder", position, id); return; }
    if (order.includes(id)) return;
    if (!builtinAgent(id) && !withinOrderBound([...order, id])) { warn(`[settings] providerOrder: more than ${PROVIDER_FIELD_LIMITS.entries} Providers that are not built-ins; the rest are dropped`); return; }
    order.push(id);
  });
  return {
    titleAgent: readId(settings.titleAgent, "titleAgent", warn),
    titleModelByBackend: readMap(settings.titleModelByBackend, "titleModelByBackend", warn, (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("settings titleModelByBackend holds an invalid model");
      return value;
    }),
    defaultChatOptionsByBackend: readMap(settings.defaultChatOptionsByBackend, "defaultChatOptionsByBackend", warn, (value) => {
      const bytes = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
      if (bytes > PROVIDER_FIELD_LIMITS.opaqueBytes) { warn(`[settings] defaultChatOptionsByBackend: a value over ${PROVIDER_FIELD_LIMITS.opaqueBytes} bytes is dropped (length ${bytes})`); return undefined; }
      if (opaqueTotal + bytes > PROVIDER_FIELD_LIMITS.opaqueTotalBytes) { warn("[settings] defaultChatOptionsByBackend: over the total bound; the rest are dropped"); return undefined; }
      opaqueTotal += bytes;
      return value;
    }),
    defaultBackend: readId(settings.defaultBackend, "defaultBackend", warn),
    providerOrder: order,
  };
}

/** The order AppSettings carries (S3-c): every stored id in the user's order, then each runnable Provider the order does not name yet. */
export function projectProviderOrder(order: readonly string[], catalog: ProviderCatalog): string[] {
  const runnable = catalog.entries().flatMap(entry => knownBackend(catalog, entry.id) ?? []);
  return [...order, ...runnable.filter(id => !order.includes(id))];
}

/**
 * AppSettings' view: the full order (a picker narrows it to runnable ones), maps and choices for runnable backends only, and a stored
 * unknown choice standing in with the first runnable one in the user's order.
 */
export function projectProviderFields(stored: StoredProviderFields, catalog: ProviderCatalog, warn: Warn): ProjectedProviderFields {
  const known = (id: string) => knownBackend(catalog, id);
  const providerOrder = projectProviderOrder(stored.providerOrder, catalog);
  const titleModelByBackend: Partial<Record<string, string | null>> = {};
  for (const [id, model] of Object.entries(stored.titleModelByBackend)) { if (catalog.get(id).known) titleModelByBackend[id] = model; }
  const defaultChatOptionsByBackend: DefaultChatOptionsByBackend = {};
  for (const [id, value] of Object.entries(stored.defaultChatOptionsByBackend)) {
    const backend = known(id); if (!backend) continue;
    const options = turnOptionsSchema.safeParse(value);
    if (options.success && options.data.backend === backend) (defaultChatOptionsByBackend as Record<string, unknown>)[backend] = options.data;
    else warn(`[settings] defaultChatOptionsByBackend: invalid options for a known Provider are dropped (position ${Object.keys(stored.defaultChatOptionsByBackend).indexOf(id)})`);
  }
  return {
    titleAgent: effectiveDefaultProvider(stored.titleAgent, catalog, providerOrder).effective,
    titleModelByBackend,
    defaultChatOptionsByBackend,
    defaultBackend: effectiveDefaultProvider(stored.defaultBackend, catalog, providerOrder).effective,
    providerOrder,
  };
}

export type ProviderChoicesPatch = Partial<Record<"titleAgent" | "defaultBackend", string> & { providerOrder: readonly string[] }>;

/**
 * A write of the three choices (S3-c), always straight onto the stored form: any well-formed id is kept as chosen, whether or not it can
 * run here, and an order never loses an id. One the new order leaves out keeps its stored position when it cannot run here (a picker never
 * saw it) and goes to the end when it can (as a partial order always has). A malformed id fails the write.
 */
export function patchProviderChoices(stored: StoredProviderFields, patch: ProviderChoicesPatch, catalog: ProviderCatalog): StoredProviderFields {
  const id = (value: unknown, field: string) => {
    if (!validId(value)) throw new Error(`settings ${field} must be a Provider id`);
    return value;
  };
  let providerOrder = stored.providerOrder;
  if (patch.providerOrder !== undefined) {
    if (!Array.isArray(patch.providerOrder) || patch.providerOrder.length > PROVIDER_ORDER_LIMIT) throw new Error("settings providerOrder must be a bounded list");
    const next = [...new Set(patch.providerOrder.map(value => id(value, "providerOrder")))];
    const omitted = stored.providerOrder.filter(kept => !next.includes(kept));
    stored.providerOrder.forEach((kept, index) => {
      if (omitted.includes(kept) && !knownBackend(catalog, kept)) next.splice(Math.min(index, next.length), 0, kept);
    });
    providerOrder = [...next, ...omitted.filter(kept => knownBackend(catalog, kept))];
    /* A write that would outgrow the bound is refused whole; it never trims someone's unknown ids to fit. */
    if (!withinOrderBound(providerOrder)) throw new Error("settings providerOrder must be a bounded list");
  }
  return {
    ...stored,
    ...(patch.titleAgent !== undefined ? { titleAgent: id(patch.titleAgent, "titleAgent") } : {}),
    ...(patch.defaultBackend !== undefined ? { defaultBackend: id(patch.defaultBackend, "defaultBackend") } : {}),
    providerOrder,
  };
}

/**
 * A write of the two maps onto the stored form: a key the change did not touch keeps its stored value, so an unknown Provider's entry
 * survives every write. The choices are never taken from the projection (it holds the stand-in, not the stored choice).
 */
export function mergeProviderMaps(stored: StoredProviderFields, before: ProjectedProviderFields, after: ProjectedProviderFields): StoredProviderFields {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const mergeMap = <T>(base: Record<string, T>, previous: Record<string, T>, next: Record<string, T>) => {
    const out = { ...base };
    for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (same(previous[id], next[id])) continue;
      if (next[id] === undefined) delete out[id]; else out[id] = next[id]!;
    }
    return out;
  };
  return {
    ...stored,
    titleModelByBackend: mergeMap(stored.titleModelByBackend, before.titleModelByBackend as Record<string, string | null>, after.titleModelByBackend as Record<string, string | null>),
    defaultChatOptionsByBackend: mergeMap(stored.defaultChatOptionsByBackend, before.defaultChatOptionsByBackend as Record<string, unknown>, after.defaultChatOptionsByBackend as Record<string, unknown>),
  };
}
