/**
 * [INPUT]: Managed service identities, shared consent/connector owners and an authenticated lease adapter.
 * [OUTPUT]: PreviewSessions with cancelable admission, observable fail-closed drainage, persistent failure recovery and retried lease release.
 * [POS]: Preview lifecycle authority; application bytes never pass through the cloud control plane.
 */
import { randomUUID } from "node:crypto";
import type { PreviewView } from "@ai-chat/cloud-protocol/resources/preview";
import type { PreviewServerSupervisor } from "../process/supervisor";
import { createPreviewProxy } from "../network/proxy";
import type { TunnelConsent } from "../../tunnel/runtime/consent";
import type { ConnectorSupervisor } from "../../tunnel/connectors/supervisor";
export type PreviewCloud = {
  register(input: { sessionId: string; serverId: string; chatId: string; incarnationId: string; commandId: string | null }): Promise<{ expiresAt: number; state: string }>;
  renew(sessionId: string): Promise<{ expiresAt: number; state: string }>;
  release(sessionId: string): Promise<void>;
};
type Scope = { serverId: string; chatId: string; incarnationId: string };
type Entry = Scope & { proxy: Awaited<ReturnType<typeof createPreviewProxy>>; sessionId: string | null; deadline: number; streaming: boolean; slowLoad: boolean; devOriginBlocked: boolean; draining: boolean; opened: boolean; key: string; cloud: PreviewCloud | null };
type Terminal = Scope & { state: "closed" | "failed"; failure?: PreviewView["failure"] };
const sameScope = (a: Scope, b: Scope) => a.chatId === b.chatId && a.incarnationId === b.incarnationId;
function failureReason(error: unknown): PreviewView["failure"] {
  const message = error instanceof Error ? error.message : "";
  if (/tunnel-(?:component|signature|archive)-|codesign/.test(message)) return "tunnel-component-unverified";
  if (message.startsWith("tunnel-download-") && message !== "tunnel-download-consent-required") return "tunnel-download-failed";
  if (message === "preview-tunnel-unavailable") return message;
  return undefined;
}
export class PreviewSessions {
  private readonly entries = new Map<string, Entry>();
  private readonly generations = new Map<string, number>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly terminal = new Map<string, Terminal>();
  private cloud: PreviewCloud | null = null;
  private stopped = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly renewing = new Set<Entry>();
  private readonly releases = new Map<string, { cloud: PreviewCloud; expires: number; retryAt: number; running: boolean }>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly services: () => PreviewServerSupervisor, private readonly consent: TunnelConsent,
    private readonly connectors: () => ConnectorSupervisor, private readonly changed: () => void) {
    this.timer = setInterval(() => { void this.tick(); }, 1000); this.timer.unref();
  }
  configure(cloud: PreviewCloud | null) { this.cloud = cloud; }
  count() { return [...this.entries.values()].filter(e => e.sessionId).length; }
  private serial<T>(run: () => Promise<T>) { const next = this.queue.then(run); this.queue = next.catch(() => undefined); return next; }
  async warm(scope: Scope) {
    const generation = this.generations.get(scope.serverId) ?? 0;
    return this.serial(async () => {
      if (this.stopped || !this.consent.enabled() || !this.consent.consented()) return;
      this.assertCurrent(scope, generation);
      await this.consent.require("remote");
      this.assertCurrent(scope, generation);
      const entry = await this.entry(scope, generation);
      if (!entry.sessionId) await this.connectors().warm(entry.key, entry.proxy.port, entry.proxy.challenge, this.changed);
    });
  }
  async action(action: string, scope: Scope, origin: "desktop" | "remote", commandId: string | null = null): Promise<PreviewView> {
    if (action === "preview-stop") {
      const prior = this.entries.get(scope.serverId) ?? this.terminal.get(scope.serverId);
      if (prior && !sameScope(prior, scope)) throw new Error("preview-chat-changed");
      await this.revoke(scope.serverId, true);
      this.remember({ ...scope, state: "closed" }); this.changed(); return this.view(scope);
    }
    if (action === "preview-status") {
      this.consent.assertAvailable();
      const prior = this.entries.get(scope.serverId) ?? this.terminal.get(scope.serverId);
      if (prior && !sameScope(prior, scope)) throw new Error("preview-chat-changed");
      if (this.entries.get(scope.serverId)?.draining || this.terminal.has(scope.serverId)) return this.view(scope);
      await this.services().identity(scope.serverId, scope.chatId, scope.incarnationId);
      return this.view(scope);
    }
    // Capture cancellation before queueing: a later stop also cancels requests that have not started.
    const generation = this.generations.get(scope.serverId) ?? 0;
    return this.serial(async () => {
      let phase: "identity" | "download" | "session" = "identity";
      let opening: Entry | undefined;
      try {
        if (this.stopped || !this.consent.enabled()) throw new Error("tunnel-plugin-disabled");
        const prior = this.entries.get(scope.serverId) ?? this.terminal.get(scope.serverId);
        if (prior && !sameScope(prior, scope)) throw new Error("preview-chat-changed");
        if (this.entries.get(scope.serverId)?.draining) throw new Error("preview-service-changed");
        this.assertCurrent(scope, generation);
        await this.closing.get(scope.serverId);
        this.assertCurrent(scope, generation);
        await this.services().identity(scope.serverId, scope.chatId, scope.incarnationId);
        this.terminal.delete(scope.serverId);
        phase = "download"; await this.consent.require(origin); phase = "session";
        this.assertCurrent(scope, generation);
        if (!this.cloud) throw new Error("preview-account-required");
        const entry = await this.entry(scope, generation);
        if (!entry.sessionId) {
          opening = entry;
          const sessionId = randomUUID(), cloud = this.cloud;
          const lease = await cloud.register({ ...scope, sessionId, commandId });
          if (this.entries.get(scope.serverId) !== entry || this.stopped || this.cloud !== cloud) {
            this.queueRelease(sessionId, cloud, lease.expiresAt); throw new Error("preview-session-closed");
          }
          if (lease.state !== "open") { this.queueRelease(sessionId, cloud, lease.expiresAt); throw new Error("preview-session-closed"); }
          entry.cloud = cloud; entry.sessionId = sessionId; entry.deadline = Math.min(Date.now() + 300_000, lease.expiresAt);
          const hostname = await this.connectors().acquire(entry.key, entry.proxy.port, entry.proxy.challenge, this.changed);
          this.assertCurrent(scope, generation);
          if (this.entries.get(scope.serverId) !== entry || entry.sessionId !== sessionId || this.cloud !== cloud) throw new Error("preview-session-closed");
          await this.services().identity(scope.serverId, scope.chatId, scope.incarnationId);
          this.assertCurrent(scope, generation);
          entry.proxy.gate.open(hostname, entry.deadline);
          entry.opened = true;
        }
        return { ...this.view(scope), entryUrl: entry.proxy.gate.issue() };
      } catch (error) {
        if (phase !== "identity" && (phase === "download" || opening) && (this.generations.get(scope.serverId) ?? 0) === generation) {
          const message = error instanceof Error ? error.message : "";
          const failure = failureReason(error) ?? (phase === "download" && !["tunnel-download-consent-required", "tunnel-platform-unsupported", "tunnel-plugin-disabled"].includes(message) ? "tunnel-download-failed" : undefined);
          await this.revoke(scope.serverId, false, failure);
          if (failure) { this.remember({ ...scope, state: "failed", failure }); this.changed(); }
        }
        throw error;
      }
    });
  }
  view(scope: Scope): PreviewView {
    const entry = this.entries.get(scope.serverId), connector = entry && this.connectors().views().find(v => v.key === entry.key);
    const terminal = this.terminal.get(scope.serverId);
    return { ...scope, sessionId: entry?.sessionId ?? null, state: entry?.draining ? "draining" : !entry?.sessionId && terminal ? terminal.state : connector?.state ?? "running",
      ...(!entry?.sessionId && terminal?.failure ? { failure: terminal.failure } : {}), streaming: entry?.streaming ?? false, slowLoad: entry?.slowLoad ?? false, devOriginBlocked: entry?.devOriginBlocked ?? false };
  }
  private remember(terminal: Terminal) {
    this.terminal.delete(terminal.serverId); this.terminal.set(terminal.serverId, terminal);
    if (this.terminal.size > 64) this.terminal.delete(this.terminal.keys().next().value!);
  }
  private assertCurrent(scope: Scope, generation: number) {
    if (this.stopped || !this.consent.enabled() || (this.generations.get(scope.serverId) ?? 0) !== generation) throw new Error("preview-session-closed");
  }
  private async entry(scope: Scope, generation: number) {
    let entry = this.entries.get(scope.serverId);
    if (entry) {
      if (!sameScope(entry, scope)) throw new Error("preview-chat-changed");
      if (entry.draining) throw new Error("preview-service-changed");
      return entry;
    }
    const identity = await this.services().identity(scope.serverId, scope.chatId, scope.incarnationId);
    const proxy = await createPreviewProxy({ port: identity.port, identity: () => this.services().identity(scope.serverId, scope.chatId, scope.incarnationId),
      streaming: () => { const live = this.entries.get(scope.serverId); if (live) { live.streaming = true; this.changed(); } },
      slowLoad: () => { const live = this.entries.get(scope.serverId); if (live && this.services().list(scope.chatId).find(s => s.serverId === scope.serverId)?.mode === "dev") { live.slowLoad = true; this.changed(); } },
      devOriginBlocked: blocked => {
        const live = this.entries.get(scope.serverId);
        if (live?.proxy === proxy && live.devOriginBlocked !== blocked && this.services().list(scope.chatId).find(s => s.serverId === scope.serverId)?.mode === "dev") {
          live.devOriginBlocked = blocked; this.changed();
        }
      },
      invalid: () => { void this.invalidate(scope.serverId).catch(() => undefined); } });
    try { this.assertCurrent(scope, generation); } catch (error) { await proxy.close(); throw error; }
    entry = { ...scope, proxy, sessionId: null, cloud: null, deadline: 0, streaming: false, slowLoad: false, devOriginBlocked: false, draining: false, opened: false, key: randomUUID() };
    this.entries.set(scope.serverId, entry); return entry;
  }
  async invalidate(serverId: string) {
    const entry = this.entries.get(serverId);
    if (!entry || entry.draining) return this.closing.get(serverId);
    this.generations.set(serverId, (this.generations.get(serverId) ?? 0) + 1);
    entry.draining = true; entry.proxy.invalidate(); this.releaseEntry(entry);
    this.changed();
    await this.cleanup(entry, { serverId, chatId: entry.chatId, incarnationId: entry.incarnationId, state: "closed", failure: "preview-service-changed" });
  }
  async revoke(serverId: string, rewarm: boolean, failure?: PreviewView["failure"]) {
    this.generations.set(serverId, (this.generations.get(serverId) ?? 0) + 1);
    const entry = this.entries.get(serverId);
    if (!entry) { await this.closing.get(serverId); return; }
    // No awaited work precedes removing authorization or destroying established connections.
    entry.proxy.revoke();
    const terminal: Terminal = { serverId, chatId: entry.chatId, incarnationId: entry.incarnationId, state: failure ? "failed" : "closed", ...(failure ? { failure } : {}) };
    this.remember(terminal);
    this.entries.delete(serverId);
    this.releaseEntry(entry); this.changed();
    await (this.closing.get(serverId) ?? this.cleanup(entry, terminal));
    if (rewarm && !entry.draining && !this.stopped && this.consent.enabled()) void this.warm(entry).catch(() => undefined);
  }
  private releaseEntry(entry: Entry) {
    const sessionId = entry.sessionId, cloud = entry.cloud, expires = entry.deadline;
    entry.sessionId = null; entry.cloud = null; entry.deadline = 0; entry.opened = false;
    if (sessionId && cloud) this.queueRelease(sessionId, cloud, expires);
  }
  private queueRelease(sessionId: string, cloud: PreviewCloud, expires: number) {
    if (this.releases.size >= 64) this.releases.delete(this.releases.keys().next().value!);
    this.releases.set(sessionId, { cloud, expires, retryAt: 0, running: false });
    void this.release(sessionId);
  }
  private cleanup(entry: Entry, terminal: Terminal) {
    const closing = (async () => {
      try { await this.connectors().stop(entry.key); }
      finally { await entry.proxy.close(); }
    })().finally(() => {
      if (this.entries.get(entry.serverId) === entry) { this.entries.delete(entry.serverId); this.remember(terminal); }
      if (this.closing.get(entry.serverId) === closing) this.closing.delete(entry.serverId);
      this.changed();
    });
    this.closing.set(entry.serverId, closing); return closing;
  }
  async revokeAll() { await Promise.all([...this.entries.keys()].map(key => this.revoke(key, false))); }
  private lastRenewed = 0;
  private async release(sessionId: string) {
    const item = this.releases.get(sessionId);
    if (!item || item.running || Date.now() < item.retryAt) return;
    if (Date.now() >= item.expires) { this.releases.delete(sessionId); return; }
    item.running = true;
    try { await item.cloud.release(sessionId); this.releases.delete(sessionId); }
    catch { item.retryAt = Date.now() + 5000; }
    finally { item.running = false; }
  }
  private tick() {
    if (this.stopped) return;
    const renew = Date.now() - this.lastRenewed >= 60_000; if (renew) this.lastRenewed = Date.now();
    for (const sessionId of this.releases.keys()) void this.release(sessionId);
    for (const entry of this.entries.values()) {
      if (!entry.sessionId || entry.draining) continue;
      const state = this.connectors().views().find(v => v.key === entry.key)?.state;
      // Expiry never waits for a network request, including an already-running renewal.
      if (Date.now() >= entry.deadline || entry.opened && !entry.proxy.gate.active() || state === "failed") {
        void this.revoke(entry.serverId, false, state === "failed" ? "preview-tunnel-unavailable" : undefined).catch(() => undefined); continue;
      }
      if (renew && !this.renewing.has(entry)) void this.renew(entry);
    }
  }
  private async renew(entry: Entry) {
    this.renewing.add(entry);
    try {
      try { await this.services().identity(entry.serverId, entry.chatId, entry.incarnationId); }
      catch { await this.invalidate(entry.serverId); return; }
      const sessionId = entry.sessionId;
      if (!sessionId || !entry.cloud) return;
      const lease = await entry.cloud.renew(sessionId);
      if (this.stopped || entry.sessionId !== sessionId || Date.now() >= entry.deadline) return;
      if (lease.state !== "open") await this.revoke(entry.serverId, false);
      else { entry.deadline = Math.min(Date.now() + 300_000, lease.expiresAt); entry.proxy.gate.renew(entry.deadline); }
    } catch { /* The already-issued lease is the sole temporary-disconnect allowance. */ }
    finally { this.renewing.delete(entry); }
  }
  async close() { this.stopped = true; clearInterval(this.timer); await Promise.all([...this.entries.values()].map(entry => entry.proxy.drain()));
    await this.revokeAll(); await this.queue; await Promise.all(this.closing.values()); }
}
