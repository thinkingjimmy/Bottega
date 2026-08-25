/**
 * [INPUT]: Depends on fs Temporary copy, node: sqlite read only queries, macOS security, crypto v10 decryption and Electron cookie store seam
 * [OUTPUT]: Provides Chrome cookie preview/import domain; expires_utc maintains 64-bit accuracy by crossing TEXT, maintains host-only, skips CHIPS, and provides epoch/sameSite/url/domain hash pure functions and classification results
 * [POS]: The browser/chrome-import login mode is imported into the kernel; The key and text are only temporarily stored in the main memory and deleted when the temporary library is used
 */

import {
  createDecipheriv,
  createHash,
  pbkdf2Sync,
} from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BrowserImportFailure,
  BrowserImportResult,
  ChromeCookieDomain,
} from "../../../../shared/browser-import-ipc";

const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600n;
const CHROME_EPOCH_MICROSECONDS = CHROME_EPOCH_OFFSET_SECONDS * 1_000_000n;
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (
    path: string,
    options: { readOnly: boolean }
  ) => {
    prepare(sql: string): { all(): unknown[] };
    close(): void;
  };
};

type CookieRow = {
  host_key: string;
  top_frame_site_key?: string;
  has_cross_site_ancestor?: number;
  name: string;
  value: string;
  encrypted_value: Uint8Array | Buffer;
  path: string;
  /** 见 readCookieRows：真实库按 TEXT 取，注入的测试桩可以给 number/bigint */
  expires_utc: number | bigint | string;
  is_secure: number;
  is_httponly: number;
  samesite: number;
  is_persistent?: number;
};

export type CookieStorePort = {
  set(details: {
    url: string;
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    expirationDate?: number;
    sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
  }): Promise<unknown>;
  flushStore(): Promise<void>;
};

export type ChromeCookieDependencies = {
  databasePath(profilePath: string): Promise<string>;
  readRows(databasePath: string): CookieRow[];
  readSafeStoragePassword(): Promise<string>;
  copyDatabase(source: string, target: string): Promise<void>;
  removeTemporary(path: string): Promise<void>;
};

const defaultDependencies: ChromeCookieDependencies = {
  databasePath: findCookieDatabase,
  readRows: readCookieRows,
  readSafeStoragePassword,
  copyDatabase: copyFile,
  removeTemporary: (path) => rm(path, { recursive: true, force: true }),
};

export async function previewChromeCookieDomains(
  profilePath: string,
  dependencies: Pick<
    ChromeCookieDependencies,
    "databasePath" | "readRows" | "copyDatabase" | "removeTemporary"
  > = defaultDependencies
): Promise<ChromeCookieDomain[]> {
  const rows = await withCookieDatabase(profilePath, dependencies, (path) =>
    dependencies.readRows(path)
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isPersistent(row)) continue;
    counts.set(row.host_key, (counts.get(row.host_key) ?? 0) + 1);
  }
  return [...counts]
    .map(([domain, cookieCount]) => ({ domain, cookieCount }))
    .sort(
      (left, right) =>
        right.cookieCount - left.cookieCount ||
        left.domain.localeCompare(right.domain)
    );
}

export async function importChromeCookies(input: {
  profilePath: string;
  domains: readonly string[];
  cookieStore: CookieStorePort;
  dependencies?: ChromeCookieDependencies;
}): Promise<BrowserImportResult> {
  const dependencies = input.dependencies ?? defaultDependencies;
  const selected = new Set(input.domains);
  if (selected.size === 0) return result("ok", 0, 0, 0, []);
  const rows = await withCookieDatabase(
    input.profilePath,
    dependencies,
    (path) =>
      dependencies
        .readRows(path)
        .filter((row) => selected.has(row.host_key))
  );
  let password: string;
  try {
    password = await dependencies.readSafeStoragePassword();
  } catch (cause) {
    const kind = classifyKeychainFailure(cause);
    return failure(kind, rows.length);
  }
  if (!password) return failure("key-unavailable", rows.length);
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let unsupported = 0;
  const importedDomains = new Set<string>();
  for (const row of rows) {
    if (!isPersistent(row) || isPartitioned(row)) {
      skipped += 1;
      continue;
    }
    let value: string;
    try {
      const decoded = decodeCookieValue(row, key);
      if (decoded.kind === "unsupported") {
        unsupported += 1;
        failed += 1;
        continue;
      }
      value = decoded.value;
    } catch {
      failed += 1;
      continue;
    }
    const expirationDate = chromeTimeToUnixSeconds(row.expires_utc);
    if (expirationDate === null) {
      skipped += 1;
      continue;
    }
    try {
      await input.cookieStore.set({
        url: cookieUrl(row.host_key, row.path, Boolean(row.is_secure)),
        name: row.name,
        value,
        ...(row.host_key.startsWith(".") ? { domain: row.host_key } : {}),
        path: normalizeCookiePath(row.path),
        secure: Boolean(row.is_secure),
        httpOnly: Boolean(row.is_httponly),
        expirationDate,
        sameSite: mapChromeSameSite(row.samesite),
      });
      imported += 1;
      importedDomains.add(row.host_key);
    } catch {
      failed += 1;
    }
  }
  await input.cookieStore.flushStore();
  if (unsupported > 0 && imported === 0) {
    return { ...failure("unsupported-encryption", skipped), failed };
  }
  return result("ok", imported, skipped, failed, [...importedDomains]);
}

export function chromeTimeToUnixSeconds(
  microseconds: number | bigint | string
): number | null {
  const value = parseChromeTimestamp(microseconds);
  if (value === null) return null;
  if (value <= CHROME_EPOCH_MICROSECONDS) return null;
  const seconds = (value - CHROME_EPOCH_MICROSECONDS) / 1_000_000n;
  const converted = Number(seconds);
  return Number.isSafeInteger(converted) && converted > 0 ? converted : null;
}

export function mapChromeSameSite(
  value: number
): "unspecified" | "no_restriction" | "lax" | "strict" {
  if (value === 0) return "no_restriction";
  if (value === 1) return "lax";
  if (value === 2) return "strict";
  return "unspecified";
}

export function cookieUrl(domain: string, path: string, secure: boolean) {
  const host = domain.replace(/^\./, "");
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) {
    throw new Error("Cookie domain 无效");
  }
  return `${secure ? "https" : "http"}://${host}${normalizeCookiePath(path)}`;
}

export function stripChromeDomainHash(plain: Buffer, hostKey: string) {
  if (plain.length < 32) return plain;
  const expected = createHash("sha256").update(hostKey).digest();
  return plain.subarray(0, 32).equals(expected) ? plain.subarray(32) : plain;
}

function decodeCookieValue(
  row: CookieRow,
  key: Buffer
): { kind: "value"; value: string } | { kind: "unsupported" } {
  const encrypted = Buffer.from(row.encrypted_value ?? []);
  if (encrypted.length === 0) {
    return { kind: "value", value: row.value ?? "" };
  }
  const prefix = encrypted.subarray(0, 3).toString("ascii");
  if (prefix !== "v10") {
    return row.value
      ? { kind: "value", value: row.value }
      : { kind: "unsupported" };
  }
  const decipher = createDecipheriv(
    "aes-128-cbc",
    key,
    Buffer.alloc(16, 0x20)
  );
  const plain = Buffer.concat([
    decipher.update(encrypted.subarray(3)),
    decipher.final(),
  ]);
  return {
    kind: "value",
    value: stripChromeDomainHash(plain, row.host_key).toString("utf8"),
  };
}

/* ── 为何 expires_utc 必须按 TEXT 取 ───────────────────────────────
 * SQLite 的 INTEGER 是 64 位，JS 的 number 只装得下 53 位。Chrome 的
 * expires_utc 是 1601 纪元的「微秒」，真实值形如 13434256546810009——十七位，
 * 稳稳超出安全整数。node:sqlite 在物化这一行时就直接抛
 * `RangeError: Value is too large to be represented as a JavaScript number`，
 * 整个 profile 一条 cookie 都读不出来。
 *
 * CAST 成 TEXT 让这一列以十进制字符串原样过桥，精度一位不丢；其余列都是
 * 0/1 标志与文本，继续按原类型走——不动它们，就不会有 `0n === 0` 那类
 * bigint 传染出来的比较陷阱。
 * ─────────────────────────────────────────────────────────── */
function readCookieRows(databasePath: string): CookieRow[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database
      .prepare(
        `SELECT host_key, name, value, encrypted_value, path,
                CAST(expires_utc AS TEXT) AS expires_utc,
                is_secure, is_httponly, samesite, is_persistent,
                top_frame_site_key, has_cross_site_ancestor
           FROM cookies`
      )
      .all() as unknown as CookieRow[];
  } finally {
    database.close();
  }
}

/** 三种来源（TEXT 过桥、bigint、number）归一为 bigint；不成形即 null，绝不抛。 */
function parseChromeTimestamp(
  value: number | bigint | string
): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)) : null;
  }
  const text = value?.trim() ?? "";
  return /^-?\d+$/.test(text) ? BigInt(text) : null;
}

function readSafeStoragePassword() {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-w",
        "-a",
        "Chrome",
        "-s",
        "Chrome Safe Storage",
      ],
      { encoding: "utf8", timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(error, {
              stderr: typeof stderr === "string" ? stderr : "",
            })
          );
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function classifyKeychainFailure(cause: unknown): BrowserImportFailure {
  const message =
    cause instanceof Error
      ? `${cause.message} ${"stderr" in cause ? String(cause.stderr) : ""}`
      : String(cause);
  return /cancel|denied|interaction|authorization|user/i.test(message)
    ? "keychain-denied"
    : "key-unavailable";
}

async function withCookieDatabase<T>(
  profilePath: string,
  dependencies: Pick<
    ChromeCookieDependencies,
    "databasePath" | "copyDatabase" | "removeTemporary"
  >,
  task: (databasePath: string) => T | Promise<T>
) {
  const source = await dependencies.databasePath(profilePath);
  const temporary = await mkdtemp(join(tmpdir(), "ai-chat-chrome-cookies-"));
  const copy = join(temporary, "Cookies");
  try {
    await dependencies.copyDatabase(source, copy);
    return await task(copy);
  } finally {
    await dependencies.removeTemporary(temporary);
  }
}

async function findCookieDatabase(profilePath: string) {
  for (const candidate of [
    join(profilePath, "Cookies"),
    join(profilePath, "Network", "Cookies"),
  ]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // 继续尝试 Chrome 新旧两种布局。
    }
  }
  throw new Error("所选 Chrome profile 没有 Cookies 数据库");
}

const normalizeCookiePath = (path: string) =>
  path.startsWith("/") ? path : `/${path}`;
const isPersistent = (row: CookieRow) => {
  const expires = parseChromeTimestamp(row.expires_utc);
  if (expires === null || expires <= 0n) return false;
  return row.is_persistent === undefined || Boolean(row.is_persistent);
};
const isPartitioned = (row: CookieRow) =>
  Boolean(row.top_frame_site_key) || Boolean(row.has_cross_site_ancestor);
const result = (
  status: BrowserImportResult["status"],
  imported: number,
  skipped: number,
  failed: number,
  domains: string[]
): BrowserImportResult => ({ status, imported, skipped, failed, domains });
const failure = (
  status: BrowserImportFailure,
  skipped: number
): BrowserImportResult => ({
  status,
  imported: 0,
  skipped,
  failed: 0,
  domains: [],
  message:
    status === "keychain-denied"
      ? "macOS 钥匙串授权已取消。你仍可在 Browser 中登录一次，登录态会长期保留。"
      : status === "key-unavailable"
        ? "无法读取 Chrome 登录态密钥。你仍可在 Browser 中登录一次，登录态会长期保留。"
        : "Chrome 使用了当前不支持的加密格式。请在 Browser 中登录一次，登录态会长期保留。",
});
