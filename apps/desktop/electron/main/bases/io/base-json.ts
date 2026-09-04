/**
 * [INPUT]: Depends on BaseStore, base.json strict, contract, base mutation, system file selection, port of ownership and expected revision, plus the shared statusError constructor from main/errors
 * [OUTPUT]: Provides BaseJSONService with mergeImportedColumns to complete single file JSON storage, limited readings, and CAS upsert transactions that declare a whole-table rewrite only when a row is actually overwritten
 * [POS]: The JSON boundary of the bases module can be ported; BasesService only retains IPC sorting, where the format/budget/compound semantics are focused
 */

import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import type {
  BaseChangedEvent,
  BaseExportResult,
  BaseImportResult,
  BaseRow,
  BaseSnapshot,
} from "../../../../shared/bases-ipc";
import {
  BASE_SNAPSHOT_FILE_BYTE_LIMIT,
  baseSnapshotFile,
  baseSnapshotFileSchema,
  type BaseSnapshotFile,
} from "../../../../shared/base-snapshot";
import type { BaseColumn } from "../../../../shared/base-values";
import {
  ALL_ROWS_CHANGED,
  NO_ROWS_CHANGED,
  type BaseOwnerIdentity,
  type BaseStore,
} from "../base-store";
import type { BaseCommitAuthority } from "../service/base-commit-authority";
import {
  baseColumnIndex,
  baseRowIdSet,
  validateBaseModel,
  validateBaseRow,
} from "../validation/base-mutation-validation";
import { statusError } from "../../errors";

const clone = <T>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

type BaseJsonServiceOptions = {
  chooseExportPath?(suggestedName: string): Promise<string | null>;
  chooseImportPath?(): Promise<string | null>;
  requireOwner(ownerKey: string): Promise<BaseSnapshot>;
  mutationIdentity(
    ownerKey: string,
    authority: BaseCommitAuthority
  ): Promise<BaseOwnerIdentity>;
  assertAdmission(): void;
  emitChange(
    snapshot: BaseSnapshot,
    delta: Pick<BaseChangedEvent, "meta" | "upserts">
  ): void;
};

export class BaseJsonService {
  constructor(
    private readonly store: BaseStore,
    private readonly options: BaseJsonServiceOptions
  ) {}

  async exportForRenderer(ownerKey: string): Promise<BaseExportResult> {
    const snapshot = await this.options.requireOwner(ownerKey);
    if (!this.options.chooseExportPath) {
      throw new Error("当前环境不支持系统保存对话框");
    }
    const path = await this.options.chooseExportPath(`${snapshot.meta.name}.json`);
    if (!path) return { cancelled: true };
    const content = `${JSON.stringify(baseSnapshotFile(snapshot), null, 2)}\n`;
    await writeFile(path, content, { mode: 0o600 });
    return {
      cancelled: false,
      path,
      bytes: Buffer.byteLength(content, "utf8"),
      rowCount: snapshot.rows.length,
    };
  }

  async importForRenderer(
    ownerKey: string,
    authority: BaseCommitAuthority,
    expectedRevision: number
  ): Promise<BaseImportResult> {
    if (!this.options.chooseImportPath) {
      throw new Error("当前环境不支持系统文件对话框");
    }
    const path = await this.options.chooseImportPath();
    if (!path) return { cancelled: true };
    return {
      cancelled: false,
      snapshot: await this.import(
        ownerKey,
        await readBoundedSnapshot(path),
        authority,
        expectedRevision
      ),
    };
  }

  async import(
    ownerKey: string,
    file: string | BaseSnapshotFile,
    authority: BaseCommitAuthority,
    expectedRevision?: number
  ): Promise<BaseSnapshot> {
    this.options.assertAdmission();
    const imported = parseSnapshotFile(file);
    const identity = await this.options.mutationIdentity(ownerKey, authority);
    let metaChanged = false;
    let upserts: BaseRow[] = [];
    const snapshot = await this.store.transact(
      ownerKey,
      identity.ownerInstanceId,
      (current) => {
        this.options.assertAdmission();
        const revision = expectedRevision ?? authority.expectedRevision;
        if (revision !== null && revision !== current.meta.revision) {
          throw mutationConflict(current.meta.revision);
        }
        const columns = mergeImportedColumns(
          current.meta.columns,
          imported.columns
        );
        const incomingRows = new Map(
          imported.rows.map((row) => [row.id, clone(row)])
        );
        const seen = new Set<string>();
        const rows = current.rows.map((row) => {
          const incoming = incomingRows.get(row.id);
          if (!incoming) return row;
          seen.add(row.id);
          return incoming;
        });
        for (const row of imported.rows) {
          if (!seen.has(row.id)) rows.push(clone(row));
        }
        const columnIndex = baseColumnIndex(columns);
        const relationTargets = baseRowIdSet(rows);
        imported.rows.forEach((row) =>
          validateBaseRow(row, columnIndex, "external", relationTargets)
        );
        const activeViewId = imported.views.some(
          (view) => view.id === current.meta.activeViewId
        )
          ? current.meta.activeViewId
          : imported.views[0]!.id;
        const meta = {
          ...current.meta,
          name: imported.name,
          columns,
          views: clone(imported.views),
          activeViewId,
          revision: current.meta.revision + 1,
        };
        validateBaseModel(meta, rows);
        metaChanged = !same(
          { ...meta, revision: current.meta.revision },
          current.meta
        );
        const currentById = new Map(
          current.rows.map((row) => [row.id, row])
        );
        upserts = imported.rows.filter((row) => {
          const existing = currentById.get(row.id);
          return !existing || !same(existing, row);
        });
        if (!metaChanged && !upserts.length) return null;
        return {
          meta,
          /* 没有一行被覆写时交回原引用：这才是「纯 meta 提交」的凭据。 */
          rows: upserts.length ? rows : current.rows,
          /* 导入是整表重写语义（未列出的列会归空），全量体检当得起这份代价。 */
          changedRowIds: upserts.length ? ALL_ROWS_CHANGED : NO_ROWS_CHANGED,
          actor: authority.actor,
          operation: "json-import",
        };
      }
    );
    if (metaChanged || upserts.length) {
      this.options.emitChange(snapshot, {
        ...(metaChanged ? { meta: snapshot.meta } : {}),
        ...(upserts.length ? { upserts } : {}),
      });
    }
    return snapshot;
  }
}

export function mergeImportedColumns(
  current: BaseColumn[],
  incoming: BaseColumn[]
) {
  const incomingById = new Map(incoming.map((column) => [column.id, column]));
  const merged = current.map((column) => {
    const next = incomingById.get(column.id);
    if (!next) return clone(column);
    incomingById.delete(column.id);
    if (next.type !== column.type) {
      throw statusError(
        400,
        `列 ${column.id} 类型冲突：${column.type} → ${next.type}`
      );
    }
    if (next.type !== "select") return clone(next);
    const options = new Map(
      [...(column.options ?? []), ...(next.options ?? [])].map((option) => [
        option.id,
        option,
      ])
    );
    return { ...clone(next), options: [...options.values()] };
  });
  return [
    ...merged,
    ...[...incomingById.values()].map((column) => clone(column)),
  ];
}

function parseSnapshotFile(
  file: string | BaseSnapshotFile
): BaseSnapshotFile {
  try {
    return baseSnapshotFileSchema.parse(
      typeof file === "string" ? JSON.parse(file) : file
    );
  } catch (cause) {
    const issue =
      cause &&
      typeof cause === "object" &&
      "issues" in cause &&
      Array.isArray((cause as { issues: Array<{ message?: string }> }).issues)
        ? (cause as { issues: Array<{ message?: string }> }).issues[0]?.message
        : undefined;
    throw statusError(400, issue ?? "Base JSON 文件无效");
  }
}

async function readBoundedSnapshot(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > BASE_SNAPSHOT_FILE_BYTE_LIMIT) {
      throw statusError(
        400,
        `Base JSON 文件不能超过 ${BASE_SNAPSHOT_FILE_BYTE_LIMIT} 字节`
      );
    }
    return (await readOpenedFile(file, metadata.size)).toString("utf8");
  } finally {
    await file.close();
  }
}

export async function readBoundedFile(path: string, limit: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > limit) {
      throw statusError(400, `文件不能超过 ${limit} 字节`);
    }
    return readOpenedFile(file, metadata.size);
  } finally {
    await file.close();
  }
}

async function readOpenedFile(
  file: Awaited<ReturnType<typeof open>>,
  expectedBytes: number
) {
  const content = await file.readFile();
  if (content.byteLength !== expectedBytes) {
    throw statusError(400, "文件在读取期间发生变化");
  }
  return content;
}

function mutationConflict(currentRevision: number) {
  return Object.assign(new Error("Base revision 已变化"), {
    status: 409,
    code: "revision_conflict",
    outcome: "not-committed" as const,
    currentRevision,
  });
}
