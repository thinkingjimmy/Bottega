/**
 * [INPUT]: Depends on the existing immutable package journal and the deferred current-account Cloud port.
 * [OUTPUT]: Provides one resumable WidgetDeliveryQueue with explicit original-byte retry, abandon and owned cancellation.
 * [POS]: Source delivery scheduler; its only durable truth is WidgetPackageStore and local execution never awaits this queue.
 */
import type { WidgetPackageStore } from "../../plugins/surface-runtime/packages/store";
import type { WidgetCloudPort } from "./ports";
export class WidgetDeliveryQueue {
  private closed = false;
  private flight: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private reference: string | null = null;
  private readonly unsubscribe: () => void;
  constructor(
    private readonly store: WidgetPackageStore,
    private readonly ports: {
      cloud(): WidgetCloudPort | null;
      changed(): void;
    },
  ) {
    this.unsubscribe = store.onChanged(() => this.wake());
  }
  activeReference() {
    return this.reference;
  }
  wake() {
    if (this.closed || this.flight) return;
    if (
      !this.store
        .deliveryRecords()
        .some((entry) => entry.delivery === "pending" && !entry.error) ||
      !this.ports.cloud()?.available()
    )
      return;
    const controller = new AbortController();
    this.controller = controller;
    const task = Promise.resolve()
      .then(() => this.run(controller.signal))
      .catch((error) => {
        if (!this.closed)
          console.warn("[widgets] delivery queue stopped", error);
      })
      .finally(() => {
        if (this.flight === task) {
          this.flight = null;
          this.controller = null;
          this.reference = null;
          this.ports.changed();
        }
      });
    this.flight = task;
  }
  private async run(signal: AbortSignal) {
    while (!this.closed && !signal.aborted) {
      const cloud = this.ports.cloud();
      if (!cloud?.available()) return;
      const next = this.store
        .deliveryRecords()
        .find((entry) => entry.delivery === "pending" && !entry.error);
      if (!next) return;
      this.reference = next.reference;
      this.ports.changed();
      try {
        const packet = await this.store.readFrozen(next.reference);
        signal.throwIfAborted();
        const receipt = await cloud.publish(packet, signal);
        signal.throwIfAborted();
        if (this.closed) return;
        await this.store.completeDelivery(next.reference, receipt);
      } catch {
        if (this.closed || signal.aborted) return;
        try {
          await this.store.failDelivery(
            next.reference,
            "WIDGET_DELIVERY_FAILED",
          );
        } catch {
          console.warn("[widgets] original delivery scope is unavailable");
        }
        return;
      }
    }
  }
  cancelDefinition(subject:{definitionId:string;sourceInstallationId:string}){
    const active=this.reference?this.store.deliveryRecords().find(value=>value.reference===this.reference):undefined;
    if(active?.descriptor.source.definitionId===subject.definitionId&&active.descriptor.source.installationId===subject.sourceInstallationId)this.controller?.abort(new Error('WIDGET_DEFINITION_REVOKED'));
  }
  async retry(reference: string) {
    if (this.closed) throw new Error("WIDGET_DELIVERY_CLOSED");
    await this.store.retryDelivery(reference);
    this.wake();
  }
  async abandon(reference: string) {
    if (this.closed) throw new Error("WIDGET_DELIVERY_CLOSED");
    await this.store.abandonDelivery(reference);
    if (this.reference === reference)
      this.controller?.abort(new Error("WIDGET_DELIVERY_ABANDONED"));
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.controller?.abort(new Error("WIDGET_DELIVERY_CLOSED"));
    await this.flight;
  }
}
