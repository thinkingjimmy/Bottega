/**
 * [INPUT]: Depends on BaseStore, io/ CSV/JSON/XLSX three-format sheet, system file dialog box port and owner/authority feedback injected by the host
 * [OUTPUT]: Provides BaseIoFacade: CSV output/works, JSON and XLSX input output, and run history queries
 * [POS]: The external front of the bases/service; Only assembly and commissioning, format details to io/, transaction terminology to store
 */

import { writeFile } from "node:fs/promises";
import type {
  BaseChangedEvent,
  BaseExportResult,
  BaseSnapshot,
} from "../../../../shared/bases-ipc";
import type { BaseSnapshotFile } from "../../../../shared/base-snapshot";
import type { BaseOwnerIdentity, BaseStore } from "../base-store";
import type {
  BaseCommitAuthority,
  BaseMutationOperation,
} from "../base-commit-authority";
import { BaseJsonService } from "../io/base-json";
import { writeBaseCsvArtifact, writeBaseCsvForRenderer } from "../io/base-csv";
import { BaseXlsxService } from "../io/base-xlsx";

export type BaseIoFacadeOptions = {
  chooseExportPath?(
    suggestedName: string,
    format?: "csv" | "json" | "xlsx"
  ): Promise<string | null>;
  chooseImportPath?(format?: "json" | "xlsx"): Promise<string | null>;
  writeExport?: (path: string, content: string) => Promise<void>;
  now(): number;
  requireOwner(ownerKey: string): Promise<BaseSnapshot>;
  mutationIdentity(
    ownerKey: string,
    authority: BaseCommitAuthority,
    operation: BaseMutationOperation
  ): Promise<BaseOwnerIdentity>;
  assertAdmission(): void;
  emitChange(
    snapshot: BaseSnapshot,
    delta: Pick<BaseChangedEvent, "meta" | "upserts">
  ): void;
};

export class BaseIoFacade {
  private readonly json: BaseJsonService;
  private readonly xlsx: BaseXlsxService;
  private readonly writeExport: (path: string, content: string) => Promise<void>;

  constructor(
    private readonly store: BaseStore,
    private readonly options: BaseIoFacadeOptions
  ) {
    this.writeExport =
      options.writeExport ??
      ((path, content) => writeFile(path, content, { flag: "wx", mode: 0o600 }));
    this.json = new BaseJsonService(store, {
      chooseExportPath: options.chooseExportPath
        ? (name) => options.chooseExportPath!(name, "json")
        : undefined,
      chooseImportPath: options.chooseImportPath
        ? () => options.chooseImportPath!("json")
        : undefined,
      requireOwner: (ownerKey) => options.requireOwner(ownerKey),
      mutationIdentity: (ownerKey, authority) =>
        options.mutationIdentity(ownerKey, authority, "json-import"),
      assertAdmission: () => options.assertAdmission(),
      emitChange: (snapshot, delta) => options.emitChange(snapshot, delta),
    });
    this.xlsx = new BaseXlsxService(this.json, {
      chooseExportPath: options.chooseExportPath
        ? (name) => options.chooseExportPath!(name, "xlsx")
        : undefined,
      chooseImportPath: options.chooseImportPath
        ? () => options.chooseImportPath!("xlsx")
        : undefined,
      requireOwner: (ownerKey) => options.requireOwner(ownerKey),
    });
  }

  async exportCsvForRenderer(ownerKey: string): Promise<BaseExportResult> {
    const snapshot = await this.options.requireOwner(ownerKey);
    if (!this.options.chooseExportPath) {
      throw new Error("当前环境不支持系统保存对话框");
    }
    return writeBaseCsvForRenderer({
      snapshot,
      choosePath: (name) => this.options.chooseExportPath!(name, "csv"),
    });
  }

  async exportCsvArtifact(ownerKey: string) {
    const snapshot = await this.options.requireOwner(ownerKey);
    return writeBaseCsvArtifact({
      snapshot,
      ownerKey,
      exportsRoot: this.store.exportsRoot,
      now: this.options.now(),
      write: this.writeExport,
    });
  }

  exportJsonForRenderer(ownerKey: string): Promise<BaseExportResult> {
    return this.json.exportForRenderer(ownerKey);
  }

  importJsonForRenderer(
    ownerKey: string,
    authority: BaseCommitAuthority,
    expectedRevision: number
  ) {
    return this.json.importForRenderer(ownerKey, authority, expectedRevision);
  }

  importJson(
    ownerKey: string,
    file: string | BaseSnapshotFile,
    authority: BaseCommitAuthority,
    expectedRevision?: number
  ): Promise<BaseSnapshot> {
    return this.json.import(ownerKey, file, authority, expectedRevision);
  }

  exportXlsxForRenderer(ownerKey: string): Promise<BaseExportResult> {
    return this.xlsx.exportForRenderer(ownerKey);
  }

  importXlsxForRenderer(
    ownerKey: string,
    authority: BaseCommitAuthority,
    expectedRevision: number
  ) {
    return this.xlsx.importForRenderer(ownerKey, authority, expectedRevision);
  }

  /** 行历史是只读查询：owner 校验一次，账本裁剪归 store。 */
  async rowHistory(ownerKey: string, rowId: string) {
    const snapshot = await this.options.requireOwner(ownerKey);
    return this.store.rowHistory(ownerKey, snapshot.meta.ownerInstanceId, rowId);
  }
}
