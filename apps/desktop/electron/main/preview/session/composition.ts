/**
 * [INPUT]: Startup's plugin catalog, native dialog, locale and immutable Chat/workspace resolver.
 * [OUTPUT]: createPreviewFeature with shared consent/supply/connectors, distinct listener drainage and service shutdown, and verified catalog health facts.
 * [POS]: Main composition; disabling revokes ingress before terminating every owned process.
 */
import { app, dialog } from "electron";
import { join } from "node:path";
import type { PluginCatalog, BuiltinOwner } from "../../plugins/catalog";
import { TunnelSupply } from "../../tunnel/runtime/supply";
import { TunnelConsent } from "../../tunnel/runtime/consent";
import { ConnectorSupervisor } from "../../tunnel/connectors/supervisor";
import { launchConnector } from "../../tunnel/connectors/process";
import { PreviewServerSupervisor } from "../process/supervisor";
import { PreviewCaptures } from "../process/capture";
import { PreviewSessions } from "./manager";
import { previewNativeCopy } from "./copy";
import { installPreviewFeature } from "./runtime";
export type PreviewFeature = Awaited<ReturnType<typeof createPreviewFeature>>;
export async function createPreviewFeature(input: { userData: string; catalog: PluginCatalog; locale(): string;
  current(chatId: string, incarnationId: string, workspace: string): string | boolean }) {
  const supply = new TunnelSupply(input.userData);
  const consent = new TunnelConsent(input.userData, supply, async () => {
    const copy = previewNativeCopy(input.locale());
    const answer = await dialog.showMessageBox({ type: "question", title: copy[2], message: copy[2], detail: copy[3],
      buttons: [copy[4], copy[5]], defaultId: 1, cancelId: 1, noLink: true });
    return answer.response === 0;
  });
  await consent.initialize();
  let connectors = new ConnectorSupervisor(port => launchConnector(supply, port));
  const changed = () => { void input.catalog.refresh().catch(() => undefined); };
  const services: PreviewServerSupervisor = new PreviewServerSupervisor(input.current, (serverId, reason) => reason === "listener-changed" ? sessions.invalidate(serverId) : sessions.revoke(serverId, false));
  const sessions: PreviewSessions = new PreviewSessions(() => services, consent, () => connectors, changed);
  const captures = new PreviewCaptures(join(app.isPackaged ? process.resourcesPath : join(__dirname, ".."), "tunnel/bin/preview-capture"), services);
  const text = (index: number) => ({ text: previewNativeCopy(input.locale())[index]! });
  const owner: BuiltinOwner = {
    descriptor: { id: "tunnel", source: "builtin", kind: "feature", name: text(0), summary: text(1), icon: "tunnel",
      provides: ["bottega.tunnel/v1"], requires: [], turnOn: { mode: "direct" }, turnOff: { allowed: true }, settings: [],
      capabilities: [{ label: text(3), id: null }] },
    enabled: consent.enabled, turnedOffAt: consent.turnedOffAt,
    unsupported: () => supply.supported ? null : text(6),
    async setEnabled(enabled) {
      if (enabled && !supply.supported) throw new Error("plugin-unsupported");
      if (enabled === consent.enabled()) return;
      await consent.setEnabled(enabled);
      if (!enabled) { await sessions.revokeAll(); await connectors.close(); }
      else connectors = new ConnectorSupervisor(port => launchConnector(supply, port));
      changed();
    },
    effects: async () => [{ kind: "tunnel-sessions-closed", count: sessions.count(), label: text(10) },
      { kind: "tunnel-grants-revoked", count: 0, label: text(11) }],
    async health() {
      let verified = false;
      try { const file = await supply.openVerified(); await file.close(); verified = true; } catch { /* Not downloaded or no longer trusted. */ }
      const views = connectors.views(), latest = Math.max(0, ...views.map(v => v.checkedAt ?? 0));
      return { level: verified ? "ok" : "attention", summary: text(!consent.consented() ? 7 : verified ? 8 : 9),
        checkedAt: Date.now(), facts: [
          { label: text(12), value: { text: supply.version } },
          { label: text(17), value: { text: verified ? supply.version : "—" } },
          { label: text(18), value: { text: verified ? supply.executableSha256 : "—" } },
          { label: text(19), value: { text: verified ? supply.teamId : "—" } }, { label: text(13), value: text(verified ? 8 : 9) },
          { label: text(16), value: { text: process.platform + "/" + process.arch } },
          { label: text(14), value: { text: views.map(v => v.state).join(", ") || "0" } },
          { label: text(15), value: { text: latest ? new Date(latest).toISOString() : "—" } },
          { label: text(10), value: { text: String(sessions.count()) } }, { label: text(11), value: { text: "0" } }] };
    },
  };
  const release = input.catalog.addOwnerSource(() => [owner], { reservedIds: ["tunnel"] });
  const feature = { supply, consent, services, sessions, captures,
    async close() { captures.close(); await sessions.close(); await services.close(); await connectors.close(); await consent.close(); release(); installPreviewFeature(null); } };
  installPreviewFeature(feature); return feature;
}
