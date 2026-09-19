/**
 * [INPUT]: Depends on worker protocol, geometric erasure transactions, and copied block ownership.
 * [OUTPUT]: Provides an incremental processor returning only newly allocated blocks and stable references.
 * [POS]: Worker computation authority, also executable in pure protocol regression tests.
 */
import { ErasureGesture } from "../model/erasure/gesture";
import type { CoverageBlock } from "../model/ink/coverage";
import {
  sameStamp,
  type CoverageRequest,
  type CoverageResponse,
  type RequestStamp,
} from "./protocol";
export class CoverageEngine {
  private gesture?: ErasureGesture;
  private stamp?: RequestStamp;
  private sequence = 0;
  private sent = new Set<string>();
  process(request: CoverageRequest): CoverageResponse {
    const started = performance.now();
    if (request.start) {
      this.gesture = new ErasureGesture(
        request.start.sourceBytes,
        request.start.elementCount,
        request.start.renderBytes,
      );
      this.stamp = request;
      this.sequence = 0;
      this.sent.clear();
    }
    if (
      !this.gesture ||
      !this.stamp ||
      !sameStamp(request, this.stamp) ||
      request.sampleSequence < this.sequence
    )
      throw new Error("SKETCH_STALE_RESULT");
    this.sequence = request.sampleSequence;
    for (const target of request.targets)
      if (target.kind === "ink")
        for (const block of target.coverage.blocks) this.sent.add(block.id);
    this.gesture.addTargets(request.targets);
    this.gesture.apply(request.points, request.radius, request.deletedIds);
    const blocks: CoverageBlock[] = [];
    const replacements = this.gesture
      .replacements(request.phase === "final")
      .map((replacement) => ({
        id: replacement.id,
        elements: replacement.elements.map((element) => ({
          ...element,
          coverage: {
            ...element.coverage,
            blocks: element.coverage.blocks.map((block) => {
              if (!this.sent.has(block.id)) {
                this.sent.add(block.id);
                // The worker retains its candidate for the next batch. Transfer only dedicated copies.
                blocks.push({
                  id: block.id,
                  rowIndex: block.rowIndex.slice(),
                  spans: block.spans.slice(),
                });
              }
              return block.id;
            }),
          },
        })),
      }));
    const response: CoverageResponse = {
      requestId: request.requestId,
      owner: request.owner,
      incarnationId: request.incarnationId,
      documentRevision: request.documentRevision,
      phase: request.phase,
      sampleSequence: request.sampleSequence,
      replacements,
      blocks,
      computeMs: performance.now() - started,
      temporaryBytes: this.gesture.peakTemporaryBytes,
    };
    if (request.phase === "final") {
      this.gesture = undefined;
      this.stamp = undefined;
      this.sent.clear();
    }
    return response;
  }
}
