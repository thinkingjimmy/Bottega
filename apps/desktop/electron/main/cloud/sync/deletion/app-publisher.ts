/**
 * [INPUT]: Depends on original AppStore deletion requests and the authorized immutable receipt/apply contract.
 * [OUTPUT]: Delivers frozen App deletion requests and saves their exact result before native downlink retirement.
 * [POS]: App deletion outbox adapter; account cleanup can detach pending requests without resending them.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { deliverAppDeletion } from "@ai-chat/cloud-protocol/apps/deletion";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { AppStore } from "../../../apps/store/app-store";
import type { AccountTransport } from "../../runtime/transport";
import { openAppReceipt, prepareAppOperation, type AppCipherPort } from "@ai-chat/cloud-protocol/apps/encrypted/client";
export class DesktopAppDeletionPublisher {
  private readonly header;
  private flights = new Map<string, Promise<void>>();
  private readonly crypto: AppCipherPort;
  constructor(private ports: { config: CloudBuildConfig; scope: SyncScope; apps: AppStore;
    transport: Pick<AccountTransport, "query" | "mutate">; crypto(): AppCipherPort; current(): void; changed(): void }) {
    this.crypto = ports.crypto();
    if (this.crypto.session.userId !== ports.scope.userId) throw new Error("APP_ACCOUNT_CHANGED");
    this.header = { ...protocolHeader(ports.config), expectedUserId: ports.scope.userId,
      encryptedSpace: { scope: this.crypto.scope, keyPackageFingerprint: this.crypto.keyPackageFingerprint } };
  }
  async publish() {
    for (const request of this.ports.apps.portable.deletion.list(this.ports.scope).filter(item => !item.receipt).slice(0, 32)) {
      this.ports.current(); await this.deliver(request.operation.operationId);
    }
  }
  deliver(operationId: string) {
    const existing = this.flights.get(operationId); if (existing) return existing;
    const flight = this.send(operationId); this.flights.set(operationId, flight);
    void flight.finally(() => { if (this.flights.get(operationId) === flight) this.flights.delete(operationId); }).catch(() => {});
    return flight;
  }
  private async send(operationId: string) {
    const { apps, scope, transport, current, changed } = this.ports;
    current(); let request = apps.portable.deletion.get(scope, operationId); current();
    if (!request) throw new Error("APP_DELETION_REQUEST_UNAVAILABLE");
    if (request.receipt) return;
    const signal = new AbortController().signal;
    if (!request.encryption) {
      if (!request.baseline) throw new Error("APP_CIPHERTEXT_REQUIRED");
      const frozen = await prepareAppOperation(request.operation, request.baseline, this.crypto, signal); current();
      request = await apps.portable.deletion.freezeCiphertext(scope, operationId, frozen); current();
    }
    request = await apps.portable.deletion.attempt(scope, operationId); current();
    const frozen = request.encryption!;
    const receipt = await deliverAppDeletion(request.operation, {
      current,
      receipt: async id => {
        const value = await transport.query("apps/api:receipt", { ...this.header, appId: request!.operation.appId, operationId: id }); current();
        return value && openAppReceipt(value, frozen, this.crypto, signal);
      },
      apply: async () => {
        const value = await transport.mutate("apps/api:apply", { ...this.header, operation: frozen.transport }); current();
        return openAppReceipt(value, frozen, this.crypto, signal);
      },
    });
    await apps.portable.deletion.receive(scope, operationId, receipt); current(); changed();
  }
}
