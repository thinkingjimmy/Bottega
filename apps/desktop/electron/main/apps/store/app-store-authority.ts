/**
 * [INPUT]: Depends on Node filesystem/crypto paths and durable atomic text/byte replacement
 * [OUTPUT]: Provides typed marker/catalog authority inspection plus receipt-gated, byte-preserving App catalog repair
 * [POS]: AppStore authority witness; separates catalog damage from marker I/O and forbids canonical replacement without durable evidence
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  durableReplaceBytes,
  durableReplaceFile,
} from "../../persistence/durable-json";
import { errorMessage } from "../../errors";

const AUTHORITY_MARKER = Buffer.from("apps-store-authority-v1\n");

type MarkerInspection =
  | Readonly<{ kind: "valid" }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid"; cause: unknown }>;

type QuarantineReceipt = Readonly<{
  path: string;
  byteLength: number;
  digest: string;
}>;

type CatalogInspection =
  | Readonly<{ kind: "valid"; count: number }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{
      kind: "invalid";
      cause: unknown;
      quarantine: QuarantineReceipt | null;
    }>;

export type AppStoreAuthorityInspection = Readonly<{
  state: "established-empty" | "established" | "degraded-corrupt";
  initializedNow: boolean;
  failure: "catalog" | "marker" | null;
  marker: MarkerInspection;
  catalog: CatalogInspection;
}>;

export class AppStoreAuthorityEvidence {
  readonly markerPath: string;

  constructor(userData: string) {
    this.markerPath = join(userData, "apps-store.seed");
  }

  establish() {
    return durableReplaceBytes(this.markerPath, AUTHORITY_MARKER);
  }

  async inspectCanonical(input: Readonly<{
    filePath: string;
    emptyContent: string;
    validate(content: string): number;
  }>): Promise<AppStoreAuthorityInspection> {
    let marker = await this.inspectMarker();
    const catalog = await this.inspectCatalog(input.filePath, input.validate);
    if (catalog.kind === "valid") {
      if (marker.kind === "missing") {
        try {
          await this.establish();
          marker = { kind: "valid" };
        } catch (cause) {
          marker = { kind: "invalid", cause };
        }
      }
      if (marker.kind === "valid") return established(catalog, marker, false);
      this.warnMarker(marker.cause);
      return degraded("marker", catalog, marker);
    }
    if (catalog.kind === "missing" && marker.kind === "missing") {
      try {
        await this.establish();
        marker = { kind: "valid" };
      } catch (cause) {
        marker = { kind: "invalid", cause };
        this.warnMarker(cause);
        return degraded("marker", catalog, marker);
      }
      try {
        await durableReplaceFile(input.filePath, input.emptyContent);
        return established({ kind: "valid", count: 0 }, marker, true);
      } catch (cause) {
        console.warn("[apps] empty App catalog publication failed", cause);
        return degraded("catalog", catalog, marker);
      }
    }
    if (catalog.kind === "invalid") {
      console.warn(
        `[apps] apps.json 无法验证，App authority 已降级${catalog.quarantine ? `（原字节隔离件 ${catalog.quarantine.path}）` : "（没有可验证隔离件，禁止 Repair 覆盖）"}：${errorMessage(catalog.cause)}`
      );
    }
    return degraded("catalog", catalog, marker);
  }

  async repairCanonical(input: Readonly<{
    filePath: string;
    emptyContent: string;
    inspection: AppStoreAuthorityInspection;
  }>) {
    const { catalog } = input.inspection;
    if (catalog.kind === "valid") {
      await this.establish();
      return { state: stateForCount(catalog.count), rebuiltCatalog: false };
    }
    await this.establish();
    if (catalog.kind === "invalid") {
      if (!catalog.quarantine) {
        throw new Error("App catalog 没有 durable 原字节隔离 receipt，拒绝 Repair 覆盖");
      }
      /* receipt 只需在覆盖前紧挨着验一次：`establish()` 写的是 marker，动不了
         canonical 字节，把同一句断言抄在它两侧只是两倍 I/O，不是两倍安全。 */
      await this.assertReceipt(input.filePath, catalog.quarantine);
    }
    await durableReplaceFile(input.filePath, input.emptyContent);
    return { state: "established-empty" as const, rebuiltCatalog: true };
  }

  private async inspectMarker(): Promise<MarkerInspection> {
    try {
      const marker = await readFile(this.markerPath);
      return marker.equals(AUTHORITY_MARKER)
        ? { kind: "valid" }
        : { kind: "invalid", cause: new Error("authority marker 内容无效") };
    } catch (cause) {
      return (cause as NodeJS.ErrnoException).code === "ENOENT"
        ? { kind: "missing" }
        : { kind: "invalid", cause };
    }
  }

  private async inspectCatalog(
    filePath: string,
    validate: (content: string) => number
  ): Promise<CatalogInspection> {
    let bytes: Buffer;
    try {
      bytes = await readFile(filePath);
    } catch (cause) {
      return (cause as NodeJS.ErrnoException).code === "ENOENT"
        ? { kind: "missing" }
        : { kind: "invalid", cause, quarantine: null };
    }
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { kind: "valid", count: validate(content) };
    } catch (cause) {
      const quarantine = await this.quarantineBytes(filePath, bytes).catch(
        () => null
      );
      return { kind: "invalid", cause, quarantine };
    }
  }

  private async quarantineBytes(filePath: string, bytes: Buffer) {
    const path = `${filePath}.corrupt-${Date.now()}-${randomUUID()}`;
    await durableReplaceBytes(path, bytes);
    const persisted = await readFile(path);
    if (!persisted.equals(bytes)) throw new Error("App quarantine byte receipt mismatch");
    return { path, byteLength: bytes.byteLength, digest: digest(bytes) };
  }

  private async assertReceipt(filePath: string, receipt: QuarantineReceipt) {
    const [canonical, quarantine] = await Promise.all([
      readFile(filePath),
      readFile(receipt.path),
    ]);
    if (
      canonical.byteLength !== receipt.byteLength ||
      quarantine.byteLength !== receipt.byteLength ||
      digest(canonical) !== receipt.digest ||
      digest(quarantine) !== receipt.digest ||
      !canonical.equals(quarantine)
    ) {
      throw new Error("App catalog 已变化或 quarantine receipt 无法验证，拒绝 Repair 覆盖");
    }
  }

  private warnMarker(cause: unknown) {
    console.warn(`[apps] AppStore authority marker I/O failure：${errorMessage(cause)}`);
  }
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stateForCount(count: number) {
  return count ? "established" as const : "established-empty" as const;
}

function established(
  catalog: Extract<CatalogInspection, { kind: "valid" }>,
  marker: Extract<MarkerInspection, { kind: "valid" }>,
  initializedNow: boolean
): AppStoreAuthorityInspection {
  return {
    state: stateForCount(catalog.count),
    initializedNow,
    failure: null,
    marker,
    catalog,
  };
}

function degraded(
  failure: "catalog" | "marker",
  catalog: CatalogInspection,
  marker: MarkerInspection
): AppStoreAuthorityInspection {
  return {
    state: "degraded-corrupt",
    initializedNow: false,
    failure,
    marker,
    catalog,
  };
}
