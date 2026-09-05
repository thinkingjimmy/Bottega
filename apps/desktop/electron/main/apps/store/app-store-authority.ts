/**
 * [INPUT]: Depends on Node filesystem/crypto paths, the current App catalog schema version, and durable atomic text/byte replacement
 * [OUTPUT]: Provides typed marker/catalog authority inspection, receipt-gated byte-preserving repair, and foreign-schema quarantine followed by an empty current-schema publication
 * [POS]: AppStore authority witness and sole startup catalog replacement owner; separates schema discontinuity, catalog damage, and marker I/O while forbidding canonical replacement without durable evidence
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
      kind: "foreign";
      schemaVersion: unknown;
      quarantine: QuarantineReceipt | null;
    }>
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
    schemaVersion: number;
    validate(raw: unknown): number;
  }>): Promise<AppStoreAuthorityInspection> {
    let marker = await this.inspectMarker();
    const catalog = await this.inspectCatalog(
      input.filePath,
      input.schemaVersion,
      input.validate
    );
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
    if (catalog.kind === "foreign") {
      console.warn(
        `[apps] apps.json schemaVersion ${String(catalog.schemaVersion)} 不是 v${input.schemaVersion}，隔离原件后按空目录冷启动`
      );
      if (!catalog.quarantine) {
        console.warn("[apps] foreign App catalog 无 durable 原字节隔离 receipt，禁止覆盖");
        return degraded("catalog", catalog, marker);
      }
      if (marker.kind === "missing") {
        try {
          await this.establish();
          marker = { kind: "valid" };
        } catch (cause) {
          marker = { kind: "invalid", cause };
        }
      }
      if (marker.kind !== "valid") {
        this.warnMarker(marker.cause);
        return degraded("marker", catalog, marker);
      }
      try {
        /* 隔离件先持久化，再紧邻覆盖动作复验 canonical；即使另一个进程在
           inspection 中途换了字节，这个 writer 也没有资格抹掉新真相。 */
        await this.assertReceipt(input.filePath, catalog.quarantine);
        await durableReplaceFile(input.filePath, input.emptyContent);
        return established({ kind: "valid", count: 0 }, marker, false);
      } catch (cause) {
        console.warn("[apps] foreign App catalog empty publication failed", cause);
        return degraded("catalog", catalog, marker);
      }
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
    if (catalog.kind === "invalid" || catalog.kind === "foreign") {
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
    schemaVersion: number,
    validate: (raw: unknown) => number
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
      const raw = JSON.parse(content) as unknown;
      const foundVersion = schemaVersionOf(raw);
      if (foundVersion !== schemaVersion) {
        const quarantine = await this.quarantineBytes(
          filePath,
          bytes,
          "quarantine"
        ).catch(() => null);
        return {
          kind: "foreign",
          schemaVersion: foundVersion,
          quarantine,
        };
      }
      return { kind: "valid", count: validate(raw) };
    } catch (cause) {
      const quarantine = await this.quarantineBytes(
        filePath,
        bytes,
        "corrupt"
      ).catch(() => null);
      return { kind: "invalid", cause, quarantine };
    }
  }

  private async quarantineBytes(
    filePath: string,
    bytes: Buffer,
    suffix: "corrupt" | "quarantine"
  ) {
    const path = `${filePath}.${suffix}-${Date.now()}-${randomUUID()}`;
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

function schemaVersionOf(raw: unknown) {
  return raw && typeof raw === "object"
    ? (raw as { schemaVersion?: unknown }).schemaVersion
    : undefined;
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
