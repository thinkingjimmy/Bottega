/**
 * [INPUT]: Depends on shared BaseSnapshot/cellValue/baseCellText with the call's exports root, clock and file writing port
 * [OUTPUT]: Provides buildBaseCsv (formula-injection-safe CSV rendering with attachment-filename/lat-lng cell text), writeBaseCsvForRenderer (user-chosen save path), and writeBaseCsvArtifact (write into the app's private exports root)
 * [POS]: CSV format layer of the bases module; kept separate from base-json so format details don't leak across the IPC boundary
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
