/**
 * [INPUT]: Depends on shared BaseSnapshot/cellValue/baseCellText with the call's exports root, clock and file writing port
 * [OUTPUT]: Provides buildBaseCSV with writeBaseCsvArtifact, performs formula column reading, selects tag subtraction, injects conversion and private CSV product drop-off
 * [POS]: The CSV format of the bases module; Separation with base-json to avoid serial details on the IPC door
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  baseCellText,
  cellValue,
  createBaseCellContext,
  isBaseAttachmentValue,
  type BaseCellValue,
  type BaseSnapshot,
} from "../../../../shared/bases-ipc";

export function buildBaseCsv(snapshot: BaseSnapshot) {
  const context = createBaseCellContext({
    columns: snapshot.meta.columns,
    rows: snapshot.rows,
  });
  const header = snapshot.meta.columns.map((column) => csvCell(column.name));
  const rows = snapshot.rows.map((row) =>
    snapshot.meta.columns.map((column) =>
      csvCell(baseCellText(column, cellValue(row, column, context)))
    )
  );
  return `\uFEFF${[header, ...rows].map((line) => line.join(",")).join("\r\n")}\r\n`;
}

export async function writeBaseCsvForRenderer(input: {
  snapshot: BaseSnapshot;
  choosePath(suggestedName: string): Promise<string | null>;
}) {
  const path = await input.choosePath(`${input.snapshot.meta.name}.csv`);
  if (!path) return { cancelled: true } as const;
  const content = buildBaseCsv(input.snapshot);
  await writeFile(path, content, { mode: 0o600 });
  return {
    cancelled: false,
    path,
    bytes: Buffer.byteLength(content, "utf8"),
    rowCount: input.snapshot.rows.length,
  } as const;
}

export async function writeBaseCsvArtifact(input: {
  snapshot: BaseSnapshot;
  ownerKey: string;
  exportsRoot: string;
  now: number;
  write(path: string, content: string): Promise<void>;
}) {
  const content = buildBaseCsv(input.snapshot);
  await mkdir(input.exportsRoot, { recursive: true, mode: 0o700 });
  const path = join(
    input.exportsRoot,
    `${input.ownerKey.replace(":", "-")}-${input.now}-${randomUUID().slice(0, 8)}.csv`
  );
  await input.write(path, content);
  return {
    path,
    bytes: Buffer.byteLength(content, "utf8"),
    rowCount: input.snapshot.rows.length,
  };
}

function csvCell(value: BaseCellValue | string | undefined) {
  let text =
    value && typeof value === "object"
      ? isBaseAttachmentValue(value)
        ? value.filename
        : `${value.lat},${value.lng}`
      : String(value ?? "");
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
