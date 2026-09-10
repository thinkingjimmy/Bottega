/**
 * [INPUT]: Depends on validated integer spans and pre-allocation byte/index guards.
 * [OUTPUT]: Provides immutable compact RLE coverage, streaming builders, rows, and validation.
 * [POS]: Canonical remaining-ink representation; no persistent per-row JavaScript objects.
 */
import { assertBudget, assertIndex, SOURCE_BYTES } from "../budget";
export const BASE_PRECISION = 1 / 16;
export const ERASE_PRECISION = BASE_PRECISION;
export const BLOCK_ROWS = 64;
export type CoverageBlock = Readonly<{
  id: string;
  rowIndex: Int32Array;
  spans: Int32Array;
}>;
export type InkCoverage = Readonly<{
  cellSizeX: number;
  cellSizeY: number;
  width: number;
  height: number;
  blocks: readonly CoverageBlock[];
}>;
export type CoverageRow = readonly [number, ArrayLike<number>];
export const blockBytes = (block: CoverageBlock) =>
  block.rowIndex.buffer.byteLength + block.spans.buffer.byteLength + 108;
export const coverageBytes = (coverage: InkCoverage) =>
  64 + coverage.blocks.reduce((sum, block) => sum + blockBytes(block), 0);
export function* rows(coverage: InkCoverage): Generator<CoverageRow> {
  for (const block of coverage.blocks)
    for (let i = 0; i < block.rowIndex.length; i += 3) {
      const [y, offset, count] = block.rowIndex.subarray(i, i + 3);
      yield [y, block.spans.subarray(offset * 2, (offset + count) * 2)];
    }
}
export function counts(coverage: InkCoverage) {
  return coverage.blocks.reduce(
    (n, b) => ({
      rows: n.rows + b.rowIndex.length / 3,
      spans: n.spans + b.spans.length / 2,
    }),
    { rows: 0, spans: 0 },
  );
}
export function coverageArea(coverage: InkCoverage) {
  let cells = 0;
  for (const block of coverage.blocks)
    for (let i = 0; i < block.spans.length; i += 2)
      cells += block.spans[i + 1] - block.spans[i];
  return cells * coverage.cellSizeX * coverage.cellSizeY;
}
export function buildCoverage(
  width: number,
  height: number,
  cellSizeX: number,
  cellSizeY: number,
  input: Iterable<CoverageRow>,
  byteLimit = SOURCE_BYTES,
): InkCoverage {
  assertIndex(width);
  assertIndex(height);
  if (
    !width ||
    !height ||
    !Number.isFinite(cellSizeX) ||
    !Number.isFinite(cellSizeY) ||
    cellSizeX <= 0 ||
    cellSizeY <= 0
  )
    throw new Error("SKETCH_INVALID_SOURCE");
  const blocks: CoverageBlock[] = [];
  let rowIndex: number[] = [],
    spans: number[] = [],
    key = -1,
    bytes = 64,
    previous = -1;
  const flush = () => {
    if (!rowIndex.length) return;
    bytes += (rowIndex.length + spans.length) * 4 + 108;
    assertBudget(bytes, byteLimit);
    blocks.push(
      Object.freeze({
        id: crypto.randomUUID(),
        rowIndex: Int32Array.from(rowIndex),
        spans: Int32Array.from(spans),
      }),
    );
    rowIndex = [];
    spans = [];
  };
  for (const [y, values] of input) {
    if (!values.length) continue;
    if (
      !Number.isInteger(y) ||
      y <= previous ||
      y < 0 ||
      y >= height ||
      values.length % 2
    )
      throw new Error("SKETCH_INVALID_SOURCE");
    const nextKey = Math.floor(y / BLOCK_ROWS);
    if (nextKey !== key) {
      flush();
      key = nextKey;
    }
    assertBudget(
      bytes + (rowIndex.length + 3 + spans.length + values.length) * 4 + 108,
      byteLimit,
    );
    // At most one 64-row builder exists; its boxed numbers are temporary and bounded.
    assertBudget(
      (rowIndex.length + spans.length + values.length) * 16,
      byteLimit,
    );
    rowIndex.push(y, spans.length / 2, values.length / 2);
    let last = -1;
    for (let i = 0; i < values.length; i += 2) {
      const start = values[i],
        end = values[i + 1];
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        start <= last ||
        start >= end ||
        end > width
      )
        throw new Error("SKETCH_INVALID_SOURCE");
      spans.push(start, end);
      last = end;
    }
    previous = y;
  }
  flush();
  return Object.freeze({
    width,
    height,
    cellSizeX,
    cellSizeY,
    blocks: Object.freeze(blocks),
  });
}
export function validateCoverage(coverage: InkCoverage): void {
  const invalid = () => {
    throw new Error("SKETCH_INVALID_SOURCE");
  };
  if (
    !coverage ||
    Object.keys(coverage).some(
      (key) =>
        !["width", "height", "cellSizeX", "cellSizeY", "blocks"].includes(key),
    )
  )
    invalid();
  assertIndex(coverage.width);
  assertIndex(coverage.height);
  if (
    !coverage.width ||
    !coverage.height ||
    !Number.isFinite(coverage.cellSizeX) ||
    coverage.cellSizeX <= 0 ||
    !Number.isFinite(coverage.cellSizeY) ||
    coverage.cellSizeY <= 0 ||
    !Array.isArray(coverage.blocks) ||
    !coverage.blocks.length
  )
    invalid();
  let lastY = -1,
    lastKey = -1;
  const ids = new Set<string>();
  for (const block of coverage.blocks) {
    if (
      Object.keys(block).some(
        (key) => !["id", "rowIndex", "spans"].includes(key),
      ) ||
      typeof block.id !== "string" ||
      ids.has(block.id)
    )
      invalid();
    ids.add(block.id);
    if (
      !(block.rowIndex instanceof Int32Array) ||
      !(block.spans instanceof Int32Array) ||
      !block.rowIndex.length ||
      block.rowIndex.length % 3 ||
      block.rowIndex.length > BLOCK_ROWS * 3 ||
      block.spans.length % 2
    )
      invalid();
    const key = Math.floor(block.rowIndex[0] / BLOCK_ROWS);
    if (key <= lastKey) invalid();
    lastKey = key;
    let expected = 0;
    for (let i = 0; i < block.rowIndex.length; i += 3) {
      const y = block.rowIndex[i],
        offset = block.rowIndex[i + 1],
        count = block.rowIndex[i + 2];
      if (
        y < 0 ||
        y >= coverage.height ||
        y <= lastY ||
        Math.floor(y / BLOCK_ROWS) !== key ||
        offset !== expected ||
        count <= 0 ||
        (offset + count) * 2 > block.spans.length
      )
        invalid();
      let last = -1;
      for (let j = offset * 2; j < (offset + count) * 2; j += 2) {
        const a = block.spans[j],
          b = block.spans[j + 1];
        if (a < 0 || a <= last || a >= b || b > coverage.width) invalid();
        last = b;
      }
      lastY = y;
      expected += count;
    }
    if (expected * 2 !== block.spans.length) invalid();
  }
  assertBudget(coverageBytes(coverage));
}
export function mergeSpans(values: [number, number][]): number[] {
  values.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const result: number[] = [];
  for (const [lo, hi] of values) {
    if (result.length && lo <= result[result.length - 1])
      result[result.length - 1] = Math.max(hi, result[result.length - 1]);
    else result.push(lo, hi);
  }
  return result;
}
export function occupiedSpan(
  lo: number,
  hi: number,
  origin: number,
  cell: number,
  width: number,
): [number, number] | null {
  const a = (lo - origin) / cell - 0.5,
    b = (hi - origin) / cell - 0.5;
  const epsilon = Number.EPSILON * Math.max(16, Math.abs(a), Math.abs(b)) * 4;
  const start = Math.max(0, Math.ceil(a - epsilon)),
    end = Math.min(width, Math.floor(b + epsilon) + 1);
  return start < end ? [start, end] : null;
}
