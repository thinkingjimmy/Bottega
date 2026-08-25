/**
 * [INPUT]: Depends on reliable PricingCatalog and usage-merge UsageBuckets, UsageSourceId
 * [OUTPUT]: Provides unchanging PricingTable, Unified Ending Law Model Price by four barrels of dollars plus
 * [POS]: The use/pricing synchronous purity core; The key exists as an end, and null is a first-order cancellation rather than a fallback signal
 */

import type { UsageSourceId } from "../../../../shared/usage-ipc";
import type { UsageBuckets } from "../usage-merge";
import type { ModelRates, PricingCatalog } from "./catalog";

export type PricingTable = Readonly<PricingCatalog>;

const OPENAI_ALIASES: Record<string, string> = {
  "gpt-5.6": "gpt-5.6-sol",
};

function has<T extends object>(value: T, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function withoutDateSuffix(model: string) {
  return model.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "");
}

function providerLookup(
  models: Record<string, ModelRates | null>,
  model: string,
  aliases: Record<string, string> = {}
): ModelRates | null | undefined {
  if (has(models, model)) return models[model];
  const alias = aliases[model];
  if (alias !== undefined) {
    return has(models, alias) ? models[alias] : null;
  }
  return undefined;
}

function kimiLookup(table: PricingTable, model: string) {
  if (has(table.kimiAliases, model)) {
    const target = table.kimiAliases[model];
    if (target === null) return null;
    return has(table.providers.moonshotai, target)
      ? table.providers.moonshotai[target]
      : null;
  }
  if (has(table.providers.moonshotai, model)) {
    return table.providers.moonshotai[model];
  }
  return undefined;
}

function lookupOnce(
  table: PricingTable,
  source: UsageSourceId,
  model: string
) {
  if (source === "claude") {
    return providerLookup(table.providers.anthropic, model);
  }
  if (source === "codex") {
    return providerLookup(table.providers.openai, model, OPENAI_ALIASES);
  }
  return kimiLookup(table, model);
}

export function modelRates(
  table: PricingTable,
  source: UsageSourceId,
  model: string | null
): ModelRates | null {
  if (!model) return null;
  const exact = lookupOnce(table, source, model);
  if (exact !== undefined) return exact;

  const unscoped = source === "kimi" && model.includes("/")
    ? model.slice(model.lastIndexOf("/") + 1)
    : model;
  if (unscoped !== model) {
    const scoped = lookupOnce(table, source, unscoped);
    if (scoped !== undefined) return scoped;
  }

  const stripped = withoutDateSuffix(unscoped);
  if (stripped === unscoped) return null;
  return lookupOnce(table, source, stripped) ?? null;
}

export function buildTable(catalog: PricingCatalog): PricingTable {
  return structuredClone(catalog);
}

export function priceBuckets(rates: ModelRates, buckets: UsageBuckets) {
  return (
    rates.input * buckets.input +
    rates.cacheRead * buckets.cacheRead +
    rates.cacheWrite * buckets.cacheWrite +
    rates.output * buckets.output
  ) / 1_000_000;
}

export function priceEvent(
  table: PricingTable,
  source: UsageSourceId,
  model: string | null,
  buckets: UsageBuckets | null
): number | null {
  if (!buckets) return null;
  const rates = modelRates(table, source, model);
  return rates ? priceBuckets(rates, buckets) : null;
}
