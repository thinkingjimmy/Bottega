/**
 * [INPUT]: Depends on authenticated current account/space metadata, private encrypted file transport, deferred catalog validation and exact immutable package/review verification.
 * [OUTPUT]: Provides bounded cancellable WidgetCloudClient reviews, original-byte downloads and terminal definition retirement without code acceptance or data permission.
 * [POS]: Main-only receiver transport; installation and local version selection remain separate durable owners.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "@bottega/contracts/core/canonical-json";
import { WIDGET_PACKAGE_BUDGET as BUDGET } from "@bottega/contracts/plugins/dock/packages";
import {
  assertWidgetPackageDelivery,
  type WidgetPackageDelivery,
  type WidgetPackageSubject,
} from "@ai-chat/cloud-protocol/widgets/model";
import type { EncryptedBusinessHeader } from "@ai-chat/cloud-protocol/spaces";
import type {
  FileCipherPort,
  EncryptedFileDescriptor,
} from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { FileProgress } from "@ai-chat/cloud-protocol";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../runtime/transport/transport";
import { verifyPackage } from "../../plugins/surface-runtime/packages/codec";
import { widgetDeliveryCall } from "./requests";
import { verifyWidgetPackageReview } from "./review";

type Request = { subject: WidgetPackageSubject; reference: string };
type Ports = {
  scope: SyncScope;
  crypto(): FileCipherPort;
  header(): EncryptedBusinessHeader;
  current(): boolean;
  transport: Pick<AccountTransport, "query" | "mutate">;
  files: Pick<EncryptedBlobTransfer, "readFile" | "close">;
};
export class WidgetCloudClient {
  private readonly controller = new AbortController();
  private readonly flights = new Set<Promise<unknown>>();
  private closed = false;
  constructor(private readonly ports: Ports) {}
  catalog(cursor: string | null, signal?: AbortSignal) {
    return this.run(signal, async context => {
      const { assertWidgetCatalogPage } = await import('@ai-chat/cloud-protocol/widgets/catalog');
      return assertWidgetCatalogPage(await context.call(() => this.ports.transport.query('widgets/api:catalog', {
        ...this.ports.header(), cursor,
      })), this.ports.scope.userId);
    });
  }
  review(input: Request, signal?: AbortSignal) {
    return this.run(signal, async (context) => {
      const delivery = await this.delivery(input, context.call),
        source = {
          accountId: delivery.accountId,
          installationId: delivery.subject.sourceInstallationId,
          definitionId: delivery.subject.definitionId,
          generationId: delivery.generationId,
        };
      const bytes = await this.read(
        delivery.review,
        BUDGET.runtimeFileBytes,
        context,
      );
      const checked = verifyWidgetPackageReview(bytes, delivery, source);
      context.current();
      return { delivery, ...checked };
    });
  }
  download(
    raw: WidgetPackageDelivery,
    signal?: AbortSignal,
    progress?: (value: FileProgress) => void,
  ) {
    return this.run(signal, async (context) => {
      const delivery = await this.delivery(
        { subject: raw.subject, reference: raw.reference },
        context.call,
      );
      if (canonicalJson(delivery) !== canonicalJson(raw))
        throw new Error("WIDGET_PACKAGE_SOURCE_CHANGED");
      const bytes = await this.read(
          delivery.archive,
          BUDGET.packageBytes,
          context,
          progress,
        ),
        started = performance.now();
      verifyPackage(bytes, delivery.reference, {
        accountId: delivery.accountId,
        installationId: delivery.subject.sourceInstallationId,
        definitionId: delivery.subject.definitionId,
        generationId: delivery.generationId,
      });
      if (performance.now() - started >= BUDGET.verifyMs)
        throw new Error("WIDGET_PACKAGE_VERIFY_TIMEOUT");
      context.current();
      return bytes;
    });
  }
  retire(
    subject: WidgetPackageSubject,
    operationId: string,
    signal?: AbortSignal,
  ) {
    return this.run(signal, (context) =>
      context.call(() =>
        this.ports.transport.mutate("widgets/api:retire", {
          ...this.ports.header(),
          subject,
          operationId,
        }),
      ),
    );
  }
  private async delivery(
    input: Request,
    call: <T>(run: () => Promise<T>) => Promise<T>,
  ) {
    const raw = await call(() =>
      this.ports.transport.query("widgets/api:get", {
        ...this.ports.header(),
        ...input,
      }),
    );
    if (raw?.state === "revoked") throw new Error("WIDGET_DEFINITION_REVOKED");
    if (raw?.state !== "published") throw new Error("WIDGET_PACKAGE_NOT_READY");
    return assertWidgetPackageDelivery(raw, {
      accountId: this.ports.scope.userId,
      ...input,
    });
  }
  private async read(
    descriptor: EncryptedFileDescriptor,
    limit: number,
    context: {
      signal: AbortSignal;
      crypto: FileCipherPort;
      current(): void;
      call<T>(run: () => Promise<T>): Promise<T>;
    },
    progress?: (value: FileProgress) => void,
  ) {
    if (descriptor.bytes > limit)
      throw new Error("WIDGET_PACKAGE_CONTENT_BUDGET");
    const chunks: Buffer[] = [];
    let length = 0;
    return context.call(() =>
      this.ports.files.readFile(
        descriptor,
        context.crypto,
        {
          write: async (value) => {
            context.current();
            length += value.length;
            if (length > descriptor.bytes || length > limit)
              throw new Error("WIDGET_PACKAGE_CONTENT_BUDGET");
            chunks.push(Buffer.from(value));
          },
          commit: async () => {
            context.current();
            const bytes = Buffer.concat(chunks);
            if (
              length !== descriptor.bytes ||
              createHash("sha256").update(bytes).digest("hex") !==
                descriptor.sha256
            )
              throw new Error("WIDGET_PACKAGE_SOURCE_CHANGED");
            chunks.length = 0;
            return bytes;
          },
          abort: async () => {
            for (const chunk of chunks) chunk.fill(0);
            chunks.length = 0;
          },
        },
        (value) => {
          context.current();
          progress?.(value);
        },
        context.signal,
      ),
    );
  }
  private run<T>(
    external: AbortSignal | undefined,
    work: (context: {
      signal: AbortSignal;
      crypto: FileCipherPort;
      current(): void;
      call<R>(run: () => Promise<R>): Promise<R>;
    }) => Promise<T>,
  ): Promise<T> {
    const task = async () => {
      if (this.closed || !this.ports.current())
        throw new Error("WIDGET_DELIVERY_SCOPE_CHANGED");
      const crypto = this.ports.crypto(),
        identity = canonicalJson([
          crypto.session,
          crypto.scope,
          crypto.keyPackageFingerprint,
          this.ports.header(),
        ]);
      const signal = AbortSignal.any([
        this.controller.signal,
        AbortSignal.timeout(BUDGET.downloadMs),
        ...(external ? [external] : []),
      ]);
      const current = () => {
        signal.throwIfAborted();
        if (
          this.closed ||
          !this.ports.current() ||
          crypto.session.userId !== this.ports.scope.userId ||
          identity !==
            canonicalJson([
              this.ports.crypto().session,
              this.ports.crypto().scope,
              this.ports.crypto().keyPackageFingerprint,
              this.ports.header(),
            ])
        )
          throw new Error("WIDGET_DELIVERY_SCOPE_CHANGED");
      };
      const call = <R>(run: () => Promise<R>) =>
        widgetDeliveryCall(run, signal, current);
      current();
      return work({ signal, crypto, current, call });
    };
    const flight = task();
    this.flights.add(flight);
    void flight.finally(() => this.flights.delete(flight)).catch(() => {});
    return flight;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort(new Error("WIDGET_DELIVERY_CLOSED"));
    await this.ports.files.close();
    await Promise.allSettled(this.flights);
  }
}
