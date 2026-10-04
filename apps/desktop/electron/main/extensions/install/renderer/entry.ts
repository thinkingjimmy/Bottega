/**
 * [INPUT]: Depends on ExtensionInstaller and the host-package adapter identity.
 * [OUTPUT]: Provides rendererInstallEntry and takeInstallSurface for native, family-bound preflight receipts.
 * [POS]: Shared renderer install boundary; package dependencies and internal recovery keep their existing owner-controlled paths.
 */
import { HOST_PACKAGE_ADAPTER_ID } from "../../host/manifest";
import type { ExtensionInstaller, ExtensionInstallPreflight } from "../installer";
import { pluginInstallRequests } from "./requests";

export type InstallSurface = "plugins" | "extensions";
export function takeInstallSurface(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid install request");
  const { surface, remoteRequestId, ...input } = raw as Record<string, unknown>;
  if (surface !== undefined && surface !== "plugins") throw new Error("Invalid install surface");
  if (remoteRequestId !== undefined && (surface !== "plugins" || typeof remoteRequestId !== "string" || !/^[a-f0-9-]{36}$/.test(remoteRequestId))) throw new Error("Invalid install request identity");
  return { surface: (surface ?? "extensions") as InstallSurface, input, remoteRequestId: remoteRequestId as string | undefined };
}

export function rendererInstallEntry(installer: ExtensionInstaller) {
  const pending = new Map<string, { surface: InstallSurface; remoteRequestId?: string; userId?: string | null }>();
  let closed = false;
  return {
    async preview(surface: InstallSurface, preflight: ExtensionInstallPreflight, remoteRequestId?: string, userId?: string | null) {
      const host = preflight.adapterId === HOST_PACKAGE_ADAPTER_ID;
      const refused = closed || pending.size >= 32 || (surface === "plugins"
        ? !host || preflight.scope.kind !== "global" : host);
      if (refused) {
        await installer.discard(preflight.preflightId);
        throw new Error(closed ? "Install window is closed" : pending.size >= 32 ? "Too many pending installations"
          : host ? "Install this package from Settings > Plugins" : "Install Skills and Agent plugins from Extensions");
      }
      if (remoteRequestId) {
        try { await pluginInstallRequests()!.change(remoteRequestId, "reviewing", userId ?? null); }
        catch (cause) { await installer.discard(preflight.preflightId); throw cause; }
      }
      pending.set(preflight.preflightId, { surface, remoteRequestId, userId });
      return preflight;
    },
    async confirm(surface: InstallSurface, id: string) {
      const held = pending.get(id);
      if (closed || held?.surface !== surface) throw new Error("Install preview expired; review this package again");
      const requests = pluginInstallRequests(), requestId = held.remoteRequestId, userId = requests?.currentUser();
      if (requestId) {
        try {
          if (!requests || !userId || userId !== held.userId) throw new Error("plugin-request-unavailable");
          await requests.change(requestId, "installing", held.userId);
        } catch (cause) { pending.delete(id); await installer.discard(id); throw cause; }
      }
      pending.delete(id);
      return async (state: "installed" | "unknown") => { if (requestId && requests && userId) await requests.finish(requestId, userId, state); };
    },
    async discard(id: string) {
      if (!pending.delete(id)) return;
      await installer.discard(id);
    },
    close() {
      closed = true;
      for (const id of pending.keys()) void installer.discard(id).catch(() => {});
      pending.clear();
    },
  };
}
