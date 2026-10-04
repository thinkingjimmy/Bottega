/**
 * [INPUT]: Depends on AppStore, canonical digests, bounded enablement contracts and injected Chat/runtime lifecycle ports.
 * [OUTPUT]: Provides read-only disable impact and serialized, revision-checked App close/reopen operations.
 * [POS]: Main-owned availability authority; preserves grants, generations, source, queued messages and Base data.
 */
import { setAppEnabledInputSchema, appDisableImpactSchema } from "@ai-chat/cloud-protocol/apps/build-status/enablement";
import type { AppStore } from "../../store/app-store";
import { canonicalDigest } from "../../support";
import { fenceAppDisable } from "./guard";

export type AppConversationActivity = { id: string; title: string; running: boolean; requests: string[]; queued: string[] };
export type AppEnablementPorts = {
  conversations(appId: string): Promise<AppConversationActivity[]>;
  cancel(ids: string[]): Promise<void>;
  notice(appId: string, revision: number, ids: string[]): Promise<void>;
  closeSurfaces(appId: string): Promise<void>;
  wake(ids: string[]): void;
};
export class AppEnablementService {
  private ports: AppEnablementPorts | null = null;
  constructor(private readonly store: AppStore, private readonly stop: (id: string) => Promise<void>,
    private readonly exclusive: <T>(id: string, action: () => Promise<T>) => Promise<T>) {}
  configure(ports: AppEnablementPorts) { this.ports = ports; }
  private requirePorts() { if (!this.ports) throw new Error("app-transitioning"); return this.ports; }
  async impact(appId: string) {
    const app = this.store.get(appId);
    if (!app) throw new Error("app-not-found");
    const activity = (await this.requirePorts().conversations(appId)).sort((a, b) => a.id.localeCompare(b.id));
    const preview = { appId, enabled: app.enabled, revision: app.enabledRevision,
      runningCount: activity.filter(chat => chat.running).length,
      runningChats: activity.filter(chat => chat.running).slice(0, 8).map(({ id, title }) => ({ id, title: title.slice(0, 80) })),
      queuedMessages: activity.reduce((count, chat) => count + chat.queued.length, 0) };
    return appDisableImpactSchema.parse({ ...preview, digest: canonicalDigest({ ...preview,
      requests: activity.map(chat => ({ id: chat.id, requests: [...chat.requests].sort(), queued: [...chat.queued].sort() })) }) });
  }
  async setEnabled(raw: unknown) {
    const input = setAppEnabledInputSchema.parse(raw);
    return this.exclusive(input.appId, async () => {
      // Fence before asynchronous draft reads: consent must not cancel a turn admitted after its preview.
      const release = fenceAppDisable(input.appId);
      try {
        const impact = await this.impact(input.appId), ports = this.requirePorts();
        if (impact.revision !== input.expectedRevision || !input.enabled && input.impactDigest !== impact.digest)
          throw new Error("app-enablement-stale");
        const app = this.store.get(input.appId)!;
        // Installing/updating owns a source mutation; let its transaction settle before changing availability.
        if (["creating", "installing", "updating", "deleting"].includes(app.state)) throw new Error("app-transitioning");
        if (!input.enabled) {
          const disabled = app.enabled ? await this.store.update(app.id, current => ({ ...current,
            enabled: false, enabledRevision: current.enabledRevision + 1 })) : app;
          const running = (await ports.conversations(app.id)).filter(chat => chat.running).map(chat => chat.id);
          // Keep the durable flag closed on any cleanup failure. A retry or reopen repeats cleanup first.
          const outcomes = await Promise.allSettled([ports.cancel(running), this.stop(app.id), ports.closeSurfaces(app.id)]);
          await ports.notice(app.id, disabled.enabledRevision, running);
          const failed = outcomes.find(result => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          return disabled;
        }
        if (!app.enabled) {
          await ports.cancel((await ports.conversations(app.id)).filter(chat => chat.running).map(chat => chat.id));
          await this.stop(app.id);
          await ports.closeSurfaces(app.id);
        }
        const enabled = app.enabled ? app : await this.store.update(app.id, current => ({ ...current,
          enabled: true, enabledRevision: current.enabledRevision + 1 }));
        release();
        ports.wake((await ports.conversations(app.id)).map(chat => chat.id));
        return enabled;
      } finally { release(); }
    });
  }
}
