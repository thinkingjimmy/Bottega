/**
 * [INPUT]: Depends on managed/PyPI-versions, PyPI package/fetcher and port of release for snapshots while running
 * [OUTPUT]: Provides RuntimeVersionCatalog/assertSwitchVersion: 24h Successful caching, single-flight with a hard time, ETag/304, first offline retesting failure, only one failed text, failed preservation with trusted members
 * [POS]: The owner of the version directory status of main/memory/runtime/control; Coordinator only consume facts and optional versions
 */

import type { MemoryRuntimeSnapshot } from "../../../../../shared/memory-ipc";
import {
  fetchPypiCatalog,
  isNewerVersion,
  PYPI_CATALOG_TIMEOUT_MS,
  type PypiCatalogState,
} from "../managed/pypi-versions";

const VERSION_CATALOG_TTL_MS = 24 * 60 * 60_000;

export class RuntimeVersionCatalog {
  private state: PypiCatalogState | null = null;
  /* TTL 只由成功刷新推进：一次瞬时失败不得把陈旧目录再封 24h。
     失败单独记 failedAt，它解释「上次尝试」，不解释「目录多新」。 */
  private checkedAt: number | null = null;
  private failedAt: number | null = null;
  private failure: string | null = null;
  private request: Promise<MemoryRuntimeSnapshot> | null = null;

  constructor(
    private readonly packageName: string | undefined,
    private readonly fetcher: typeof fetch,
    private readonly publish: () => Promise<MemoryRuntimeSnapshot>,
    private readonly timeoutMs: number = PYPI_CATALOG_TIMEOUT_MS
  ) {}

  /** 上次刷新失败的时刻；与 checkedAt 分开，「陈旧但可用」与「刚失败」才区分得开。 */
  get lastFailureAt() {
    return this.failedAt;
  }

  facts(installedVersion: string | null) {
    return {
      latestVersion: this.state?.catalog.latestVersion ?? null,
      latestCheckedAt: this.checkedAt,
      latestCheckError: this.failure,
      latestCheckWarning: this.state?.catalog.warning ?? null,
      updateAvailable: isNewerVersion(
        this.state?.catalog.latestVersion ?? null,
        installedVersion
      ),
      versionCatalogSupported: Boolean(this.packageName),
      yankedVersions: this.state?.catalog.yankedVersions ?? [],
    };
  }

  check(force = false): Promise<MemoryRuntimeSnapshot> {
    if (!this.packageName) return this.publish();
    if (
      !force &&
      this.state !== null &&
      this.checkedAt !== null &&
      Date.now() - this.checkedAt < VERSION_CATALOG_TTL_MS
    ) return this.publish();
    if (this.request) return this.request;
    this.request = this.refresh().finally(() => {
      this.request = null;
    });
    return this.request;
  }

  async versions(requireFresh = false) {
    await this.check(requireFresh);
    if (!this.packageName) return { versions: [], yankedVersions: [] };
    if (requireFresh && this.failure) {
      throw new Error(`版本目录刷新失败：${this.failure}`);
    }
    if (!this.state) {
      throw new Error(`版本目录尚不可用：${this.failure ?? "尚未成功刷新"}`);
    }
    return {
      versions: this.state.catalog.versions,
      yankedVersions: this.state.catalog.yankedVersions,
    };
  }

  private async refresh() {
    try {
      const result = await fetchPypiCatalog(
        this.packageName!,
        this.state,
        this.fetcher,
        this.timeoutMs
      );
      if (!result.notModified) {
        this.state = { etag: result.etag, catalog: result.catalog };
      }
      this.checkedAt = Date.now();
      this.failedAt = null;
      this.failure = null;
    } catch (cause) {
      this.failedAt = Date.now();
      this.failure = cause instanceof Error ? cause.message : "版本检查失败";
    }
    return this.publish();
  }
}

export function assertSwitchVersion(
  value: unknown,
  versions: ReadonlyArray<string>
) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error("Memory 目标版本必须是严格三段版本号");
  }
  if (!versions.includes(value)) {
    throw new Error("Memory 目标版本不在当前可信目录中");
  }
  return value;
}
