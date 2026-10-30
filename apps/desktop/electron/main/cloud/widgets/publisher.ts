/**
 * [INPUT]: Depends on pinned immutable packets, current authenticated Main account/source scope, verified reviews and original filesystem ciphertext custody.
 * [OUTPUT]: Provides one bounded WidgetPackagePublisher with original-file replay, independent remote-receipt checks, cancellation and exact owned cleanup.
 * [POS]: Asynchronous package delivery; the existing package owner retains intent/pin truth and decides when local delivery is complete.
 */
import { rm, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonicalJson } from "@bottega/contracts/core/canonical-json";
import {
  WIDGET_PACKAGE_BUDGET as BUDGET,
  type WidgetPackageDescriptor,
} from "@bottega/contracts/plugins/dock/packages";
import {
  assertWidgetPackageDelivery,
  widgetPackageResultSchema,
  type WidgetPackageDelivery,
} from "@ai-chat/cloud-protocol/widgets/model";
import { prepareEncryptedFile } from "@ai-chat/cloud-protocol/blobs/encrypted/client";
import {
  ciphertextFileDescriptor,
  type EncryptedBlobTransfer,
} from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { EncryptedBusinessHeader } from "@ai-chat/cloud-protocol/spaces";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../runtime/transport/transport";
import {
  appCiphertextDirectory,
  appCiphertextJournal,
} from "../../apps/share/package/custody/ciphertext";
import { verifyPackage } from "../../plugins/surface-runtime/packages/codec";
import { buildWidgetPackageReview } from "./review";
import {
  widgetDeliveryCall,
  widgetUploadAttempts,
  createWidgetRetryBudget,
  uploadWidgetFile,
} from "./requests";
import { widgetPackageOwnerId } from "@ai-chat/cloud-protocol/widgets/model";

type Frozen = {
  reference: string;
  descriptor: WidgetPackageDescriptor;
  bytes: Buffer;
  sourceChat?:{chatId:string};
};
type Ports = {
  userData: string;
  scope: SyncScope;
  crypto(): FileCipherPort;
  header(): EncryptedBusinessHeader;
  current(): boolean;
  transport: Pick<AccountTransport, "query" | "mutate">;
  files: Pick<EncryptedBlobTransfer, "uploadFile" | "close">;
  progress?: Parameters<EncryptedBlobTransfer["uploadFile"]>[6];
};
type Flight = { key: string; promise: Promise<WidgetPackageDelivery> };
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export class WidgetPackagePublisher {
  private closed = false;
  private readonly controller = new AbortController();
  private active: Flight | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly ports: Ports) {}
  async publish(
    input: Frozen,
    external?: AbortSignal,
  ): Promise<WidgetPackageDelivery> {
    if (this.closed) throw new Error("WIDGET_PUBLISHER_CLOSED");
    const bytes = Buffer.from(input.bytes),
      key = canonicalJson([input.reference, hash(bytes)]);
    if (this.active) {
      bytes.fill(0);
      if (this.active.key !== key) throw new Error("WIDGET_PUBLISHER_CAPACITY");
      return this.active.promise;
    }
    const frozen = {
      ...input,
      descriptor: structuredClone(input.descriptor),
      bytes,
    };
    const flight: Flight = { key, promise: Promise.resolve(null as never) };
    const task = this.run(frozen, external).finally(() => {
      bytes.fill(0);
      if (this.active === flight) this.active = null;
    });
    flight.promise = task;
    this.active = flight;
    return task;
  }
  private async run(frozen: Frozen, external?: AbortSignal) {
    const deadline = new AbortController(),
      timer = setTimeout(
        () => deadline.abort(new Error("WIDGET_DELIVERY_TIMEOUT")),
        BUDGET.downloadMs,
      );
    timer.unref?.();
    const signal = AbortSignal.any([
        this.controller.signal,
        deadline.signal,
        ...(external ? [external] : []),
      ]),
      crypto = this.ports.crypto(),
      header = this.ports.header(),
      identity = canonicalJson([
        crypto.session,
        crypto.scope,
        crypto.keyPackageFingerprint,
        header,
      ]);
    const current = () => {
      if (
        this.closed ||
        !this.ports.current() ||
        crypto.session.userId !== this.ports.scope.userId ||
        header.expectedUserId !== crypto.session.userId ||
        identity !==
          canonicalJson([
            this.ports.crypto().session,
            this.ports.crypto().scope,
            this.ports.crypto().keyPackageFingerprint,
            this.ports.header(),
          ])
      )
        throw new Error("WIDGET_DELIVERY_SCOPE_CHANGED");
      signal.throwIfAborted();
    };
    const call = <T>(run: () => Promise<T>) =>
      widgetDeliveryCall(run, signal, current);
    const serial = <T>(run: () => Promise<T>) => {
      const task = this.tail.then(async () => {
        current();
        const value = await run();
        current();
        return value;
      });
      this.tail = task.catch(() => {});
      return task;
    };
    try {
      current();
      const source = {
          accountId: crypto.session.userId,
          installationId: crypto.session.deviceId,
          definitionId: frozen.descriptor.source.definitionId,
          generationId: frozen.descriptor.source.generationId,
        },
        started = performance.now();
      const packet = verifyPackage(frozen.bytes, frozen.reference, source);
      if (
        canonicalJson(packet.descriptor) !== canonicalJson(frozen.descriptor) ||
        performance.now() - started >= BUDGET.verifyMs
      )
        throw new Error("WIDGET_PACKAGE_SOURCE_CHANGED");
      const review = buildWidgetPackageReview(packet, frozen.reference,frozen.sourceChat),
        subject = {
          definitionId: source.definitionId,
          sourceInstallationId: source.installationId,
        },
        owner = { kind: "widget" as const, id: widgetPackageOwnerId(subject) },
        sourceHash = frozen.reference.slice(7);
      const admit = (raw: unknown) => {
        const value = assertWidgetPackageDelivery(raw, {
          accountId: source.accountId,
          subject,
          reference: frozen.reference,
        });
        if (
          value.generationId !== source.generationId ||
          value.contractDigest !== packet.descriptor.contractDigest ||
          value.archiveBytes !== frozen.bytes.length ||
          value.archiveSha256 !== hash(frozen.bytes) ||
          value.reviewBytes !== review.length ||
          value.reviewSha256 !== hash(review) ||
          canonicalJson(value.archive.encryption.encryptedSpace) !==
            canonicalJson(header.encryptedSpace)
        )
          throw new Error("WIDGET_PACKAGE_SOURCE_CHANGED");
        return value;
      };
      const directory = appCiphertextDirectory(
        this.ports.userData,
        this.ports.scope,
        owner.id,
        sourceHash,
        "widget",
      );
      const journal = appCiphertextJournal(
        this.ports.userData,
        this.ports.scope,
        owner.id,
        sourceHash,
        serial,
        "widget",
      );
      const cleanup = () =>
        serial(async () => {
          await journal.read("archive:complete");
          const info = await lstat(directory).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            },
          );
          if (!info) return;
          if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error("WIDGET_TRANSFER_CUSTODY_CHANGED");
          await rm(directory, { recursive: true });
        });
      const existing = widgetPackageResultSchema.parse(
        await call(() =>
          this.ports.transport.query("widgets/api:get", {
            ...header,
            subject,
            reference: frozen.reference,
          }),
        ),
      );
      if (existing?.state === "revoked")
        throw new Error("WIDGET_DEFINITION_REVOKED");
      if (existing?.state === "published") {
        const receipt = admit(existing);
        await cleanup();
        return receipt;
      }
      if (
        existing &&
        (existing.accountId !== source.accountId ||
          existing.reference !== frozen.reference ||
          canonicalJson(existing.subject) !== canonicalJson(subject))
      )
        throw new Error("WIDGET_PACKAGE_SOURCE_CHANGED");
      const prepare = async (key: "archive" | "review", bytes: Buffer) =>
        call(() =>
          prepareEncryptedFile(
            {
              key,
              operationId: key,
              owner,
              ownerGeneration: frozen.reference,
              priority: "background",
              source: {
                sha256: hash(bytes),
                bytes: bytes.length,
                mime: "application/json",
              },
            },
            {
              bytes: bytes.length,
              mime: "application/json",
              read: async (offset, length) =>
                new Uint8Array(bytes.subarray(offset, offset + length)),
            },
            crypto,
            journal,
            signal,
          ),
        );
      const archiveFile = await prepare("archive", frozen.bytes),
        reviewFile = await prepare("review", review);
      const plan = {
        subject,
        reference: frozen.reference,
        generationId: source.generationId,
        contractDigest: packet.descriptor.contractDigest,
        archiveBytes: frozen.bytes.length,
        archiveSha256: hash(frozen.bytes),
        reviewBytes: review.length,
        reviewSha256: hash(review),
        archive: ciphertextFileDescriptor(archiveFile),
        review: ciphertextFileDescriptor(reviewFile),
      };
      await call(() =>
        this.ports.transport.mutate("widgets/api:prepare", { ...header, plan }),
      );
      const attempts = widgetUploadAttempts(directory, serial),retryBudget=createWidgetRetryBudget();
      for (const [key, file] of [
        ["archive", archiveFile],
        ["review", reviewFile],
      ] as const)
        await uploadWidgetFile({
          header,
          scope: this.ports.scope,
          session: crypto.session,
          file,
          key,
          kind: key === "archive" ? "widget-package" : "widget-review",
          journal,
          attempts,
          retryBudget,
          files: this.ports.files,
          transport: this.ports.transport,
          signal,
          current,
          progress: this.ports.progress,
        });
      const receipt = admit(
        await call(() =>
          this.ports.transport.mutate("widgets/api:commit", {
            ...header,
            subject,
            reference: frozen.reference,
          }),
        ),
      );
      await cleanup();
      return receipt;
    } finally {
      clearTimeout(timer);
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort(new Error("WIDGET_PUBLISHER_CLOSED"));
    await this.active?.promise.catch(() => {});
    await this.tail;
    await this.ports.files.close();
  }
}
