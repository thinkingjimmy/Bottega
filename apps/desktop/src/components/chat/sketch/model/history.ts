/**
 * [INPUT]: Depends on semantic document equality and shared-buffer byte accounting.
 * [OUTPUT]: Provides atomic bounded document history, monotonic revisions, and baseline dirty state.
 * [POS]: Editor transaction authority; previews and tool changes never enter this history.
 */
import {
  sameDocument,
  validateDocument,
  type SketchDocument,
} from "./document";
import {
  admitDocument,
  HISTORY_BYTES,
  MAX_STEPS,
  retainedBytes,
} from "./budget";
export type HistoryStep = Readonly<{
  before: SketchDocument;
  after: SketchDocument;
}>;
export class SketchHistory {
  readonly baseline: SketchDocument;
  document: SketchDocument;
  undoSteps: HistoryStep[] = [];
  redoSteps: HistoryStep[] = [];
  revision = 0;
  constructor(
    document: SketchDocument,
    readonly byteLimit = HISTORY_BYTES,
    readonly stepLimit = MAX_STEPS,
  ) {
    validateDocument(document);
    admitDocument(document);
    this.baseline = this.document = document;
  }
  get dirty() {
    return !sameDocument(this.baseline, this.document);
  }
  get bytes() {
    return retainedBytes(
      [...this.undoSteps, ...this.redoSteps].flatMap((s) => [
        s.before,
        s.after,
      ]),
    );
  }
  plan(next: SketchDocument): { steps: HistoryStep[]; evicted: number } {
    validateDocument(next);
    admitDocument(next);
    const steps = [...this.undoSteps, { before: this.document, after: next }];
    let evicted = 0;
    while (
      steps.length > this.stepLimit ||
      retainedBytes(steps.flatMap((s) => [s.before, s.after])) > this.byteLimit
    ) {
      if (steps.length <= 1) throw new Error("SKETCH_BUDGET");
      steps.shift();
      evicted++;
    }
    return { steps, evicted };
  }
  commit(next: SketchDocument): { changed: boolean; evicted: number } {
    if (sameDocument(this.document, next))
      return { changed: false, evicted: 0 };
    const plan = this.plan(next);
    this.undoSteps = plan.steps;
    this.redoSteps = [];
    this.document = next;
    this.revision++;
    return { changed: true, evicted: plan.evicted };
  }
  undo() {
    const step = this.undoSteps.pop();
    if (!step) return false;
    this.redoSteps.push(step);
    this.document = step.before;
    this.revision++;
    return true;
  }
  redo() {
    const step = this.redoSteps.pop();
    if (!step) return false;
    this.undoSteps.push(step);
    this.document = step.after;
    this.revision++;
    return true;
  }
}
