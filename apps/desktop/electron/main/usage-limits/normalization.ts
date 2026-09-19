/**
 * [INPUT]: Depends on native quota response objects and the shared pool/window contract.
 * [OUTPUT]: Normalizes Codex, Claude, Kimi and OpenCode Go without inferring missing values or merging unrelated pools.
 * [POS]: Sole provider mapping authority, independent of process and renderer lifecycles.
 */
import type { AgentQuotaPool, AgentQuotaWindow } from "../../../shared/usage-limits/types";
import { sortQuotaPools } from "../../../shared/usage-limits/projection";
import { object, QuotaReadError, type QuotaReadResult } from "./readers/common";
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const duration = (value: unknown) => { const number = finite(value); return number !== null && number > 0 ? number : null; };
export const quotaLabel = (value: unknown): string | null => typeof value === "string" && value.trim() && value.length <= 160
  // eslint-disable-next-line no-control-regex -- Remove nonprinting native labels before renderer projection.
  ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim() : null;
const timestamp = (value: unknown, seconds = false): number | null => {
  const number = seconds ? typeof value === "number" ? value * 1000 : NaN
    : typeof value === "string" && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(number) && number > 0 && number <= 8.64e15 ? number : null;
};
function window(id: string, minutes: number | null, used: number | null, resetsAt: number | null, receivedAt: number): AgentQuotaWindow {
  return { id, windowDurationMins: minutes, usedPercent: used, resetsAt, receivedAt, sourceUpdatedAt: null };
}
function bounded<T>(values: T[]): T[] { if (values.length > 50) throw new QuotaReadError("invalid-response"); return values; }

export function normalizeCodex(raw: unknown, receivedAt: number, planLabel: string | null = null): QuotaReadResult {
  const response = object(raw);
  if (!own(response, "rateLimitsByLimitId") && !own(response, "rateLimits")) throw new QuotaReadError("invalid-response");
  const multi = response.rateLimitsByLimitId;
  const pools: AgentQuotaPool[] = [];
  const buckets: [string, unknown][] = multi == null ? response.rateLimits == null ? [] : [["codex", response.rateLimits]] : Object.entries(object(multi));
  for (const [id, rawBucket] of bounded(buckets)) {
    const bucket = object(rawBucket);
    const windows: AgentQuotaWindow[] = [];
    for (const key of ["primary", "secondary"] as const) {
      if (bucket[key] == null) continue;
      const value = object(bucket[key]);
      windows.push(window(key, duration(value.windowDurationMins), finite(value.usedPercent), timestamp(value.resetsAt, true), receivedAt));
    }
    pools.push({ id, isGeneral: id === "codex", label: quotaLabel(bucket.limitName), windows });
    planLabel ??= quotaLabel(bucket.planType);
  }
  return { source: "codex-app-server", pools: sortQuotaPools(pools), planLabel, receivedAt };
}

export function normalizeClaude(raw: unknown, receivedAt: number): QuotaReadResult {
  const response = object(raw);
  if (!own(response, "rate_limits_available")) throw new QuotaReadError("invalid-response");
  if (response.rate_limits_available === false || response.rate_limits === null) throw new QuotaReadError("unavailable");
  if (response.rate_limits_available !== true) throw new QuotaReadError("invalid-response");
  const limits = object(response.rate_limits);
  const pools = new Map<string, AgentQuotaPool>();
  const add = (poolId: string, label: string | null, key: string, minutes: number, rawWindow: unknown) => {
    if (rawWindow == null) return;
    const value = object(rawWindow);
    const pool = pools.get(poolId) ?? { id: poolId, isGeneral: poolId === "general", label, windows: [] };
    pool.windows.push(window(key, minutes, finite(value.utilization), timestamp(value.resets_at), receivedAt));
    pools.set(poolId, pool);
  };
  add("general", null, "five_hour", 300, limits.five_hour);
  add("general", null, "seven_day", 10080, limits.seven_day);
  add("oauth-apps", "OAuth apps", "seven_day_oauth_apps", 10080, limits.seven_day_oauth_apps);
  add("model:opus", "Opus", "seven_day_opus", 10080, limits.seven_day_opus);
  add("model:sonnet", "Sonnet", "seven_day_sonnet", 10080, limits.seven_day_sonnet);
  if (limits.model_scoped != null) {
    if (!Array.isArray(limits.model_scoped)) throw new QuotaReadError("invalid-response");
    for (const rawModel of bounded(limits.model_scoped)) {
      const model = object(rawModel);
      const label = quotaLabel(model.display_name);
      if (!label) throw new QuotaReadError("invalid-response");
      const id = "model-scoped:" + encodeURIComponent(String(model.display_name));
      if (pools.has(id)) throw new QuotaReadError("invalid-response");
      add(id, label, "seven_day", 10080, model);
    }
  }
  return { source: "claude-sdk-query", pools: sortQuotaPools([...pools.values()]), planLabel: quotaLabel(response.subscription_type), receivedAt };
}

export function normalizeKimi(raw: unknown, receivedAt: number): QuotaReadResult {
  const response = object(raw);
  if (response.code !== 0) throw new QuotaReadError("invalid-response");
  const data = object(response.data);
  if (data.kind === "error") throw new QuotaReadError(data.status === 401 ? "needs-auth" : data.status === 429 ? "rate-limited" : "unavailable");
  if (data.kind !== "ok" || !Array.isArray(data.limits)) throw new QuotaReadError("invalid-response");
  const windows: AgentQuotaWindow[] = [];
  const identities = new Map<string, AgentQuotaWindow>();
  const units: Record<string, number> = { minute: 1, hour: 60, day: 1440, week: 10080 };
  const entries = [...(data.summary == null ? [] : [{ source: "summary", value: data.summary }]),
    ...bounded(data.limits).map((value) => ({ source: "limits", value }))];
  for (const entry of entries) {
    const value = object(entry.value);
    const period = value.window == null ? {} : object(value.window);
    const count = duration(period.duration);
    const minutes = count !== null && units[String(period.unit)] ? duration(count * units[String(period.unit)]) : null;
    const used = finite(value.used), limit = duration(value.limit);
    const key = `${minutes ?? "unknown"}:${quotaLabel(value.name) ?? ""}`;
    const next = window(`${entry.source}:${key}`, minutes, used !== null && limit !== null ? finite(used / limit * 100) : null, timestamp(value.reset_at), receivedAt);
    const previous = identities.get(key);
    if (previous) {
      if (previous.usedPercent !== next.usedPercent || previous.resetsAt !== next.resetsAt) throw new QuotaReadError("invalid-response");
      continue;
    }
    identities.set(key, next); windows.push(next);
  }
  return { source: "kimi-local-api", pools: windows.length ? sortQuotaPools([{ id: "general", isGeneral: true, label: null, windows }]) : [], planLabel: null, receivedAt };
}

export function normalizeOpencodeGo(raw: unknown, receivedAt: number): QuotaReadResult {
  const usage = object(object(raw).usage);
  const windows: AgentQuotaWindow[] = [];
  for (const [id, minutes] of [["rolling", 300], ["weekly", 10080], ["monthly", null]] as const) {
    const value = object(usage[id]);
    if (value.status !== "ok" && value.status !== "rate-limited") throw new QuotaReadError("invalid-response");
    windows.push({ ...window(id, minutes, finite(value.percent), timestamp(value.resetsAt), receivedAt),
      ...(id === "monthly" ? { calendarPeriod: "month" as const } : {}) });
  }
  return { source: "opencode-go-api", planLabel: "OpenCode Go", receivedAt,
    pools: [{ id: "opencode-go", isGeneral: true, label: "OpenCode Go", windows }] };
}
