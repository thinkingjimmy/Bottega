/**
 * [INPUT]: Depends on the main quota owner (per-surface foreground/demand), the local usage history service, the shared quota projections, and the Dock Widget models.
 * [OUTPUT]: Provides DockUsage: per-surface (bar/panel) visibility-driven quota demand and today-activity reads with single flight, five-minute freshness, manual throttle and a failure backoff ladder; compact faces for both Widget kinds; detail projections; default Agent selection; and privacy-safe values (no guessing, zero vs unknown kept apart).
 * [POS]: system-dock/widgets Usage adapter (3.4, INV-11/12); prewarming is never a consumer, and releasing one surface never clears another window's demand.
 */

import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../../shared/agent-ipc";
import type { LimitsFaceSource, PanelSnapshot, WidgetFace } from "../../../../shared/system-dock/ipc";
import type { AiActivityWidget, AiLimitsWidget } from "../../../../shared/system-dock/layout";
import type { AgentUsageSummary, UsageQueryTarget } from "../../../../shared/usage-ipc";
import { USAGE_SOURCE_ORDER } from "../../../../shared/usage-ipc";
import { LIMITS_TIMING, type AgentUsageLimits } from "../../../../shared/usage-limits/types";
import { currentRemaining, quotaStale, sortQuotaPools } from "../../../../shared/usage-limits/projection";

export type LimitsPort = {
  snapshot(): { revision: number; agents: AgentUsageLimits[] };
  subscribe(listener: () => void): () => void;
  setForeground(value: boolean, surface: string): void;
  setDemand(demand: { id: string; active: boolean; mode: "settings" | "selector"; backends: AgentBackendId[] }, surface: string): void;
  clearDemands(surface: string): void;
  refresh(request: { backend?: AgentBackendId }): Promise<unknown>;
};
export type HistoryPort = { getSummary(target: UsageQueryTarget, options?: { forceRefresh?: boolean }): Promise<AgentUsageSummary> };
export type DockSurface = "dock-bar" | "dock-panel";
type Activity = { summary: AgentUsageSummary | null; at: number; flight: Promise<void> | null; error: boolean; manualAt: number; failures: number };
const ACTIVITY_REFRESH_MS = 5 * 60_000;

export class DockUsage {
  private readonly visible = new Map<DockSurface, { limits: Map<string, AgentBackendId[]>; activity: Set<UsageQueryTarget> }>();
  private readonly activity = new Map<UsageQueryTarget, Activity>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly stop: (() => void) | null;
  constructor(private readonly limits: LimitsPort | null, private readonly history: HistoryPort | null, private readonly changed: () => void,
    private readonly now = Date.now) {
    this.stop = limits?.subscribe(() => this.changed()) ?? null;
  }
  /**
   * The only consumer registration: a surface is visible with these Widgets. A hidden surface,
   * a locked screen or a prewarmed panel passes an empty list and releases just its own demand.
   */
  setVisible(surface: DockSurface, widgets: readonly { itemId: string; widget: AiLimitsWidget | AiActivityWidget }[]) {
    const previous = this.visible.get(surface);
    const limits = new Map<string, AgentBackendId[]>();
    const activity = new Set<UsageQueryTarget>();
    for (const { itemId, widget } of widgets) {
      if (widget.type === "builtin.ai-limits") { if (widget.selectedBackends.length) limits.set(itemId, [...widget.selectedBackends]); }
      else activity.add(widget.source);
    }
    if (this.limits) {
      for (const itemId of previous?.limits.keys() ?? []) if (!limits.has(itemId)) this.limits.setDemand({ id: demandId(itemId), active: false, mode: "settings", backends: previous!.limits.get(itemId)! }, surface);
      for (const [itemId, backends] of limits) this.limits.setDemand({ id: demandId(itemId), active: true, mode: "settings", backends }, surface);
      this.limits.setForeground(limits.size > 0, surface);
    }
    if (limits.size || activity.size) this.visible.set(surface, { limits, activity }); else this.visible.delete(surface);
    for (const target of activity) void this.readActivity(target, false);
    this.arm();
  }
  private arm() {
    const want = [...this.visible.values()].some((entry) => entry.activity.size > 0);
    if (want && !this.timer) { this.timer = setInterval(() => { for (const target of this.wantedActivity()) void this.readActivity(target, false); }, 60_000); this.timer.unref?.(); }
    if (!want && this.timer) { clearInterval(this.timer); this.timer = null; }
  }
  private wantedActivity() { return new Set([...this.visible.values()].flatMap((entry) => [...entry.activity])); }
  private readActivity(target: UsageQueryTarget, manual: boolean): Promise<void> {
    if (!this.history) return Promise.resolve();
    const state = this.activity.get(target) ?? { summary: null, at: 0, flight: null, error: false, manualAt: 0, failures: 0 };
    this.activity.set(target, state);
    if (state.flight) return state.flight;
    if (manual && this.now() - state.manualAt < LIMITS_TIMING.manualMs) return Promise.resolve();
    if (!manual && state.summary && !state.error && this.now() - state.at < ACTIVITY_REFRESH_MS) return Promise.resolve();
    // A failure publishes, and publishing re-registers visibility: without a backoff that loop re-reads at once, forever.
    if (!manual && state.error && this.now() - state.at < failureBackoff(state.failures)) return Promise.resolve();
    if (manual) state.manualAt = this.now();
    state.flight = this.history.getSummary(target, { forceRefresh: manual })
      .then((summary) => { state.summary = summary; state.error = false; state.failures = 0; state.at = this.now(); })
      .catch(() => { state.error = true; state.failures += 1; state.at = this.now(); })
      .finally(() => { state.flight = null; this.changed(); });
    this.changed();
    return state.flight;
  }
  async refresh(widget: AiLimitsWidget | AiActivityWidget) {
    if (widget.type === "builtin.ai-activity") return this.readActivity(widget.source, true);
    await Promise.all(widget.selectedBackends.map((backend) => this.limits?.refresh({ backend }).catch(() => undefined)));
  }
  /** Available sources the Bottega service confirms today; installation later never rewrites a user's choice (3.4). */
  defaultBackends(): AgentBackendId[] {
    return (this.limits?.snapshot().agents ?? []).filter((agent) => agent.availability === "available").map((agent) => agent.backend);
  }
  configurable(): AgentBackendId[] {
    const agents = this.limits?.snapshot().agents ?? [];
    return AGENT_BACKEND_ORDER.filter((backend) => { const agent = agents.find((value) => value.backend === backend); return agent && agent.availability !== "unsupported"; });
  }
  limitsFace(widget: AiLimitsWidget): WidgetFace {
    const agents = this.limits?.snapshot().agents ?? [];
    const now = this.now();
    const sources = widget.selectedBackends.slice(0, 3).map((backend): LimitsFaceSource => {
      const agent = agents.find((value) => value.backend === backend);
      if (!agent) return { backend, remaining: null, windowMins: null, calendar: false, resetsAt: null, state: "unknown" };
      const window = pickWindow(agent, widget.selectionByBackend[backend], now);
      const remaining = window ? currentRemaining(window, now) : null;
      const state: LimitsFaceSource["state"] = agent.availability === "needs-auth" ? "needs-auth" : agent.availability === "not-installed" ? "not-installed"
        : agent.availability !== "available" ? "unavailable" : agent.receivedAt === null ? (agent.fetchState === "error" ? "error" : "loading")
        : remaining === null ? "unknown" : quotaStale(agent, now) ? "stale" : "ok";
      return { backend, remaining, windowMins: window?.windowDurationMins ?? null, calendar: window?.calendarPeriod === "month", resetsAt: window?.resetsAt ?? null, state };
    });
    return { type: "builtin.ai-limits", configured: widget.selectedBackends.length > 0, sources, more: Math.max(0, widget.selectedBackends.length - 3) };
  }
  activityFace(widget: AiActivityWidget): Extract<WidgetFace, { type: "builtin.ai-activity" }> {
    const state = this.activity.get(widget.source);
    const summary = state?.summary ?? null;
    if (!summary) return { type: "builtin.ai-activity", state: state?.error ? "error" : "loading", tokens: null, costUsd: null, unpricedTokens: 0, todayKey: null, timeZone: null };
    const key = summary.todayKey;
    const tokens = summary.daily[key] ?? 0;
    const status = summary.status === "error" ? "error" : summary.status === "no-data" ? "no-data" : summary.status === "partial" ? "partial" : "ok";
    return { type: "builtin.ai-activity", state: status, tokens: status === "error" ? null : tokens, costUsd: status === "error" ? null : summary.dailyCostUsd[key] ?? 0,
      unpricedTokens: summary.dailyUnpricedTokens[key] ?? 0, todayKey: key, timeZone: summary.timeZone };
  }
  limitsDetail(itemId: string, widget: AiLimitsWidget): NonNullable<PanelSnapshot["limits"]> {
    const agents = this.limits?.snapshot().agents ?? [];
    const selected = widget.selectedBackends.flatMap((backend) => agents.find((agent) => agent.backend === backend) ?? []);
    const updated = selected.map((agent) => agent.receivedAt ?? 0).filter(Boolean);
    return { itemId, agents: selected, selected: widget.selectedBackends, configurable: this.configurable(), selection: widget.selectionByBackend,
      updatedAt: updated.length ? Math.min(...updated) : null, refreshing: selected.some((agent) => agent.fetchState === "refreshing") };
  }
  activityDetail(itemId: string, widget: AiActivityWidget): NonNullable<PanelSnapshot["activity"]> {
    const state = this.activity.get(widget.source);
    return { itemId, source: widget.source, sources: [...USAGE_SOURCE_ORDER], face: this.activityFace(widget), scannedFiles: state?.summary?.scannedFiles ?? 0,
      issues: state?.summary?.issues.length ?? 0, updatedAt: state?.summary ? state.at : null };
  }
  /** Account/identity changes isolate old readings: the next read starts clean (INV-06). */
  resetHistory() { this.activity.clear(); this.changed(); }
  close() {
    for (const surface of [...this.visible.keys()]) this.setVisible(surface, []);
    this.limits?.clearDemands("dock-bar"); this.limits?.clearDemands("dock-panel");
    this.stop?.(); if (this.timer) clearInterval(this.timer); this.timer = null;
  }
}
/** 60 s, 120 s, 300 s, then every 300 s — the same ladder as quota reads (LIMITS_TIMING.retryMs). */
const failureBackoff = (failures: number) => LIMITS_TIMING.retryMs[Math.min(failures, LIMITS_TIMING.retryMs.length) - 1] ?? 0;
const demandId = (itemId: string) => `dock:${itemId}`.slice(0, 96);
/** A chosen pool/window wins; otherwise only the general pool's tightest window is shown, never an average across pools (INV-12). */
function pickWindow(agent: AgentUsageLimits, selection: AiLimitsWidget["selectionByBackend"][AgentBackendId] | undefined, now: number) {
  const pools = sortQuotaPools(agent.pools);
  if (selection?.poolId) {
    const pool = pools.find((value) => value.id === selection.poolId);
    if (!pool) return null;
    return (selection.windowId ? pool.windows.find((window) => window.id === selection.windowId) : tightest(pool.windows, now)) ?? null;
  }
  const general = pools.find((pool) => pool.isGeneral) ?? (pools.length === 1 ? pools[0] : undefined);
  return general ? tightest(general.windows, now) : null;
}
function tightest(windows: AgentUsageLimits["pools"][number]["windows"], now: number) {
  let best: (typeof windows)[number] | null = null; let value = Infinity;
  for (const window of windows) { const remaining = currentRemaining(window, now); if (remaining !== null && remaining < value) { value = remaining; best = window; } }
  return best ?? windows[0] ?? null;
}
