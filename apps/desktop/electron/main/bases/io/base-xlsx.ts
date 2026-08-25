/**
 * [INPUT]: Depends on ExcelJS, Node zlib, streamlined decompression, limited file reading, Base JSON business import, shared cellValue/value/XLSX issue
 * [OUTPUT]: Provides BaseXlsxService, buildBaseXlsx, parseBaseXlsx/hasExcelTimeToken; Execute the atom report Pre-check, stabilize the issue code/0 Base data line, +2 on the renderer side is the worksheet line, UTC date-only/ISO datetime/cached formula, two-way mapping, type inference and actual decompression bytes/ZIP/dimensional budget
 * [POS]: The main-only XLSX format of bases/io; The renderer does not load ExcelJS, complete success reports first through the wire schema, then repeats the CAS in the BaseJsonService transaction
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import ExcelJS, { type Cell, type CellValue, type Worksheet } from "exceljs";
import {
  BASE_CELL_STRING_LIMIT,
  BASE_COLUMN_LIMIT,
  BASE_INSERT_LIMIT,
  BASE_ROW_LIMIT,
  baseCellText,
  cellValue,
  createBaseCellContext,
  isBaseAttachmentValue,
  parseBaseDate,
  type BaseCellValue,
  type BaseColumn,
  type BaseExportResult,
  type BaseRow,
  type BaseSnapshot,
  type BaseXlsxIssue,
  type BaseXlsxIssueReason,
} from "../../../../shared/bases-ipc";
import { baseXlsxIssuesSchema } from "../../../../shared/bases-schema";
import { baseSnapshotFile } from "../../../../shared/base-snapshot";
import type { BaseCommitAuthority } from "../base-commit-authority";
import { validateBaseCell } from "../base-mutation-validation";
import type { BaseJsonService } from "./base-json";
import { readBoundedFile } from "./base-json";

export const XLSX_FILE_BYTE_LIMIT = 32 * 1024 * 1024;
export const XLSX_ENTRY_LIMIT = 2_048;
export const XLSX_TOTAL_UNPACKED_BYTE_LIMIT = 128 * 1024 * 1024;
export const XLSX_ENTRY_UNPACKED_BYTE_LIMIT = 64 * 1024 * 1024;
export const XLSX_COMPRESSION_RATIO_LIMIT = 200;
export const XLSX_DIMENSION_CELL_LIMIT = 2_000_000;

type ZipBudgetLimits = {
  entries: number;
  totalUnpackedBytes: number;
  entryUnpackedBytes: number;
  compressionRatio: number;
};

const ZIP_BUDGET_LIMITS: ZipBudgetLimits = {
  entries: XLSX_ENTRY_LIMIT,
  totalUnpackedBytes: XLSX_TOTAL_UNPACKED_BYTE_LIMIT,
  entryUnpackedBytes: XLSX_ENTRY_UNPACKED_BYTE_LIMIT,
  compressionRatio: XLSX_COMPRESSION_RATIO_LIMIT,
};

type BaseXlsxServiceOptions = {
  chooseExportPath?(suggestedName: string): Promise<string | null>;
  chooseImportPath?(): Promise<string | null>;
  requireOwner(ownerKey: string): Promise<BaseSnapshot>;
};

export class BaseXlsxService {
  constructor(
    private readonly json: BaseJsonService,
    private readonly options: BaseXlsxServiceOptions
  ) {}

  async exportForRenderer(ownerKey: string): Promise<BaseExportResult> {
    const snapshot = await this.options.requireOwner(ownerKey);
    if (!this.options.chooseExportPath) throw new Error("当前环境不支持系统保存对话框");
    const path = await this.options.chooseExportPath(`${snapshot.meta.name}.xlsx`);
    if (!path) return { cancelled: true };
    const content = await buildBaseXlsx(snapshot);
    await writeFile(path, content, { mode: 0o600 });
    return {
      cancelled: false,
      path,
      bytes: content.byteLength,
      rowCount: snapshot.rows.length,
    };
  }

  async importForRenderer(
    ownerKey: string,
    authority: BaseCommitAuthority,
    expectedRevision: number
  ) {
    if (!this.options.chooseImportPath) throw new Error("当前环境不支持系统文件对话框");
    const path = await this.options.chooseImportPath();
    if (!path) return { cancelled: true as const };
    const current = await this.options.requireOwner(ownerKey);
    const content = await readBoundedFile(path, XLSX_FILE_BYTE_LIMIT);
    const imported = await parseBaseXlsx(content, current);
    // 返回报告必须在写入前证明可过 IPC；否则“提交成功、调用失败”不可恢复。
    const issues = baseXlsxIssuesSchema.parse(imported.issues);
    const snapshot = await this.json.import(
      ownerKey,
      baseSnapshotFile({
        ...current,
        meta: { ...current.meta, columns: imported.columns },
        rows: imported.rows,
      }),
      authority,
      expectedRevision
    );
    return { cancelled: false as const, snapshot, issues };
  }
}

export async function buildBaseXlsx(snapshot: BaseSnapshot): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bottega";
  workbook.created = new Date(0);
  const sheet = workbook.addWorksheet(safeSheetName(snapshot.meta.name));
  sheet.addRow(["id", ...snapshot.meta.columns.map((column) => column.name)]);
  const context = createBaseCellContext({
    columns: snapshot.meta.columns,
    rows: snapshot.rows,
  });
  for (const row of snapshot.rows) {
    const values = snapshot.meta.columns.map((column) =>
      cellValue(row, column, context)
    );
    const output = sheet.addRow([
      row.id,
      ...snapshot.meta.columns.map((column, index) =>
        xlsxExportValue(column, values[index])
      ),
    ]);
    snapshot.meta.columns.forEach((column, index) => {
      const cell = output.getCell(index + 2);
      if (column.type === "date" && cell.value instanceof Date) {
        cell.numFmt = typeof values[index] === "string" && values[index].includes("T")
          ? "yyyy-mm-dd hh:mm:ss"
          : "yyyy-mm-dd";
      }
      if (column.type === "url" && typeof cell.value === "string" && cell.value) {
        cell.value = { text: cell.value, hyperlink: cell.value };
      }
    });
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function parseBaseXlsx(buffer: Buffer, current: BaseSnapshot) {
  await inspectZipBudget(buffer);
  const workbook = new ExcelJS.Workbook();
  const workbookBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  await workbook.xlsx.load(workbookBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw statusError(400, "XLSX 至少需要一个工作表");
  inspectSheetBudget(sheet);
  const headers = readHeaders(sheet);
  const idIndex = headers.findIndex((header) => header.toLowerCase() === "id");
  const sampleRows = worksheetRows(sheet).slice(0, 100);
  const currentByName = new Map(
    current.meta.columns.map((column) => [column.name.trim().toLocaleLowerCase(), column])
  );
  const mapped = headers.map((header, index) => {
    if (index === idIndex) return null;
    const existing = currentByName.get(header.toLocaleLowerCase());
    return existing ?? inferColumn(header, sampleRows.map((row) => row.getCell(index + 1)));
  });
  const columns = [
    ...current.meta.columns,
    ...mapped.filter((column): column is BaseColumn => Boolean(
      column && !current.meta.columns.some((item) => item.id === column.id)
    )),
  ];
  if (columns.length > BASE_COLUMN_LIMIT) throw statusError(400, "XLSX 导入后的列数超限");
  const incomingById = new Map<string, BaseRow>();
  const sourceRowIndexById = new Map<string, number>();
  const issues: BaseXlsxIssue[] = [];
  worksheetRows(sheet).forEach((sheetRow, rowOffset) => {
    const explicitId = idIndex >= 0 ? scalarCellValue(sheetRow.getCell(idIndex + 1)) : undefined;
    const id = typeof explicitId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(explicitId)
      ? explicitId
      : randomUUID();
    const values: BaseRow["values"] = {};
    mapped.forEach((column, columnIndex) => {
      if (!column) return;
      const raw = importCellValue(sheetRow.getCell(columnIndex + 1), column);
      if (raw === undefined || raw === "") return;
      if (typeof raw === "string" && Buffer.byteLength(raw, "utf8") > BASE_CELL_STRING_LIMIT) {
        appendXlsxIssue(issues, {
          rowIndex: rowOffset,
          columnId: column.id,
          reason: "cell_too_large",
        });
        return;
      }
      try {
        validateBaseCell(column, raw, "external");
        values[column.id] = raw;
      } catch {
        appendXlsxIssue(issues, {
          rowIndex: rowOffset,
          columnId: column.id,
          reason: invalidXlsxCellReason(column),
        });
      }
    });
    incomingById.set(id, { id, values });
    sourceRowIndexById.set(id, rowOffset);
  });
  if (incomingById.size > BASE_ROW_LIMIT) throw statusError(400, "XLSX 行数超限");
  /* 匹配到的行整行替换（与 base-json 导入同一语义，单一语义不许两格式两套）：
     工作表未含的列与被判 issue 的格都会归空——文案必须如实这么说，
     `bases.header.importXlsxIssues` 因此说「置空」而不是「跳过」。 */
  const rows = current.rows.map((row) => incomingById.get(row.id) ?? row);
  const existingIds = new Set(current.rows.map((row) => row.id));
  for (const row of incomingById.values()) if (!existingIds.has(row.id)) rows.push(row);
  for (const row of incomingById.values()) {
    for (const column of columns) {
      const value = row.values[column.id];
      if (column.type !== "relation" || value === undefined) continue;
      try {
        validateBaseCell(column, value, "external", rows);
      } catch {
        delete row.values[column.id];
        appendXlsxIssue(issues, {
          rowIndex: sourceRowIndexById.get(row.id)!,
          columnId: column.id,
          reason: "relation_target_missing",
        });
      }
    }
  }
  return { columns, rows, issues };
}

function xlsxExportValue(column: BaseColumn, value: BaseCellValue | undefined): CellValue {
  if (value === undefined || value === "") return null;
  if (column.type === "date" && typeof value === "string") {
    return parseDateOnlyUtc(value) ?? parseBaseDate(value) ?? value;
  }
  if (column.type === "checkbox") return value === true;
  if (column.type === "number" || column.type === "formula") {
    return typeof value === "number" || typeof value === "boolean" ? value : String(value);
  }
  if (typeof value === "object") {
    return isBaseAttachmentValue(value) ? value.filename : `${value.lat}, ${value.lng}`;
  }
  return baseCellText(column, value);
}

function worksheetRows(sheet: Worksheet) {
  const rows = [];
  for (let index = 2; index <= sheet.rowCount; index += 1) rows.push(sheet.getRow(index));
  return rows;
}

function readHeaders(sheet: Worksheet) {
  const headers: string[] = [];
  for (let index = 1; index <= sheet.columnCount; index += 1) {
    const value = scalarCellValue(sheet.getRow(1).getCell(index));
    headers.push(String(value ?? `Column ${index}`).trim() || `Column ${index}`);
  }
  return headers;
}

function inferColumn(name: string, cells: Cell[]): BaseColumn {
  const values = cells.map(scalarCellValue).filter((value) => value !== undefined && value !== "");
  const type: BaseColumn["type"] = values.length && values.every((value) => typeof value === "boolean")
    ? "checkbox"
    : values.length && values.every((value) => typeof value === "number")
      ? "number"
      : values.length && values.every((value) => value instanceof Date)
        ? "date"
        : values.length && values.every((value) => typeof value === "string" && isHttpsUrl(value))
          ? "url"
          : "text";
  return { id: randomUUID(), name, type };
}

function importCellValue(cell: Cell, column: BaseColumn): BaseCellValue | undefined {
  if (cell.isMerged && cell.master.address !== cell.address) return undefined;
  const value = scalarCellValue(cell);
  if (value === undefined || value === null) return undefined;
  if (column.type === "formula" || column.type === "attachment") return value as BaseCellValue;
  if (column.type === "text") return String(value);
  if (column.type === "number") return typeof value === "number" ? value : Number(value);
  if (column.type === "checkbox") {
    if (typeof value === "boolean") return value;
    if (/^(true|yes|1)$/i.test(String(value))) return true;
    if (/^(false|no|0)$/i.test(String(value))) return false;
    return String(value);
  }
  if (column.type === "date") {
    if (value instanceof Date) return formatExcelDate(cell, value);
    if (typeof value === "number") return formatExcelDate(cell, excelSerialDate(value));
    return String(value);
  }
  if (column.type === "select") {
    const text = String(value);
    return column.options?.find((option) => option.label === text || option.id === text)?.id ?? text;
  }
  if (column.type === "location") {
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(value));
    return match ? { lat: Number(match[1]), lng: Number(match[2]) } : String(value);
  }
  return String(value);
}

function formatExcelDate(cell: Cell, value: Date) {
  return hasExcelTimeToken(cell.numFmt ?? "")
    ? value.toISOString()
    : formatDateOnlyUtc(value);
}

export function hasExcelTimeToken(format: string) {
  const hasElapsedTime = /\[(?:h+|m+|s+)\]/i.test(format);
  const visible = format
    .replace(/"(?:[^"]|"")*"/g, "")
    .replace(/\\.|_.|\*./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return hasElapsedTime || /h|s|am\/pm|a\/p/i.test(visible);
}

const XLSX_INVALID_CELL_REASON: Record<BaseColumn["type"], BaseXlsxIssueReason> = {
  text: "invalid_text",
  number: "invalid_number",
  date: "invalid_date",
  select: "invalid_select_option",
  checkbox: "invalid_checkbox",
  url: "invalid_https_url",
  location: "invalid_location",
  attachment: "attachment_not_importable",
  formula: "formula_read_only",
  relation: "invalid_relation",
};

function invalidXlsxCellReason(column: BaseColumn) {
  return XLSX_INVALID_CELL_REASON[column.type];
}

function appendXlsxIssue(issues: BaseXlsxIssue[], issue: BaseXlsxIssue) {
  if (issues.length >= BASE_INSERT_LIMIT) {
    throw Object.assign(
      new Error(`XLSX 跳过的问题超过 ${BASE_INSERT_LIMIT} 个，请先修复工作簿再重试`),
      { status: 400, code: "xlsx_issue_limit", outcome: "not-committed" as const }
    );
  }
  issues.push(issue);
}

function scalarCellValue(cell: Cell): string | number | boolean | Date | undefined {
  const value = cell.value;
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  if ("error" in value) return undefined;
  if ("formula" in value || "sharedFormula" in value) {
    const result = value.result;
    return result === null || result === undefined || (typeof result === "object" && "error" in result)
      ? undefined
      : result as string | number | boolean | Date;
  }
  if ("hyperlink" in value) return value.text;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  return String(value);
}

function inspectSheetBudget(sheet: Worksheet) {
  if (sheet.rowCount > BASE_ROW_LIMIT + 1 || sheet.columnCount > BASE_COLUMN_LIMIT + 1) {
    throw statusError(400, "XLSX 工作表维度超限");
  }
  if (sheet.rowCount * sheet.columnCount > XLSX_DIMENSION_CELL_LIMIT) {
    throw statusError(400, "XLSX 工作表单元格预算超限");
  }
}

export async function inspectZipBudget(
  buffer: Buffer,
  overrides: Partial<ZipBudgetLimits> = {}
) {
  const limits = { ...ZIP_BUDGET_LIMITS, ...overrides };
  const eocd = findEndOfCentralDirectory(buffer);
  if (buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0) {
    throw statusError(400, "XLSX ZIP 不支持分卷");
  }
  const entries = buffer.readUInt16LE(eocd + 10);
  if (buffer.readUInt16LE(eocd + 8) !== entries) {
    throw statusError(400, "XLSX ZIP entry 计数无效");
  }
  const centralBytes = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries > limits.entries) throw statusError(400, "XLSX ZIP entry 数超限");
  if (centralOffset + centralBytes > eocd) throw statusError(400, "XLSX ZIP 中央目录无效");
  let offset = centralOffset;
  let total = 0;
  for (let index = 0; index < entries; index += 1) {
    assertZipBounds(buffer, offset, 46);
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw statusError(400, "XLSX ZIP entry 无效");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const declaredUnpacked = buffer.readUInt32LE(offset + 24);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if ([compressed, declaredUnpacked, localOffset].includes(0xffffffff)) {
      throw statusError(400, "XLSX ZIP64 不受支持");
    }
    if ((flags & 1) !== 0 || ![0, 8].includes(method)) {
      throw statusError(400, "XLSX ZIP entry 编码不受支持");
    }
    const data = zipEntryData(buffer, centralOffset, localOffset, compressed, flags, method);
    const unpacked = method === 0
      ? data.byteLength
      : await inflateEntryBytes(data, limits, total);
    assertUnpackedBudget(unpacked, compressed, total, limits);
    if (unpacked !== declaredUnpacked) {
      throw statusError(400, "XLSX ZIP entry 声明解压尺寸与实际不符");
    }
    total += unpacked;
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    if (offset > centralOffset + centralBytes) throw statusError(400, "XLSX ZIP entry 越界");
  }
  if (offset !== centralOffset + centralBytes) {
    throw statusError(400, "XLSX ZIP 中央目录长度无效");
  }
}

function zipEntryData(
  buffer: Buffer,
  centralOffset: number,
  localOffset: number,
  compressed: number,
  flags: number,
  method: number
) {
  assertZipBounds(buffer, localOffset, 30);
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw statusError(400, "XLSX ZIP local entry 无效");
  }
  if (buffer.readUInt16LE(localOffset + 6) !== flags ||
      buffer.readUInt16LE(localOffset + 8) !== method) {
    throw statusError(400, "XLSX ZIP central/local entry 不一致");
  }
  const dataOffset = localOffset + 30 +
    buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
  if (dataOffset + compressed > centralOffset) {
    throw statusError(400, "XLSX ZIP entry 数据越界");
  }
  return buffer.subarray(dataOffset, dataOffset + compressed);
}

async function inflateEntryBytes(
  compressed: Buffer,
  limits: ZipBudgetLimits,
  totalBefore: number
) {
  const inflater = createInflateRaw();
  let unpacked = 0;
  inflater.end(compressed);
  try {
    for await (const chunk of inflater) {
      unpacked += (chunk as Buffer).byteLength;
      assertUnpackedBudget(unpacked, compressed.byteLength, totalBefore, limits);
    }
  } catch (cause) {
    if (cause instanceof Error && "status" in cause) throw cause;
    throw statusError(400, "XLSX ZIP entry 解压失败");
  }
  return unpacked;
}

function assertUnpackedBudget(
  unpacked: number,
  compressed: number,
  totalBefore: number,
  limits: ZipBudgetLimits
) {
  if (unpacked > limits.entryUnpackedBytes) {
    throw statusError(400, "XLSX ZIP 单 entry 实际解压预算超限");
  }
  if (unpacked / Math.max(compressed, 1) > limits.compressionRatio) {
    throw statusError(400, "XLSX ZIP 实际压缩比超限");
  }
  if (totalBefore + unpacked > limits.totalUnpackedBytes) {
    throw statusError(400, "XLSX ZIP 总实际解压预算超限");
  }
}

function assertZipBounds(buffer: Buffer, offset: number, length: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > buffer.byteLength) {
    throw statusError(400, "XLSX ZIP entry 越界");
  }
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const floor = Math.max(0, buffer.byteLength - 65_557);
  for (let offset = buffer.byteLength - 22; offset >= floor; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw statusError(400, "XLSX ZIP 尾记录缺失");
}

function excelSerialDate(value: number) {
  return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
}

function parseDateOnlyUtc(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return formatDateOnlyUtc(date) === value ? date : null;
}

function formatDateOnlyUtc(value: Date) {
  return [
    String(value.getUTCFullYear()).padStart(4, "0"),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function isHttpsUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function safeSheetName(value: string) {
  return value.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Base";
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
