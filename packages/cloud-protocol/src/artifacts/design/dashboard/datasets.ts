/**
 * [INPUT]: Fixed UTF-8 dataset text and an explicit csv/tsv/json format.
 * [OUTPUT]: Bounded text rows and stable column order without executing authored source.
 * [POS]: Shared Dashboard table parser for host validation, data and Sources readers.
 */
export const DASHBOARD_DATA_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, rows: 50_000, columns: 128, cells: 500_000, cellBytes: 1024 * 1024 });
export type DashboardTable = { columns: string[]; data: Record<string, string>[] };
export type DashboardDataFormat = "csv" | "tsv" | "json";
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));
const encode = new TextEncoder();
function cell(value: unknown) {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (encode.encode(text).length > DASHBOARD_DATA_LIMITS.cellBytes) throw new Error("A dataset cell exceeds 1 MiB");
  return text;
}
function jsonTable(text: string): DashboardTable {
  let value: unknown = JSON.parse(text);
  if (plain(value)) {
    const object = value;
    const keys = ["rows", "data", "results"].filter(key => Object.hasOwn(object, key));
    if (keys.length !== 1) throw new Error("A JSON dataset must name exactly one rows/data/results table");
    value = object[keys[0]!] as unknown;
  }
  if (!Array.isArray(value) || value.length > DASHBOARD_DATA_LIMITS.rows || value.some(row => !plain(row))) throw new Error("A JSON dataset must contain at most 50,000 row objects");
  const columns = [...new Set(value.flatMap(row => Object.keys(row as Record<string, unknown>)))];
  if (columns.length > DASHBOARD_DATA_LIMITS.columns || columns.length * value.length > DASHBOARD_DATA_LIMITS.cells) throw new Error("The dataset exceeds its column or cell budget");
  return { columns, data: value.map(row => Object.fromEntries(columns.map(column => [column, cell(Object.hasOwn(row, column) ? row[column] : null)]))) };
}
function delimitedTable(text: string, delimiter: string): DashboardTable {
  const rows: string[][] = []; let row: string[] = [], value = "", quoted = false, closed = false;
  const field = () => { row.push(cell(value)); value = ""; closed = false; if (row.length > DASHBOARD_DATA_LIMITS.columns) throw new Error("The dataset exceeds 128 columns"); };
  const line = () => { field(); rows.push(row); row = []; if (rows.length > DASHBOARD_DATA_LIMITS.rows + 1) throw new Error("The dataset exceeds 50,000 rows"); };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') { if (text[index + 1] === '"') { value += '"'; index++; } else { quoted = false; closed = true; } }
      else value += char;
    } else if (char === delimiter) field();
    else if (char === "\n" || char === "\r") { if (char === "\r" && text[index + 1] === "\n") index++; line(); }
    else if (char === '"' && value === "" && !closed) quoted = true;
    else { if (closed || char === '"') throw new Error("Malformed quoted dataset cell"); value += char; }
  }
  if (quoted) throw new Error("A quoted dataset cell is not terminated");
  if (value !== "" || row.length || closed) line();
  if (!rows.length) throw new Error("A delimited dataset requires a header");
  const columns = rows.shift()!;
  if (columns.some(column => !column) || new Set(columns).size !== columns.length) throw new Error("Dataset column names must be nonempty and unique");
  if (columns.length * rows.length > DASHBOARD_DATA_LIMITS.cells) throw new Error("The dataset exceeds 500,000 cells");
  if (rows.some(row => row.length > columns.length)) throw new Error("A dataset row contains more cells than its header");
  return { columns, data: rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""]))) };
}
export function parseDashboardRows(input: string, format: DashboardDataFormat): DashboardTable {
  if (encode.encode(input).length > DASHBOARD_DATA_LIMITS.bytes) throw new Error("A dataset exceeds 8 MiB");
  const text = input.replace(/^\uFEFF/, "");
  if (format === "json") return jsonTable(text);
  if (format !== "csv" && format !== "tsv") throw new Error("Unsupported dataset format");
  return delimitedTable(text, format === "tsv" ? "\t" : ",");
}
