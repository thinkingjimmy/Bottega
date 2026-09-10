/**
 * [INPUT]: Depends on source element, coverage-block, and point type contracts.
 * [OUTPUT]: Provides owner/revision/request-fenced worker request and response DTOs.
 * [POS]: Shared worker boundary; no React, DOM drawing, store, or submission dependency.
 */
import type { InkElement, SketchElement } from "../model/document";
import type { Point } from "../model/geometry/transform";
import type { CoverageBlock } from "../model/ink/coverage";
export type RequestStamp = Readonly<{
  requestId: string;
  documentRevision: number;
  owner: string;
  incarnationId: string;
}>;
export type CoverageRequest = RequestStamp &
  Readonly<{
    phase: "preview" | "final";
    sampleSequence: number;
    points: readonly Point[];
    radius: number;
    targets: readonly Exclude<SketchElement, { kind: "text" }>[];
    deletedIds: readonly string[];
    start?: Readonly<{
      sourceBytes: number;
      elementCount: number;
      renderBytes: number;
    }>;
  }>;
export type WireInk = Omit<InkElement, "coverage"> & {
  coverage: Omit<InkElement["coverage"], "blocks"> & {
    blocks: readonly string[];
  };
};
export type CoverageResponse = RequestStamp &
  Readonly<{
    phase: "preview" | "final";
    sampleSequence: number;
    replacements: readonly { id: string; elements: readonly WireInk[] }[];
    blocks: readonly CoverageBlock[];
    computeMs: number;
    temporaryBytes: number;
    error?: string;
  }>;
export const sameStamp = (a: RequestStamp, b: RequestStamp) =>
  a.requestId === b.requestId &&
  a.documentRevision === b.documentRevision &&
  a.owner === b.owner &&
  a.incarnationId === b.incarnationId;
