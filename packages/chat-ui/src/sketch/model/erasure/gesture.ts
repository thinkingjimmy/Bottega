/**
 * [INPUT]: Depends on deterministic primitive conversion, refinement, subtraction, splitting, and byte budgets.
 * [OUTPUT]: Provides worker-owned incremental erasure and complete-candidate admission for atomic fragment replacements.
 * [POS]: Transaction pipeline; permanent IDs are minted only by the accepting main-thread final commit.
 */
import type { InkElement, SketchDocument, SketchElement } from "../document";
import {
  admitDocument,
  assertBudget,
  ByteLedger,
  MAX_ELEMENTS,
  sourceBytes,
  SOURCE_BYTES,
  TEMP_BYTES,
} from "../budget";
import type { Point } from "../geometry/transform";
import {
  primitiveCoverage,
  refineCoverage,
  refinementCost,
} from "../ink/convert";
import { eraseCoverage, validateSweep } from "../ink/erase";
import { splitInk } from "../ink/split";
import { elementBounds, sweepIntersectsBounds } from "./hit-test";
export type ErasureReplacement = Readonly<{
  id: string;
  elements: readonly InkElement[];
}>;
export class ErasureGesture {
  readonly originals = new Map<
    string,
    Exclude<SketchElement, { kind: "text" }>
  >();
  readonly changed = new Map<string, InkElement>();
  readonly deleted = new Set<string>();
  peakTemporaryBytes = 0;
  constructor(
    readonly originalBytes: number,
    readonly originalCount: number,
    readonly renderBytes = 0,
  ) {}
  addTargets(targets: readonly Exclude<SketchElement, { kind: "text" }>[]) {
    for (const target of targets)
      if (!this.originals.has(target.id)) this.originals.set(target.id, target);
    this.check();
  }
  check(candidate?: InkElement) {
    const ledger = new ByteLedger();
    for (const target of this.originals.values()) ledger.element(target);
    for (const ink of this.changed.values()) ledger.element(ink);
    if (candidate) ledger.element(candidate);
    // Reserve result copy, preview, builders, and union-find in addition to worker-owned source.
    const temporary = ledger.bytes * 3 + this.renderBytes;
    this.peakTemporaryBytes = Math.max(this.peakTemporaryBytes, temporary);
    assertBudget(temporary, TEMP_BYTES);
    let delta = 0;
    for (const [id, ink] of this.changed) {
      const old = new ByteLedger(),
        next = new ByteLedger();
      old.element(this.originals.get(id)!);
      next.element(ink);
      delta += next.bytes - old.bytes;
    }
    assertBudget(Math.max(0, this.originalBytes + delta));
  }
  apply(
    points: readonly Point[],
    radius: number,
    deletedIds: readonly string[] = [],
  ) {
    validateSweep(points, radius);
    for (const id of deletedIds) this.deleted.add(id);
    for (const [id, source] of this.originals) {
      const current = this.changed.get(id) ?? source;
      if (!sweepIntersectsBounds(points, radius, elementBounds(current)))
        continue;
      if (current.kind === "ink") {
        const estimated = refinementCost(
          current.coverage,
          current.transform.scaleX,
          current.transform.scaleY,
        );
        assertBudget(estimated.bytes * 3 + this.renderBytes, TEMP_BYTES);
      }
      const ink =
        current.kind === "ink"
          ? refineCoverage(current)
          : primitiveCoverage(current);
      if (!ink) continue;
      this.check(ink);
      const result = eraseCoverage(ink, points, radius);
      if (result === ink) continue;
      this.changed.set(id, result);
      this.check();
    }
  }
  replacements(final: boolean): ErasureReplacement[] {
    const result: ErasureReplacement[] = [...this.deleted].map((id) => ({
      id,
      elements: [],
    }));
    let count = this.originalCount - this.deleted.size,
      bytes = 0;
    for (const [id, ink] of this.changed) {
      const elements = final
        ? splitInk(ink)
        : ink.coverage.blocks.length
          ? [ink]
          : [];
      count += elements.length - 1;
      const ledger = new ByteLedger();
      for (const e of elements) ledger.element(e);
      bytes += ledger.bytes;
      assertBudget(bytes, SOURCE_BYTES);
      assertBudget(bytes * 3 + this.renderBytes, TEMP_BYTES);
      this.peakTemporaryBytes = Math.max(
        this.peakTemporaryBytes,
        bytes * 3 + this.renderBytes,
      );
      result.push({ id, elements });
    }
    // Later replacements can delete elements; only the complete candidate determines admission.
    if (count > MAX_ELEMENTS) throw new Error("SKETCH_BUDGET");
    return result;
  }
}
export function applyReplacements(
  doc: SketchDocument,
  replacements: readonly ErasureReplacement[],
  final = true,
  createId: () => string = () => crypto.randomUUID(),
): SketchDocument {
  if (!replacements.length) return doc;
  const byId = new Map(
    replacements.map((replacement) => [replacement.id, replacement.elements]),
  );
  const elements = doc.elements.flatMap((element): readonly SketchElement[] => {
    const next = byId.get(element.id);
    if (!next) return [element];
    return next.map((child, index) =>
      Object.freeze({
        ...child,
        id:
          next.length === 1
            ? element.id
            : final
              ? createId()
              : element.id + ":preview:" + index,
      }),
    );
  });
  const next = Object.freeze({ ...doc, elements: Object.freeze(elements) });
  admitDocument(next);
  return next;
}
export function preflightResize(
  doc: SketchDocument,
  next: SketchElement,
  renderBytes = 0,
) {
  if (next.kind !== "ink") return;
  const old = doc.elements.find((e) => e.id === next.id);
  if (!old) return;
  const oldBytes = new ByteLedger();
  oldBytes.element(old);
  const cost = refinementCost(
    next.coverage,
    next.transform.scaleX,
    next.transform.scaleY,
  );
  assertBudget(sourceBytes(doc) - oldBytes.bytes + cost.bytes + 256);
  assertBudget(cost.bytes * 3 + renderBytes, TEMP_BYTES);
}
