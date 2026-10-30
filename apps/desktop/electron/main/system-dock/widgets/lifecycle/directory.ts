/**
 * [INPUT]: Depends on the existing current-account Cloud head/page/review ports and the terminal local definition owner.
 * [OUTPUT]: Provides WidgetAccountDirectory with revision-driven verified zero-instance metadata, original source Chat routing and received revocation delivery.
 * [POS]: Deferred account discovery; it downloads no runtime archive, creates no writable source and grants no execution or data access.
 */
import {
  canonicalJson,
  hashCanonical,
} from "@bottega/contracts/core/canonical-json";
import { WIDGET_PACKAGE_BUDGET } from "@bottega/contracts/plugins/dock/packages";
import type { WidgetCatalogEntry } from "@ai-chat/cloud-protocol/widgets/catalog";
import type { WidgetPackageSubject } from "@ai-chat/cloud-protocol/widgets/model";
import type { WidgetCloudPort } from "../../../cloud/widgets/ports";
import type { LocalWidgetScope } from "../../store/custom/model";
import type { WidgetAccountDefinition } from "../../../../../shared/system-dock/widgets/install/types";
type Ports = {
  scope(): LocalWidgetScope;
  cloud(): WidgetCloudPort | null;
  revoked(entry: WidgetCatalogEntry): Promise<void>;
  connected?(): void;
  changed(): void;
};
type Entry = { identity: string; view: WidgetAccountDefinition };
type Binding = {
  key: string;
  cloud: WidgetCloudPort;
  release(): void;
  controller: AbortController;
  requested: number | null;
  loaded: number | null;
  flight: Promise<void> | null;
};
export class WidgetAccountDirectory {
  private closed = false;
  private binding: Binding | null = null;
  private entries = new Map<string, Entry>();
  private pending = new Set<string>();
  private cacheScope: string;
  constructor(private readonly ports: Ports) {
    this.cacheScope = canonicalJson(ports.scope());
  }
  definitions() {
    if (this.cacheScope !== canonicalJson(this.ports.scope())) return [];
    return [...this.entries.values()].map((value) =>
      structuredClone(value.view),
    );
  }
  preparing(subject:WidgetPackageSubject,reference:string){return this.cacheScope===canonicalJson(this.ports.scope())&&this.pending.has(hashCanonical([{definitionId:subject.definitionId,sourceInstallationId:subject.sourceInstallationId},reference]));}
  edit(subject: WidgetPackageSubject) {
    if (this.cacheScope !== canonicalJson(this.ports.scope()))
      throw new Error("WIDGET_CATALOG_ACCOUNT_CHANGED");
    const value = this.entries.get(
      hashCanonical({
        definitionId: subject.definitionId,
        sourceInstallationId: subject.sourceInstallationId,
      }),
    )?.view;
    if (!value?.sourceChatId) throw new Error("DOCK_WIDGET_SOURCE_UNAVAILABLE");
    return {
      chatId: value.sourceChatId,
      sourceInstallationId: subject.sourceInstallationId,
    };
  }
  reconcile() {
    if (this.closed) return;
    const key = canonicalJson(this.ports.scope()),
      cloud = this.ports.cloud();
    if (this.cacheScope !== key) {
      this.cacheScope = key;
      this.entries.clear();this.pending.clear();
      this.ports.changed();
    }
    if (
      this.binding &&
      (this.binding.key !== key ||
        this.binding.cloud !== cloud ||
        !cloud?.available())
    ) {
      const old = this.binding;
      this.binding = null;
      old.controller.abort();
      old.release();
      if (old.key !== key) {
        this.entries.clear();this.pending.clear();
        this.ports.changed();
      }
    }
    if (this.binding || !cloud?.available()) return;
    const binding: Binding = {
      key,
      cloud,
      controller: new AbortController(),
      release: () => {},
      requested: null,
      loaded: null,
      flight: null,
    };
    this.binding = binding;
    try {
      binding.release = cloud.watchCatalog(
        (revision) => {
          if (this.binding !== binding) return;
          this.ports.connected?.();
          if (binding.requested === revision) return;
          binding.requested = revision;
          this.load(binding);
        },
        () => {
          if (this.binding === binding) {
            this.binding = null;
            binding.controller.abort();
            binding.release();
          }
        },
      );
      if (this.binding !== binding) binding.release();
    } catch {
      if (this.binding === binding) this.binding = null;
      binding.controller.abort();
    }
  }
  private load(binding: Binding) {
    if (binding.flight || binding.requested === binding.loaded) return;
    const task = Promise.resolve()
      .then(async () => {
        while (
          this.binding === binding &&
          !this.closed &&
          binding.loaded !== binding.requested
        ) {
          const revision = binding.requested,
            next = new Map<string, Entry>(),pending=new Set<string>(),
            signal = AbortSignal.any([
              binding.controller.signal,
              AbortSignal.timeout(WIDGET_PACKAGE_BUDGET.downloadMs),
            ]);
          const current = () => {
            signal.throwIfAborted();
            if (
              this.closed ||
              this.binding !== binding ||
              canonicalJson(this.ports.scope()) !== binding.key
            )
              throw new Error("WIDGET_CATALOG_ACCOUNT_CHANGED");
          };
          let cursor: string | null = null;
          do {
            current();
            const page = await binding.cloud.catalog(cursor, signal);
            current();
            for (const entry of page.page) {
              if (entry.accountId !== this.ports.scope().accountId)
                throw new Error("WIDGET_CATALOG_ACCOUNT_CHANGED");
              if(entry.state==='active')for(const reference of entry.pending??[])pending.add(hashCanonical([entry.subject,reference]));
              if (entry.state === "revoked") {
                await this.ports.revoked(entry);
                current();
                continue;
              }
              if (!entry.latest) continue;
              const id = hashCanonical(entry.subject),
                identity = canonicalJson(entry.latest),
                previous = this.entries.get(id);
              if (previous?.identity === identity) {
                next.set(id, previous);
                continue;
              }
              const checked = await binding.cloud.review(
                { subject: entry.subject, reference: entry.latest.reference },
                signal,
              );
              current();
              if (canonicalJson(checked.delivery) !== identity)
                throw new Error("WIDGET_PACKAGE_SOURCE_CHANGED");
              next.set(id, {
                identity,
                view: {
                  key: "account-" + id,
                  ...entry.subject,
                  reference: entry.latest.reference,
                  name: checked.manifest.name,
                  description: "",
                  ...(checked.sourceChat
                    ? { sourceChatId: checked.sourceChat.chatId }
                    : {}),
                },
              });
              if (next.size > WIDGET_PACKAGE_BUDGET.retainedPackages)
                throw new Error("WIDGET_PACKAGE_STORAGE_FULL");
            }
            const following = page.isDone ? null : page.continueCursor;
            if (following !== null && following === cursor)
              throw new Error("WIDGET_CATALOG_CURSOR_CHANGED");
            cursor = following;
          } while (cursor !== null);
          current();
          this.entries = next;this.pending=pending;
          binding.loaded = revision;
          this.ports.changed();
        }
      })
      .catch(() => {})
      .finally(() => {
        if (binding.flight === task) binding.flight = null;
      });
    binding.flight = task;
  }
  async close() {
    this.closed = true;
    const binding = this.binding;
    this.binding = null;
    binding?.controller.abort();
    binding?.release();
    await binding?.flight;
    this.entries.clear();this.pending.clear();
  }
}
