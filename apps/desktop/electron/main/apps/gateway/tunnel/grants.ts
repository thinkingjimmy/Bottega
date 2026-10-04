/**
 * [INPUT]: A current server-App authority, verified controller/surface lease and shared consent/connector ports.
 * [OUTPUT]: DormantServerTunnels, fresh keys per grant, authenticated terminal reasons, immediate revocation and last-grant connector shutdown.
 * [POS]: S7 owner; production has no import or registration path to this class.
 */
import { randomUUID, randomBytes } from "node:crypto";
import { createTunnelPrimitive } from "@ai-chat/cloud-crypto/tunnel";
import { TunnelCodec } from "@ai-chat/cloud-protocol/apps/tunnel/codec";
import { tunnelEndResponse, type TunnelEndReason } from "@ai-chat/cloud-protocol/apps/tunnel/terminal";
import { packHttp } from "@ai-chat/cloud-protocol/apps/tunnel/policy";
import { TUNNEL_LIMITS, type TunnelGrant } from "@ai-chat/cloud-protocol/apps/tunnel/model";
import type { ConnectorSupervisor } from "../../../tunnel/connectors/supervisor";
import type { TunnelConsent } from "../../../tunnel/runtime/consent";
import { createServerTunnelEndpoint, type EndpointGrant, type TunnelUpstream } from "./endpoint";
export type ServerSurfaceAuthority = { appId: string; generation: string; lifecycleRevision: number; controllerDeviceId: string; wsDeclared: boolean };
type Entry = EndpointGrant & { scope: ServerSurfaceAuthority; expiresAt: number; touchedAt: number; closed: boolean };
export class DormantServerTunnels {
  private readonly grants = new Map<string, Entry>();
  private endpoint: Awaited<ReturnType<typeof createServerTunnelEndpoint>> | null = null;
  private flight: Promise<void> | null = null;
  private stopped = false;
  private opening = 0;
  private readonly openings = new Set<Promise<TunnelGrant>>();
  private readonly key = randomUUID();
  private readonly challenge = randomBytes(24).toString("base64url");
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly ports: { consent: Pick<TunnelConsent, "require" | "enabled">; connectors: ConnectorSupervisor;
    authorize(surfaceLeaseId: string, controllerDeviceId: string): Promise<ServerSurfaceAuthority>;
    current(scope: ServerSurfaceAuthority): Promise<TunnelUpstream | null>; changed(): void }) {
    this.timer = setInterval(() => { for (const grant of this.grants.values()) void this.current(grant, false).catch(cause => grant.close(this.endReason(cause))); }, 1000); this.timer.unref();
  }
  private async initialize() {
    if (this.endpoint) return;
    this.flight ??= (async () => { this.endpoint = await createServerTunnelEndpoint(id => this.grants.get(id) ?? null, this.challenge); })().finally(() => { this.flight = null; });
    await this.flight;
    if (this.stopped) { const endpoint = this.endpoint as Awaited<ReturnType<typeof createServerTunnelEndpoint>> | null; await endpoint?.close(); this.endpoint = null; throw new Error("tunnel-closed"); }
  }
  open(surfaceLeaseId: string, controllerDeviceId: string, origin: "desktop" | "remote"): Promise<TunnelGrant> {
    if (this.stopped || this.grants.size + this.opening >= 3) return Promise.reject(new Error("tunnel-grant-limit"));
    this.opening++;
    const flight = this.create(surfaceLeaseId, controllerDeviceId, origin).finally(() => { this.opening--; this.openings.delete(flight); });
    this.openings.add(flight); return flight;
  }
  private async create(surfaceLeaseId: string, controllerDeviceId: string, origin: "desktop" | "remote"): Promise<TunnelGrant> {
    if (this.stopped) throw new Error("tunnel-closed");
    await this.ports.consent.require(origin); const scope = await this.ports.authorize(surfaceLeaseId, controllerDeviceId);
    if (scope.controllerDeviceId !== controllerDeviceId) throw new Error("tunnel-controller-invalid");
    if (this.stopped) throw new Error("tunnel-closed");
    await this.initialize();
    const primitive = await createTunnelPrimitive(), key = primitive.random(32), grantId = randomUUID(), expiresAt = Date.now() + TUNNEL_LIMITS.lifetimeMs;
    let acquired = false;
    const entry: Entry = { grantId, scope, expiresAt, touchedAt: Date.now(), closed: false, wsDeclared: scope.wsDeclared,
      codec: new TunnelCodec(primitive, grantId, key, "owner", () => entry.close()),
      current: async () => {
        try { return await this.current(entry, true); }
        catch (cause) { entry.close(this.endReason(cause)); throw cause; }
      },
      close: (reason = "tunnel-connect-failed") => {
        if (entry.closed) return; entry.closed = true;
        // Seal the final explanation before erasing the key; authorization ends before delivery can wait.
        let terminal: Uint8Array | undefined;
        const bytes = packHttp(tunnelEndResponse(reason));
        try { terminal = entry.codec.seal("response", bytes); } catch { /* Invalid codecs cannot authenticate a reason. */ }
        finally { bytes.fill(0); entry.codec.close(); }
        this.grants.delete(grantId); this.endpoint?.revoke(grantId, terminal);
        if (acquired) { acquired = false; void this.ports.connectors.release(this.key).catch(() => undefined); } this.ports.changed();
      } };
    this.grants.set(grantId, entry);
    try {
      const hostname = await this.ports.connectors.acquire(this.key, this.endpoint!.port, this.challenge, this.ports.changed);
      acquired = true;
      if (entry.closed) { acquired = false; await this.ports.connectors.release(this.key); throw new Error("tunnel-closed"); }
      await entry.current();
      return { grantId, tunnelUrl: `https://${hostname}`, sessionKey: Buffer.from(key).toString("base64url"), expiresAt, idleSeconds: TUNNEL_LIMITS.idleMs / 1000, wsDeclared: scope.wsDeclared };
    } catch (error) { entry.close(this.endReason(error)); throw error; } finally { key.fill(0); }
  }
  private async current(entry: Entry, activity: boolean) {
    if (entry.closed || this.stopped) throw new Error("tunnel-revoked");
    if (!this.ports.consent.enabled()) throw new Error("tunnel-plugin-disabled");
    if (Date.now() >= entry.expiresAt || Date.now() - entry.touchedAt >= TUNNEL_LIMITS.idleMs) throw new Error("tunnel-expired");
    const target = await this.ports.current(entry.scope);
    if (!target || target.generation !== entry.scope.generation || target.lifecycleRevision !== entry.scope.lifecycleRevision ||
      !Number.isInteger(target.port) || target.port < 1024 || target.port > 65535 || !/^https?:\/\/[^/]+$/.test(target.origin)) throw new Error("tunnel-revoked");
    if (entry.closed || this.stopped) throw new Error("tunnel-revoked");
    if (!this.ports.consent.enabled()) throw new Error("tunnel-plugin-disabled");
    if (Date.now() >= entry.expiresAt) throw new Error("tunnel-expired");
    if (activity) entry.touchedAt = Date.now(); return target;
  }
  private endReason(cause: unknown): TunnelEndReason {
    if (!this.ports.consent.enabled()) return "tunnel-plugin-disabled";
    const code = cause instanceof Error ? cause.message : "";
    return code === "tunnel-expired" || code === "tunnel-revoked" ? code : "tunnel-connect-failed";
  }
  revokeController(controllerDeviceId: string) { for (const entry of this.grants.values()) if (entry.scope.controllerDeviceId === controllerDeviceId) entry.close("tunnel-revoked"); }
  revokeAll() { for (const entry of this.grants.values()) entry.close(this.ports.consent.enabled() ? "tunnel-revoked" : "tunnel-plugin-disabled"); }
  closeGrant(grantId: string, controllerDeviceId: string) { const entry = this.grants.get(grantId); if (entry?.scope.controllerDeviceId === controllerDeviceId) entry.close(); }
  async close() { this.stopped = true; clearInterval(this.timer); for (const entry of this.grants.values()) entry.close(); await this.ports.connectors.stop(this.key);
    await Promise.allSettled(this.openings); await this.flight; await this.endpoint?.close(); }
}
