/**
 * [INPUT]: Depends on Node cryptography, canonical App Use history items, and a monotonic clock
 * [OUTPUT]: Provides bounded per-App/LRU history snapshots plus deterministic authenticated keyset cursors
 * [POS]: App Use history memory authority; pagination callers never retain an unbounded cursor registry or more than one snapshot per App
 */

import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { AppUseHistoryPage } from "../../../shared/apps-ipc";

const DEFAULT_MAX_SNAPSHOTS = 32;
const DEFAULT_MAX_ITEMS = 10_000;

export type AppUseHistorySnapshot = Readonly<{
  id: string;
  appId: string;
  revision: string;
  expiresAt: number;
  items: AppUseHistoryPage["items"];
}>;

type CursorPayload = Readonly<{
  version: 1;
  snapshotId: string;
  snapshotRevision: string;
  afterUpdatedAt: number;
  afterChatId: string;
}>;

export class AppUseHistorySnapshotStore {
  private readonly snapshots = new Map<string, AppUseHistorySnapshot>();
  private readonly snapshotIdByApp = new Map<string, string>();
  private readonly secret = randomBytes(32);
  private readonly maxSnapshots: number;
  private readonly maxItems: number;

  constructor(
    private readonly now: () => number,
    private readonly ttlMs: number,
    limits: Readonly<{ maxSnapshots?: number; maxItems?: number }> = {}
  ) {
    this.maxSnapshots = positiveLimit(
      limits.maxSnapshots,
      DEFAULT_MAX_SNAPSHOTS
    );
    this.maxItems = positiveLimit(limits.maxItems, DEFAULT_MAX_ITEMS);
  }

  create(
    appId: string,
    revision: string,
    items: AppUseHistoryPage["items"]
  ): AppUseHistorySnapshot {
    this.prune();
    if (items.length > this.maxItems) {
      throw statusError(413, "APP_USE_HISTORY_SNAPSHOT_TOO_LARGE");
    }
    this.removeAppSnapshot(appId);
    while (this.snapshots.size >= this.maxSnapshots) {
      const oldest = this.snapshots.keys().next().value as string | undefined;
      if (!oldest) break;
      this.remove(oldest);
    }
    const snapshot = {
      id: randomUUID(),
      appId,
      revision,
      expiresAt: this.now() + this.ttlMs,
      items: structuredClone(items),
    } satisfies AppUseHistorySnapshot;
    this.snapshots.set(snapshot.id, snapshot);
    this.snapshotIdByApp.set(appId, snapshot.id);
    return snapshot;
  }

  resolve(appId: string, cursor: string) {
    this.prune();
    const payload = this.decode(cursor);
    const snapshot = this.require(
      payload.snapshotId,
      payload.snapshotRevision,
      appId
    );
    const anchor = snapshot.items.findIndex(
      (item) =>
        item.updatedAt === payload.afterUpdatedAt &&
        item.chatId === payload.afterChatId
    );
    if (anchor < 0) throw statusError(409, "APP_USE_HISTORY_CURSOR_INVALID");
    return { snapshot, offset: anchor + 1 };
  }

  cursor(snapshot: AppUseHistorySnapshot, after: AppUseHistoryPage["items"][number]) {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        snapshotId: snapshot.id,
        snapshotRevision: snapshot.revision,
        afterUpdatedAt: after.updatedAt,
        afterChatId: after.chatId,
      } satisfies CursorPayload)
    ).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  private require(snapshotId: string, revision: string, appId: string) {
    const snapshot = this.snapshots.get(snapshotId);
    if (
      !snapshot ||
      snapshot.appId !== appId ||
      snapshot.revision !== revision ||
      snapshot.expiresAt <= this.now()
    ) {
      throw statusError(409, "APP_USE_HISTORY_SNAPSHOT_EXPIRED");
    }
    this.snapshots.delete(snapshotId);
    this.snapshots.set(snapshotId, snapshot);
    return snapshot;
  }

  private decode(cursor: string): CursorPayload {
    const [payload, signature, extra] = cursor.split(".");
    if (!payload || !signature || extra || !this.validSignature(payload, signature)) {
      throw statusError(409, "APP_USE_HISTORY_CURSOR_INVALID");
    }
    try {
      const value = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8")
      ) as Partial<CursorPayload>;
      if (
        value.version !== 1 ||
        typeof value.snapshotId !== "string" ||
        typeof value.snapshotRevision !== "string" ||
        typeof value.afterUpdatedAt !== "number" ||
        typeof value.afterChatId !== "string"
      ) {
        throw new Error("invalid");
      }
      return value as CursorPayload;
    } catch {
      throw statusError(409, "APP_USE_HISTORY_CURSOR_INVALID");
    }
  }

  private sign(payload: string) {
    return createHmac("sha256", this.secret)
      .update(payload)
      .digest("base64url");
  }

  private validSignature(payload: string, signature: string) {
    const actual = Buffer.from(signature, "base64url");
    const expected = Buffer.from(this.sign(payload), "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private prune() {
    const now = this.now();
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.expiresAt <= now) this.remove(id);
    }
  }

  private removeAppSnapshot(appId: string) {
    const id = this.snapshotIdByApp.get(appId);
    if (id) this.remove(id);
  }

  private remove(id: string) {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) return;
    this.snapshots.delete(id);
    if (this.snapshotIdByApp.get(snapshot.appId) === id) {
      this.snapshotIdByApp.delete(snapshot.appId);
    }
  }
}

function positiveLimit(value: number | undefined, fallback: number) {
  return value && Number.isInteger(value) && value > 0 ? value : fallback;
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
