/**
 * [INPUT]: Depends on Node crypto and models.dev `/api.json` The incredible provider/model data
 * [OUTPUT]: Provides PricingCatalog Conversion, three-dimensional rate calibration, stable abstract, overlay and seed integrity checks
 * [POS]: The only directory of usage/pricing converts boundaries; External JSON is narrowed and runs on a trusted catalog
 */

import { createHash } from "node:crypto";

export type ModelRates = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

export type PricingCatalog = {
  providers: {
    anthropic: Record<string, ModelRates | null>;
    openai: Record<string, ModelRates | null>;
    moonshotai: Record<string, ModelRates | null>;
  };
  kimiAliases: Record<string, string | null>;
};

export type CatalogConversion = {
  catalog: PricingCatalog;
  catalogDigest: string;
  tableDigest: string;
};

export type CatalogMode = "runtime" | "seed";

const PROVIDERS = ["anthropic", "openai", "moonshotai"] as const;
const KIMI_PROVIDER = "kimi-for-coding";

/* 上游 API 会剥掉 base_model；这两条由 models.dev 上游 TOML 证据人工钉住。 */
const KIMI_OVERRIDES: Record<string, string> = {
  "kimi-for-coding-highspeed": "kimi-k2.7-code-highspeed",
  "k3-256k": "kimi-k3",
};

/* 只有显式列入这里的订阅模型才允许生成 null 撤销态。 */
const KIMI_EXEMPTIONS = new Set<string>();

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function own(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function rate(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 不是有限非负价格`);
  }
  return value;
}

function convertModel(model: unknown, label: string): ModelRates | null {
  const item = record(model);
  if (!item) throw new Error(`${label} 模型条目格式无效`);
  if (!own(item, "cost")) return null;
  const cost = record(item.cost);
  if (!cost || !own(cost, "input") || !own(cost, "output")) {
    throw new Error(`${label} cost 缺少 input/output`);
  }
  const input = rate(cost.input, `${label}.input`);
  const output = rate(cost.output, `${label}.output`);
  return {
    input,
    cacheRead: own(cost, "cache_read")
      ? rate(cost.cache_read, `${label}.cache_read`)
      : input,
    cacheWrite: own(cost, "cache_write")
      ? rate(cost.cache_write, `${label}.cache_write`)
      : input,
    output,
  };
}

function providerModels(raw: Record<string, unknown>, provider: string) {
  const value = record(raw[provider]);
  if (!value) return null;
  const models = record(value.models);
  return models && Object.keys(models).length > 0 ? models : null;
}

function convertProvider(
  raw: Record<string, unknown>,
  provider: (typeof PROVIDERS)[number]
) {
  const models = providerModels(raw, provider);
  if (!models) return {};
  return Object.fromEntries(
    Object.entries(models)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, model]) => [id, convertModel(model, `${provider}.${id}`)])
  );
}

function modelName(model: unknown) {
  const item = record(model);
  return item && typeof item.name === "string" && item.name.trim()
    ? item.name.trim()
    : null;
}

function buildKimiAliases(raw: Record<string, unknown>, mode: CatalogMode) {
  const subscribed = providerModels(raw, KIMI_PROVIDER);
  if (!subscribed) {
    if (mode === "seed") throw new Error(`${KIMI_PROVIDER} provider 缺失或为空`);
    return {};
  }
  const moonshot = providerModels(raw, "moonshotai");
  if (!moonshot) throw new Error("moonshotai provider 缺失或为空");

  const byName = new Map<string, string[]>();
  for (const [id, model] of Object.entries(moonshot)) {
    const name = modelName(model);
    if (!name) continue;
    const matches = byName.get(name) ?? [];
    matches.push(id);
    byName.set(name, matches);
  }

  const aliases: Record<string, string | null> = {};
  for (const [id, model] of Object.entries(subscribed).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const name = modelName(model);
    const matches = name ? (byName.get(name) ?? []) : [];
    if (matches.length === 1) {
      aliases[id] = matches[0];
      continue;
    }
    const override = KIMI_OVERRIDES[id];
    if (override) {
      aliases[id] = override;
      continue;
    }
    if (KIMI_EXEMPTIONS.has(id)) {
      aliases[id] = null;
      continue;
    }
    throw new Error(
      `${KIMI_PROVIDER}.${id} 无法唯一归属（name=${name ?? "<missing>"}, matches=${matches.length}）`
    );
  }
  return aliases;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  const item = record(value);
  if (!item) return value;
  return Object.fromEntries(
    Object.keys(item)
      .sort()
      .map((key) => [key, normalize(item[key])])
  );
}

export function stableDigest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");
}

export function tableDigest(catalog: PricingCatalog) {
  return stableDigest(catalog);
}

export function catalogDigest(catalog: PricingCatalog, provenance: unknown) {
  return stableDigest({ catalog, provenance });
}

export function assertSeedCatalog(catalog: PricingCatalog) {
  for (const provider of PROVIDERS) {
    if (Object.keys(catalog.providers[provider]).length === 0) {
      throw new Error(`seed 缺少 ${provider} provider`);
    }
  }
  if (Object.keys(catalog.kimiAliases).length === 0) {
    throw new Error("seed 缺少 Kimi 订阅模型归属");
  }
  for (const [alias, target] of Object.entries(catalog.kimiAliases)) {
    if (target === null) continue;
    if (!own(catalog.providers.moonshotai, target)) {
      throw new Error(`Kimi alias ${alias} 的目标 ${target} 不存在`);
    }
    if (catalog.providers.moonshotai[target] === null) {
      throw new Error(`Kimi alias ${alias} 的目标 ${target} 是 tombstone`);
    }
  }
}

export function convertModelsDev(
  value: unknown,
  mode: CatalogMode = "runtime"
): CatalogConversion {
  const raw = record(value);
  if (!raw) throw new Error("models.dev catalog 格式无效");
  const catalog: PricingCatalog = {
    providers: {
      anthropic: convertProvider(raw, "anthropic"),
      openai: convertProvider(raw, "openai"),
      moonshotai: convertProvider(raw, "moonshotai"),
    },
    kimiAliases: buildKimiAliases(raw, mode),
  };
  if (mode === "seed") assertSeedCatalog(catalog);
  const provenance = Object.fromEntries(
    [...PROVIDERS, KIMI_PROVIDER].map((provider) => [
      provider,
      providerModels(raw, provider),
    ])
  );
  return {
    catalog,
    catalogDigest: catalogDigest(catalog, provenance),
    tableDigest: tableDigest(catalog),
  };
}

function parseCatalogProvider(value: unknown, label: string) {
  const models = record(value);
  if (!models) throw new Error(`${label} catalog 无效`);
  return Object.fromEntries(
    Object.entries(models).map(([id, value]) => {
      if (value === null) return [id, null];
      const item = record(value);
      if (
        !item ||
        !own(item, "input") ||
        !own(item, "cacheRead") ||
        !own(item, "cacheWrite") ||
        !own(item, "output")
      ) {
        throw new Error(`${label}.${id} 费率无效`);
      }
      return [id, {
        input: rate(item.input, `${label}.${id}.input`),
        cacheRead: rate(item.cacheRead, `${label}.${id}.cacheRead`),
        cacheWrite: rate(item.cacheWrite, `${label}.${id}.cacheWrite`),
        output: rate(item.output, `${label}.${id}.output`),
      }];
    })
  );
}

/** 对持久化缓存执行与外部 JSON 同等级的 fail-closed 收窄。 */
export function parsePricingCatalog(value: unknown): PricingCatalog {
  const root = record(value);
  const providers = root ? record(root.providers) : null;
  const aliases = root ? record(root.kimiAliases) : null;
  if (!providers || !aliases) throw new Error("pricing catalog 格式无效");
  const kimiAliases = Object.fromEntries(
    Object.entries(aliases).map(([id, target]) => {
      if (target === null) return [id, null];
      if (typeof target !== "string" || target.trim().length === 0) {
        throw new Error(`Kimi alias ${id} 无效`);
      }
      return [id, target];
    })
  );
  return {
    providers: {
      anthropic: parseCatalogProvider(providers.anthropic, "anthropic"),
      openai: parseCatalogProvider(providers.openai, "openai"),
      moonshotai: parseCatalogProvider(providers.moonshotai, "moonshotai"),
    },
    kimiAliases,
  };
}

export function overlayCatalog(
  base: PricingCatalog,
  overlay: Partial<PricingCatalog>
): PricingCatalog {
  return {
    providers: {
      anthropic: {
        ...base.providers.anthropic,
        ...overlay.providers?.anthropic,
      },
      openai: { ...base.providers.openai, ...overlay.providers?.openai },
      moonshotai: {
        ...base.providers.moonshotai,
        ...overlay.providers?.moonshotai,
      },
    },
    kimiAliases: { ...base.kimiAliases, ...overlay.kimiAliases },
  };
}

export function seedWinsOverlay(
  seed: PricingCatalog,
  cached: PricingCatalog
): PricingCatalog {
  const historical = (provider: (typeof PROVIDERS)[number]) =>
    Object.fromEntries(
      Object.entries(cached.providers[provider]).filter(
        ([id]) => !own(seed.providers[provider], id)
      )
    );
  return overlayCatalog(seed, {
    providers: {
      anthropic: historical("anthropic"),
      openai: historical("openai"),
      moonshotai: historical("moonshotai"),
    },
    kimiAliases: Object.fromEntries(
      Object.entries(cached.kimiAliases).filter(
        ([id]) => !own(seed.kimiAliases, id)
      )
    ),
  });
}
