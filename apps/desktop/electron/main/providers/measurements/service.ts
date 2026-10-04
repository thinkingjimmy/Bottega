/**
 * [INPUT]: Depends on Measurement store/identity, four builtin Provider launchers, model-free probes and installed-runtime ports.
 * [OUTPUT]: Provides ProviderMeasurements with adopt, ensure, recheck, current and change subscriptions; revalidates after probes and retries changed runtimes up to twice without adopting stale versions.
 * [POS]: On-demand evidence owner for all four Providers; identity changes trigger new probes and stale evidence is excluded.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MeasuredCapability, MeasurementIdentity, ProviderCapability } from "@ai-chat/cloud-protocol/contracts/provider";
import { claudeAdapterEntry } from "../claude/adapter-entry";
import { adapterLaunch } from "../../runtime";
import { claudeAdapterEnvironment } from "../claude/environment";
import { claudeSessionMissing, validateClaudeSessionId } from "../claude/turn-config";
import { codexSessionMissing } from "../codex/turn-config";
import { CLAUDE_READ_ONLY_TOOLS } from "../claude/background/headless";
import { codexAcpEntry, codexAcpEnvironment, validateCodexSessionId } from "../codex/adapter-entry";
import type { ResolvedRuntime } from "../../backends/types";
import { claudeNetworkVerdict, claudeToolVerdicts, probeClaudeNetworkOff, probeClaudeToolSet } from "./claude-tools";
import { probeSeatbeltReadOnly } from "./codex-read-only";
import { MeasurementRuntimeChanged, measurementIdentity } from "./identity";
import { openRequestSink } from "./sink";
import type { MeasurementStore } from "./store";
import { probeTeardown } from "./teardown";
import { kimiAcpLaunch } from "../kimi/home";
import { opencodeAcpLaunch } from "../opencode/home";
import { validateKimiSessionId } from "../kimi/turn-config";
import { validateOpencodeSessionId } from "../opencode/turn-config";
import { currentMeasurements } from "@ai-chat/cloud-protocol/contracts/provider";

/* The allowlist a read-only turn runs with (04 §5), shared with the product path; its announcement proves tool-filter and read-only together. */
export const PLAN_REVIEW_TOOLS = CLAUDE_READ_ONLY_TOOLS;
export const MEASURED_PROVIDERS = ["claude", "codex", "kimi", "opencode"] as const;
type Measured = (typeof MEASURED_PROVIDERS)[number];
type Verdict = MeasuredCapability["state"];
export type MeasurementPorts = {
  /** Resolves the runtime (may run discovery); used only when a probe is actually needed. */
  runtime(providerId: Measured): Promise<ResolvedRuntime | null>;
  /** The runtime the registry already knows, without any discovery; adoption uses only this. */
  knownRuntime(providerId: Measured): ResolvedRuntime | null;
  now(): number; report?(providerId: string, detail: unknown): void };

export class ProviderMeasurements {
  private readonly identities = new Map<string, MeasurementIdentity>();
  private readonly flights = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  /* Probes spawn real Provider sessions; closing aborts any in flight so quitting never waits on one. */
  private readonly aborter = new AbortController();
  constructor(private readonly store: MeasurementStore, private readonly ports: MeasurementPorts) {}

  onChanged(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  current(providerId: string) {
    const identity = this.identities.get(providerId) ?? null;
    return { identity, measured: identity ? currentMeasurements(this.store.forProvider(providerId), identity) : [] };
  }
  /** Startup: take the stored records for the current identity; never spawns a probe. */
  adopt(providerId: Measured) { return this.flight(providerId, "adopt"); }
  /** On demand (workflow admission): probe only when this identity has no records yet. Nothing probes in the background. */
  ensure(providerId: Measured) { return this.flight(providerId, "ensure"); }
  /** The user asked to verify again. */
  recheck(providerId: Measured) { return this.flight(providerId, "recheck"); }
  close() { this.aborter.abort(); }

  private flight(providerId: Measured, mode: "adopt" | "ensure" | "recheck"): Promise<void> {
    const running = this.flights.get(providerId);
    if (running) return mode === "adopt" ? running : running.then(() => this.flight(providerId, "ensure"));
    const next = this.measure(providerId, mode).finally(() => this.flights.delete(providerId));
    this.flights.set(providerId, next);
    return next;
  }
  private async measure(providerId: Measured, mode: "adopt" | "ensure" | "recheck", attempt = 0): Promise<void> {
    const signal = this.aborter.signal;
    if (signal.aborted) return;
    try {
      /* Adopting never starts runtime discovery: at startup, and in a fenced environment, that is work nobody asked for. */
      const runtime = mode === "adopt" ? this.ports.knownRuntime(providerId) : await this.ports.runtime(providerId);
      if (!runtime) { this.identities.delete(providerId); this.emit(); return; }
      const adapter = providerId === "claude" ? claudeAdapterEntry() : providerId === "codex" ? codexAcpEntry() : undefined;
      const identity = await measurementIdentity(runtime, adapter);
      const stored = this.store.forProvider(providerId);
      const same = (record: MeasuredCapability) => JSON.stringify(record.identity) === JSON.stringify(identity);
      this.identities.set(providerId, identity);
      if (mode === "adopt" || (mode === "ensure" && stored.length && stored.every(same))) { this.emit(); return; }
      const verdicts = await this.probe(providerId, runtime, signal);
      if (signal.aborted) return;
      const verified = await measurementIdentity(runtime, adapter);
      if (JSON.stringify(verified) !== JSON.stringify(identity)) throw new MeasurementRuntimeChanged();
      const measuredAt = this.ports.now();
      await this.store.replace(providerId, Object.entries(verdicts).map(([capability, state]) => ({ providerId, capability: capability as ProviderCapability,
        state, identity, probeId: `${providerId}:${capability}`, measuredAt })));
      this.emit();
    } catch (cause) {
      this.identities.delete(providerId); this.emit();
      if (cause instanceof MeasurementRuntimeChanged) {
        if (mode === "adopt") return;
        if (attempt < 2) return this.measure(providerId, mode, attempt + 1);
      }
      throw cause;
    }
  }
  /* Each probe that fails records `unverified`; the identity then holds until the CLI changes or the user asks again (P3). */
  private async probe(providerId: Measured, runtime: ResolvedRuntime, signal: AbortSignal): Promise<Partial<Record<ProviderCapability, Verdict>>> {
    const workspace = await mkdtemp(join(tmpdir(), "bottega-probe-"));
    try {
      if (providerId === "claude") {
        const tools = await probeClaudeToolSet({ runtime, workspace, requested: PLAN_REVIEW_TOOLS, signal });
        const verdict = claudeToolVerdicts(PLAN_REVIEW_TOOLS, tools);
        /* Session setup may reach the API too; the sink keeps every request on this machine. */
        const sink = await openRequestSink();
        const teardown = await probeTeardown({ backend: "claude", cwd: workspace,
          ...adapterLaunch("claude-agent-acp", { ...claudeAdapterEnvironment(runtime), ANTHROPIC_BASE_URL: sink.url, CLAUDE_CODE_MAX_RETRIES: "0" }),
          validateSessionId: validateClaudeSessionId, sessionMissing: claudeSessionMissing, timeoutMs: 20_000, totalTimeoutMs: 45_000, signal }).finally(() => sink.close());
        const network = await probeClaudeNetworkOff({ runtime, root: workspace, signal });
        this.ports.report?.(providerId, { tools, teardown, network });
        return { "tool-filter": verdict.toolFilter, "read-only": verdict.readOnly, cancel: teardown.state, "network-off": claudeNetworkVerdict(network) };
      }
      if (providerId === "kimi" || providerId === "opencode") {
        const launch = providerId === "kimi" ? kimiAcpLaunch(runtime) : opencodeAcpLaunch(runtime);
        const teardown = await probeTeardown({ backend: providerId, cwd: workspace, ...launch, initializeOnly: true,
          validateSessionId: providerId === "kimi" ? validateKimiSessionId : validateOpencodeSessionId,
          timeoutMs: 20_000, totalTimeoutMs: 40_000, signal });
        this.ports.report?.(providerId, { teardown });
        return { cancel: teardown.state };
      }
      const readOnly = probeSeatbeltReadOnly("codex");
      const teardown = await probeTeardown({ backend: "codex", cwd: workspace,
        ...adapterLaunch("codex-acp", codexAcpEnvironment(runtime)), validateSessionId: validateCodexSessionId, sessionMissing: codexSessionMissing, timeoutMs: 20_000, totalTimeoutMs: 40_000, signal });
      this.ports.report?.(providerId, { readOnly, teardown });
      return { "read-only": readOnly.state, cancel: teardown.state };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
  private emit() { for (const listener of this.listeners) listener(); }
}
