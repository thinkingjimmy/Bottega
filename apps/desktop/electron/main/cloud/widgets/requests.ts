/**
 * [INPUT]: Depends on current account signals, original ciphertext records, durable bounded attempt counters and existing file transport.
 * [OUTPUT]: Provides fenced cancellable calls and a package-shared two-retry budget with distinct persisted identities and no reuse of terminal upload attempts.
 * [POS]: Widget transfer mechanics inside the original package custody; it owns no independent business queue or permission.
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { WIDGET_PACKAGE_BUDGET as BUDGET } from "@bottega/contracts/plugins/dock/packages";
import type { EncryptedBusinessHeader } from "@ai-chat/cloud-protocol/spaces";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type {
  EncryptedFileDescriptor,
  FileCipherPort,
  FrozenFileJournal,
} from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { AccountTransport } from "../runtime/transport/transport";
import { durableReplaceFile } from "../../persistence/durable-json";

export async function widgetDeliveryCall<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
  current: () => void,
): Promise<T> {
  current();
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () =>
      reject(signal.reason ?? new Error("WIDGET_DELIVERY_CANCELLED"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => {
        current();
        signal.throwIfAborted();
        return run();
      }),
      cancelled,
    ]);
    current();
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
type Serial = <T>(run: () => Promise<T>) => Promise<T>;
export function widgetUploadAttempts(directory: string, serial: Serial) {
  const path = join(directory, "upload-attempts.json");
  const read = async (): Promise<Record<string, number>> => {
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!file) return {};
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > 4096)
        throw new Error("WIDGET_TRANSFER_CUSTODY_CHANGED");
      const value: unknown = JSON.parse(await file.readFile("utf8"));
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length > 2 ||
        Object.entries(value).some(
          ([id, count]) =>
            !/^[a-f0-9-]{36}$/.test(id) ||
            !Number.isSafeInteger(count) ||
            Number(count) < 0 ||
            Number(count) >= Number.MAX_SAFE_INTEGER,
        )
      )
        throw new Error("WIDGET_TRANSFER_CUSTODY_CHANGED");
      return value as Record<string, number>;
    } finally {
      await file.close();
    }
  };
  return {
    current: async (id: string) => (await read())[id] ?? 0,
    renew: (id: string) =>
      serial(async () => {
        const value = await read();
        value[id] = (value[id] ?? 0) + 1;
        await durableReplaceFile(path, JSON.stringify(value));
      }),
  };
}
export function createWidgetRetryBudget() {
  let used = 0;
  return {
    get used() {
      return used;
    },
    consume() {
      if (used >= BUDGET.retries)
        throw new Error("WIDGET_TRANSFER_RETRY_LIMIT");
      used++;
    },
  };
}
export async function uploadWidgetFile(input: {
  header: EncryptedBusinessHeader;
  scope: unknown;
  session: FileCipherPort["session"];
  file: EncryptedFileDescriptor;
  key: string;
  kind: "widget-package" | "widget-review";
  journal: FrozenFileJournal;
  attempts: ReturnType<typeof widgetUploadAttempts>;
  retryBudget?: ReturnType<typeof createWidgetRetryBudget>;
  files: Pick<EncryptedBlobTransfer, "uploadFile">;
  transport: Pick<AccountTransport, "query">;
  signal: AbortSignal;
  current(): void;
  progress?: Parameters<EncryptedBlobTransfer["uploadFile"]>[6];
}) {
  const { signal, current } = input,
    budget = input.retryBudget ?? createWidgetRetryBudget();
  const renew = async () => {
    budget.consume();
    await input.attempts.renew(input.file.blobId);
  };
  while (true) {
    const attempt = await input.attempts.current(input.file.blobId),
      id = hashCanonical([
        hashCanonical([
          "widget-package-upload",
          input.scope,
          input.session,
          input.file.blobId,
        ]),
        attempt,
      ]);
    const status = () =>
      widgetDeliveryCall(
        () =>
          input.transport.query("blobs/api:status", {
            ...input.header,
            uploadId: id,
          }),
        signal,
        current,
      ).catch((error: unknown) => {
        if (
          (error instanceof Error && error.message === "upload-not-found") ||
          (error &&
            typeof error === "object" &&
            "data" in error &&
            error.data === "upload-not-found")
        )
          return null;
        throw error;
      });
    const terminal = (value: Awaited<ReturnType<typeof status>>) =>
      value && ["expired", "failed", "cancelled"].includes(value.state);
    if (terminal(await status())) {
      await renew();
      continue;
    }
    try {
      await widgetDeliveryCall(
        () =>
          input.files.uploadFile(
            input.header,
            id,
            input.kind,
            input.file,
            input.journal,
            input.key,
            input.progress,
            signal,
          ),
        signal,
        current,
      );
      return;
    } catch (error) {
      signal.throwIfAborted();
      current();
      const value = await status().catch(() => null);
      signal.throwIfAborted();
      current();
      if (!terminal(value)) throw error;
      await renew();
    }
  }
}
