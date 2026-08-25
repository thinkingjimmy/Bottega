/**
 * [INPUT]: Depends on the full-function version sequence of the Fetch and PyPI JSON API that is inserted, shared/version-compare; Previous Clearly carrying indivisible ETag/catalog
 * [OUTPUT]: Stable re-export compareVersions/isNewerVersion and provide a hard-dated PyPI stable version directory analysis, yank filtering and 304 preservation of the syntax
 * [POS]: The directory layer for the main/memory/runtime/managed version; No TTL/single-flight, no decision on the installation of the target, and no second implementation of the version sequence
 */

import {
  compareVersions,
  isNewerVersion,
  isThreeSegmentVersion,
} from "../../../../../shared/version-compare";

/* 版本序是事实不是本层的观点：三个副本各写各的，同一对版本迟早在
   目录里与弹窗里得到两种答案。这里只借用，并为既有调用方保持出口。 */
export { compareVersions, isNewerVersion };

/** PyPI 一次请求的硬期限：目录 owner 在此期间独占 single-flight 槽。 */
export const PYPI_CATALOG_TIMEOUT_MS = 8_000;

export type PypiCatalog = Readonly<{
  versions: string[];
  latestVersion: string | null;
  yankedVersions: string[];
  warning: string | null;
}>;

export type PypiCatalogState = Readonly<{
  etag: string | null;
  catalog: PypiCatalog;
}>;

export type PypiCatalogResult =
  | Readonly<{ notModified: true }>
  | Readonly<{
      notModified: false;
      catalog: PypiCatalog;
      etag: string | null;
    }>;

/* ============================================================
 * 期限自己带：调用方持着 single-flight 槽等这一个 Promise，因此
 * 「永不回答」必须变成「按时失败」。abort 通知守规矩的 fetch 停手，
 * 期限竞速保证即使 fetcher 无视 signal，锁也一定被交还。
 * ============================================================ */
export async function fetchPypiCatalog(
  packageName: string,
  previous: PypiCatalogState | null,
  fetcher: typeof fetch = fetch,
  timeoutMs: number = PYPI_CATALOG_TIMEOUT_MS
): Promise<PypiCatalogResult> {
  const headers = previous?.etag ? { "If-None-Match": previous.etag } : undefined;
  const deadline = catalogDeadline(timeoutMs);
  try {
    const response = await deadline.race(fetcher(
      `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
      { headers, redirect: "error", signal: deadline.signal }
    ));
    if (response.status === 304) return { notModified: true };
    if (!response.ok) {
      throw new Error(`PyPI 版本目录请求失败：HTTP ${response.status}`);
    }
    return parsePypiCatalog(
      await deadline.race(response.json()),
      response.headers.get("etag")
    );
  } finally {
    deadline.clear();
  }
}

function catalogDeadline(timeoutMs: number) {
  const controller = new AbortController();
  const message = `PyPI 版本目录请求超时（${timeoutMs / 1_000}s）`;
  let expired = false;
  let expire!: (cause: Error) => void;
  const overdue = new Promise<never>((_resolve, reject) => {
    expire = reject;
  });
  /* 竞速用的拒绝先给自己找个主人：请求按时回答的那些次没人竞速，
     否则每一次正常刷新都会在期限到点时留下一条未处理拒绝。 */
  overdue.catch(() => undefined);
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
    expire(new Error(message));
  }, timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
    race: <T>(task: Promise<T>) =>
      Promise.race([
        task.catch((cause) => {
          throw expired ? new Error(message) : cause;
        }),
        overdue,
      ]),
  };
}

function parsePypiCatalog(
  payload: unknown,
  etag: string | null
): PypiCatalogResult {
  const body = payload as {
    info?: { version?: unknown };
    releases?: Record<string, unknown>;
  };
  const releases = body.releases;
  if (!releases || typeof releases !== "object" || Array.isArray(releases)) {
    throw new Error("PyPI 版本目录缺少 releases");
  }
  const stable = Object.keys(releases).filter(isThreeSegmentVersion);
  const yankedVersions: string[] = [];
  const selectable: string[] = [];
  for (const version of stable) {
    const files = releases[version];
    const yanked = Array.isArray(files) && files.length > 0 && files.every(
      (file) => Boolean(
        file && typeof file === "object" && (file as { yanked?: unknown }).yanked === true
      )
    );
    if (yanked) yankedVersions.push(version);
    else selectable.push(version);
  }
  selectable.sort((a, b) => compareVersions(b, a));
  yankedVersions.sort((a, b) => compareVersions(b, a));
  const latestVersion = selectable[0] ?? null;
  const advertised = typeof body.info?.version === "string"
    ? body.info.version
    : null;
  const warning = advertised && isThreeSegmentVersion(advertised) && advertised !== latestVersion
    ? `PyPI info.version=${advertised} 与可选目录最大版本 ${latestVersion ?? "none"} 不一致`
    : null;
  return {
    notModified: false,
    catalog: {
      versions: selectable,
      latestVersion,
      yankedVersions,
      warning,
    },
    etag,
  };
}
