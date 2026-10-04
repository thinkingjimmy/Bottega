/**
 * [INPUT]: Depends on stamped worker protocol, immutable source references, and visible bounds/glyph ports.
 * [OUTPUT]: Provides a single-batch eraser client with lossless pending sweeps and final/cancel fencing.
 * [POS]: Main-thread worker owner; previews never write formal history and source buffers never detach.
 */
import type { SketchDocument, TextElement } from "../model/document";
import { assertBudget, sourceBytes, TEMP_BYTES } from "../model/budget";
import {
  applyReplacements,
  type ErasureReplacement,
} from "../model/erasure/gesture";
import {
  elementBounds,
  sweepIntersectsBounds,
  type TextMetricsPort,
} from "../model/erasure/hit-test";
import { validateSweep } from "../model/ink/erase";
import type { Point } from "../model/geometry/transform";
import type { CoverageBlock } from "../model/ink/coverage";
import {
  sameStamp,
  type CoverageRequest,
  type CoverageResponse,
  type RequestStamp,
} from "./protocol";
export type WorkerPort = {
  onmessage: ((event: MessageEvent<CoverageResponse>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: CoverageRequest): void;
  terminate(): void;
};
export type EraserCallbacks = {
  current(): { revision: number; owner: string; incarnationId: string };
  preview(document: SketchDocument): void;
  final(
    document: SketchDocument,
    metrics: { computeMs: number; temporaryBytes: number },
  ): void;
  cancelled(error?: string): void;
  glyphHit(
    element: TextElement,
    points: readonly Point[],
    radius: number,
  ): boolean;
  text: TextMetricsPort;
};
export class EraserClient {
  private worker?: WorkerPort;
  private active?: {
    stamp: RequestStamp;
    document: SketchDocument;
    radius: number;
    renderBytes: number;
    pending: Point[];
    last: Point;
    sequence: number;
    accepted: number;
    sentSequence: number;
    sentPhase: "preview" | "final";
    inFlight: boolean;
    finishing: boolean;
    started: boolean;
    sentTargets: Set<string>;
    blocks: Map<string, CoverageBlock>;
    computeMs: number;
  };
  constructor(
    readonly callbacks: EraserCallbacks,
    readonly createWorker: () => WorkerPort = () =>
      new Worker(new URL("./coverage.worker.ts", import.meta.url), {
        type: "module",
      }) as unknown as WorkerPort,
  ) {}
  get busy() {
    return Boolean(this.active);
  }
  get awaitingFinal() {
    return Boolean(this.active?.finishing);
  }
  start(
    document: SketchDocument,
    point: Point,
    radius: number,
    renderBytes = 0,
  ) {
    this.cancel();
    validateSweep([point], radius);
    const current = this.callbacks.current();
    const blocks = new Map<string, CoverageBlock>();
    for (const e of document.elements)
      if (e.kind === "ink")
        for (const b of e.coverage.blocks) blocks.set(b.id, b);
    this.active = {
      stamp: {
        requestId: crypto.randomUUID(),
        documentRevision: current.revision,
        owner: current.owner,
        incarnationId: current.incarnationId,
      },
      document,
      radius,
      renderBytes,
      pending: [point],
      last: point,
      sequence: 1,
      accepted: 0,
      sentSequence: 0,
      sentPhase: "preview",
      inFlight: false,
      finishing: false,
      started: false,
      sentTargets: new Set(),
      blocks,
      computeMs: 0,
    };
    this.dispatch();
  }
  append(points: readonly Point[]) {
    const active = this.active;
    if (!active || active.finishing || !points.length) return;
    try {
      validateSweep(points, active.radius);
      assertBudget(
        (active.pending.length + points.length) * 48 + active.renderBytes,
        TEMP_BYTES,
      );
      active.pending.push(...points);
      active.sequence += points.length;
      active.last = points[points.length - 1];
      this.dispatch();
    } catch (error) {
      this.fail(error);
    }
  }
  finish(point: Point) {
    const active = this.active;
    if (!active || active.finishing) return;
    this.append([point]);
    if (this.active !== active) return;
    active.finishing = true;
    if (!active.pending.length) active.pending.push(active.last);
    this.dispatch();
  }
  cancel(error?: string) {
    const hadActive = Boolean(this.active);
    this.active = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    if (hadActive) this.callbacks.cancelled(error);
  }
  private fail(error: unknown) {
    this.cancel(
      error instanceof Error ? error.message : "SKETCH_WORKER_FAILED",
    );
  }
  private valid(stamp: RequestStamp) {
    const current = this.callbacks.current();
    return (
      current.revision === stamp.documentRevision &&
      current.owner === stamp.owner &&
      current.incarnationId === stamp.incarnationId
    );
  }
  private dispatch() {
    const active = this.active;
    if (!active || active.inFlight || !active.pending.length) return;
    if (!this.valid(active.stamp)) {
      this.cancel();
      return;
    }
    try {
      if (!this.worker) {
        this.worker = this.createWorker();
        this.worker.onmessage = ({ data }) => this.receive(data);
        this.worker.onerror = () => this.cancel("SKETCH_WORKER_FAILED");
        this.worker.onmessageerror = () => this.cancel("SKETCH_WORKER_FAILED");
      }
      const points = active.pending;
      active.pending = [points[points.length - 1]];
      const targets: CoverageRequest["targets"][number][] = [],
        deletedIds: string[] = [];
      for (const element of active.document.elements) {
        if (
          !sweepIntersectsBounds(
            points,
            active.radius,
            elementBounds(element, this.callbacks.text),
          )
        )
          continue;
        if (element.kind === "text") {
          if (this.callbacks.glyphHit(element, points, active.radius))
            deletedIds.push(element.id);
        } else if (!active.sentTargets.has(element.id)) {
          active.sentTargets.add(element.id);
          targets.push(element);
        }
      }
      const request: CoverageRequest = {
        ...active.stamp,
        phase: active.finishing ? "final" : "preview",
        sampleSequence: active.sequence,
        points,
        radius: active.radius,
        targets,
        deletedIds,
        ...(!active.started
          ? {
              start: {
                sourceBytes: sourceBytes(active.document),
                elementCount: active.document.elements.length,
                renderBytes: active.renderBytes,
              },
            }
          : {}),
      };
      active.started = true;
      active.inFlight = true;
      active.sentSequence = request.sampleSequence;
      active.sentPhase = request.phase;
      this.worker.postMessage(request);
    } catch (error) {
      this.fail(error);
    }
  }
  private receive(response: CoverageResponse) {
    const active = this.active;
    if (!active || !sameStamp(response, active.stamp)) return;
    if (!this.valid(active.stamp)) {
      this.cancel();
      return;
    }
    if (
      !active.inFlight ||
      response.phase !== active.sentPhase ||
      response.sampleSequence !== active.sentSequence
    )
      return;
    if (response.error) {
      this.cancel(response.error);
      return;
    }
    if (
      response.phase === "preview" &&
      response.sampleSequence <= active.accepted
    )
      return;
    if (
      response.phase === "final" &&
      (!active.finishing || response.sampleSequence !== active.sequence)
    )
      return;
    try {
      for (const block of response.blocks)
        active.blocks.set(block.id, Object.freeze(block));
      const replacements: ErasureReplacement[] = response.replacements.map(
        (r) => ({
          id: r.id,
          elements: r.elements.map((element) =>
            Object.freeze({
              ...element,
              coverage: Object.freeze({
                ...element.coverage,
                blocks: Object.freeze(
                  element.coverage.blocks.map((id) => {
                    const block = active.blocks.get(id);
                    if (!block) throw new Error("SKETCH_INVALID_SOURCE");
                    return block;
                  }),
                ),
              }),
            }),
          ),
        }),
      );
      const candidate = applyReplacements(
        active.document,
        replacements,
        response.phase === "final",
      );
      // The worker only references original or current blocks. Retiring preview blocks bounds a long gesture.
      const retained = new Set<string>();
      for (const document of [active.document, candidate])
        for (const element of document.elements)
          if (element.kind === "ink")
            for (const block of element.coverage.blocks) retained.add(block.id);
      for (const id of active.blocks.keys())
        if (!retained.has(id)) active.blocks.delete(id);
      active.accepted = response.sampleSequence;
      active.computeMs += response.computeMs;
      active.inFlight = false;
      if (response.phase === "final") {
        this.active = undefined;
        this.callbacks.final(candidate, {
          computeMs: active.computeMs,
          temporaryBytes: response.temporaryBytes,
        });
      } else {
        this.callbacks.preview(candidate);
        if (active.finishing || active.sequence > active.accepted)
          this.dispatch();
      }
    } catch (error) {
      this.fail(error);
    }
  }
}
