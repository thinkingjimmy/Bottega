/**
 * [INPUT]: Ordered bounded camera operations, React DOM synchronous commits and a scope-owned checkpoint callback.
 * [OUTPUT]: Task-atomic bootstrap, gesture-owned trailing frame clock, cancellable lifetime-owned work, compositing and synchronous lifecycle camera flush.
 * [POS]: Workspace-local camera owner shared by stage, frame, fit and keyboard input.
 */
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { CanvasCamera } from "./camera";
import { canvasTiming, type CameraInput, type CameraProjection } from "./timing";
import { cameraTrace } from "../stage/state/diagnostics";
const FRAME_TAIL_MS = 6;
export class CanvasCameraController {
  private live: CanvasCamera;
  private projected: CanvasCamera;
  private projections = new Set<(camera: CanvasCamera, projection?: CameraProjection) => void>();
  private listeners = new Set<() => void>();
  private motionListeners = new Set<(active: boolean) => void>();
  private moving = false;
  private job: number | null = null;
  private jobSequence = 0;
  private frame: { id: number; handle: number | null } | null = null;
  private frameSequence = 0;
  private epoch = 0;
  private frameTimestamp = 0;
  private projectedEpoch = 0;
  private tail: { frame: number; deadline: number; handle: ReturnType<typeof setTimeout> | null } | null = null;
  private visualGeneration = 0;
  private gesture: "idle" | "bootstrap" | "active" = "idle";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private changed = false;
  private disposed = false;
  private lifetime = 0;
  private suspended = false;
  private sequence = 0;
  private projectionSequence = 0;
  private inputs: { input: CameraInput; operation: number }[] = [];
  private checkpoint: (camera: CanvasCamera) => void = () => {};
  constructor(camera: CanvasCamera, readonly scope: string) { this.live = camera; this.projected = camera; }
  resume() {
    if (this.disposed || this.suspended) { this.lifetime++; this.gesture = "idle"; this.epoch = 0; this.frameTimestamp = 0; }
    this.disposed = false; this.suspended = false;
    if (this.projected !== this.live && this.changed && this.timer === undefined) this.armSettlement();
    this.schedule();
  }
  suspend() {
    if (this.disposed) return;
    if (!this.suspended) this.lifetime++;
    this.suspended = true; this.settle();
  }
  setCheckpoint(checkpoint: (camera: CanvasCamera) => void) { this.checkpoint = checkpoint; }
  read = () => this.live;
  snapshot = () => this.projected;
  projectTo = (projection: (camera: CanvasCamera, details?: CameraProjection) => void) => { this.projections.add(projection); projection(this.projected); return () => { this.projections.delete(projection); }; };
  motionTo = (listener: (active: boolean) => void) => { this.motionListeners.add(listener); listener(this.moving); return () => { this.motionListeners.delete(listener); }; };
  private motion(active: boolean) {
    if (this.moving === active) return;
    const lifetime = this.lifetime, generation = this.visualGeneration;
    this.moving = active;
    for (const listener of [...this.motionListeners]) { if (!this.current(lifetime, generation)) return; listener(active); }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  initialize(camera: CanvasCamera) { if (!this.changed && this.sequence === 0) { this.live = camera; this.project(); } }
  change = (next: CanvasCamera, input?: CameraInput) => {
    if (this.disposed) { cameraTrace("scope-rejected", { scope: this.scope }); return; }
    const lifetime = this.lifetime;
    cameraTrace("camera-write", { scope: this.scope, seq: ++this.sequence, before: this.live, after: next });
    this.live = next; this.changed = true;
    if (!this.suspended && this.gesture === "idle") this.gesture = "bootstrap";
    if (input) {
      if (this.inputs.length < 8192) this.inputs.push({ input, operation: this.sequence }); else canvasTiming()?.overflow();
      canvasTiming()?.accept(input, this.scope, this.sequence, 0, next);
    }
    if (this.disposed || this.lifetime !== lifetime) return;
    this.motion(true);
    if (this.disposed || this.lifetime !== lifetime) return;
    this.armSettlement();
    this.schedule();
  };
  private current(lifetime: number, generation: number) { return this.lifetime === lifetime && this.visualGeneration === generation; }
  private canRun(lifetime: number, generation: number) { return !this.disposed && !this.suspended && this.current(lifetime, generation); }
  private clearSettlement() { clearTimeout(this.timer); this.timer = undefined; }
  private armSettlement() {
    this.clearSettlement();
    const sequence = this.sequence;
    const timer = setTimeout(() => {
      // Visibility resume keeps the original inactivity deadline across visual lifetimes.
      if (this.timer !== timer || this.sequence !== sequence || this.disposed) return;
      this.timer = undefined; this.settle();
    }, 180);
    this.timer = timer;
  }
  private schedule() {
    if (this.disposed || this.suspended) return;
    if (this.gesture === "idle") {
      if (this.projected === this.live) return;
      this.gesture = "bootstrap";
    }
    if (this.gesture === "active") { this.scheduleTail(); this.scheduleFrame(); return; }
    if (this.projected === this.live) { this.scheduleFrame(); return; }
    if (this.job !== null) return;
    const job = ++this.jobSequence, lifetime = this.lifetime, generation = this.visualGeneration;
    this.job = job;
    canvasTiming()?.task?.(this.scope, job, "scheduled");
    if (this.job !== job || !this.canRun(lifetime, generation)) return;
    queueMicrotask(() => {
      if (this.job !== job || !this.canRun(lifetime, generation) || this.gesture !== "bootstrap") return;
      this.job = null;
      canvasTiming()?.task?.(this.scope, job, "callback");
      if (!this.canRun(lifetime, generation) || this.gesture !== "bootstrap") return;
      this.scheduleFrame();
      if (!this.canRun(lifetime, generation) || this.gesture !== "bootstrap") return;
      this.atomicProject("input-task", job, lifetime, generation);
      if (this.canRun(lifetime, generation)) this.schedule();
    });
  }
  private scheduleFrame() {
    if (this.frame !== null || this.disposed || this.suspended || this.gesture === "idle") return;
    const frame = { id: ++this.frameSequence, handle: null as number | null }, lifetime = this.lifetime, generation = this.visualGeneration;
    this.frame = frame;
    canvasTiming()?.schedule(this.scope, frame.id);
    if (this.frame !== frame || !this.canRun(lifetime, generation)) return;
    frame.handle = requestAnimationFrame(timestamp => {
      if (this.frame !== frame || !this.canRun(lifetime, generation) || this.gesture === "idle") return;
      const previousTail = this.tail;
      this.frame = null; this.epoch = frame.id; this.frameTimestamp = timestamp; this.gesture = "active";
      canvasTiming()?.callback(this.scope, frame.id, timestamp);
      if (!this.canRun(lifetime, generation)) return;
      this.cancelTail(previousTail);
      if (!this.canRun(lifetime, generation)) return;
      const job = this.job; this.job = null;
      if (job !== null) canvasTiming()?.task?.(this.scope, job, "cancelled");
      if (!this.canRun(lifetime, generation)) return;
      this.scheduleTail(true);
      if (this.canRun(lifetime, generation)) this.scheduleFrame();
    });
  }
  private scheduleTail(fromFrame = false) {
    if (this.tail !== null || this.disposed || this.suspended || this.gesture !== "active" || !this.changed || this.projected === this.live || !this.epoch || this.projectedEpoch === this.epoch) return;
    const frame = this.epoch, deadline = this.frameTimestamp + FRAME_TAIL_MS, lifetime = this.lifetime, generation = this.visualGeneration;
    const eligibilityAt = fromFrame ? null : performance.now();
    if (eligibilityAt !== null && eligibilityAt > deadline) return;
    const tail = { frame, deadline, handle: null as ReturnType<typeof setTimeout> | null };
    this.tail = tail;
    canvasTiming()?.tail(this.scope, frame, "scheduled", deadline, eligibilityAt);
    if (this.tail !== tail || !this.canRun(lifetime, generation) || this.epoch !== frame) return;
    tail.handle = setTimeout(() => {
      if (this.tail !== tail || !this.canRun(lifetime, generation) || this.epoch !== frame || this.gesture !== "active") return;
      this.tail = null; this.projectedEpoch = frame;
      canvasTiming()?.tail(this.scope, frame, "fired", deadline);
      if (!this.canRun(lifetime, generation) || this.epoch !== frame || this.gesture !== "active" || this.projected === this.live) return;
      this.atomicProject("frame-tail", frame, lifetime, generation);
      if (this.canRun(lifetime, generation)) this.schedule();
    }, Math.max(0, deadline - performance.now()));
  }
  private cancelTail(tail = this.tail) {
    if (!tail || this.tail !== tail) return;
    this.tail = null;
    if (tail.handle !== null) clearTimeout(tail.handle);
    canvasTiming()?.tail(this.scope, tail.frame, "cancelled", tail.deadline);
  }
  private cancelVisual() {
    const generation = ++this.visualGeneration, job = this.job, frame = this.frame, tail = this.tail;
    this.job = null; this.frame = null; this.tail = null;
    this.epoch = 0; this.frameTimestamp = 0; this.projectedEpoch = 0;
    if (frame && frame.handle !== null) cancelAnimationFrame(frame.handle);
    if (tail && tail.handle !== null) clearTimeout(tail.handle);
    if (job !== null) canvasTiming()?.task?.(this.scope, job, "cancelled");
    if (frame) canvasTiming()?.cancel(this.scope, frame.id);
    if (tail) canvasTiming()?.tail(this.scope, tail.frame, "cancelled", tail.deadline);
    return generation;
  }
  private atomicProject(trigger: "input-task" | "frame-tail", identity: number, lifetime: number, generation: number) {
    const acceptedSequence = this.sequence, camera = this.live;
    let receipt: CameraProjection | undefined;
    flushSync(() => {
      if (this.canRun(lifetime, generation) && this.sequence === acceptedSequence && this.live === camera) receipt = this.project(trigger, identity);
    });
    if (!receipt || !this.canRun(lifetime, generation)) return;
    const probe = canvasTiming();
    if (probe?.enabled) {
      probe.screen(receipt);
      if (!this.canRun(lifetime, generation)) return;
      probe.atomic(receipt, this.sequence === acceptedSequence && this.live === camera && this.projected === camera);
    }
  }
  private project(trigger: CameraProjection["trigger"] = "flush", identity = 0) {
    if (this.projected === this.live) return;
    const camera = this.live, lifetime = this.lifetime, generation = this.visualGeneration;
    this.projected = camera;
    cameraTrace("projection", { scope: this.scope, seq: this.sequence, camera: this.live });
    const frame = trigger === "frame-tail" ? identity : 0;
    const details: CameraProjection | undefined = this.inputs.length ? { owner: this.scope, id: ++this.projectionSequence, frame, epoch: frame, ...(trigger === "input-task" ? { task: identity } : {}), camera, through: this.sequence, inputs: this.inputs, trigger } : undefined;
    if (details) this.inputs = [];
    for (const projection of [...this.projections]) { if (!this.current(lifetime, generation)) return details; projection(camera, details); }
    if (!this.current(lifetime, generation)) return details;
    if (details) canvasTiming()?.applied(details);
    for (const listener of [...this.listeners]) { if (!this.current(lifetime, generation)) return details; listener(); }
    return details;
  }
  end = () => {
    if (!this.disposed && this.timer === undefined && (this.changed || this.gesture !== "idle")) this.armSettlement();
  };
  flush = () => {
    const lifetime = this.lifetime, sequence = this.sequence;
    if (this.gesture !== "idle") this.gesture = "bootstrap";
    const generation = this.cancelVisual();
    if (!this.current(lifetime, generation) || this.sequence !== sequence) return this.live;
    // Lifecycle flush can run during React cleanup; queued visual commits use flushSync.
    this.project();
    if (!this.current(lifetime, generation)) return this.live;
    this.changed = this.projected !== this.live; this.motion(this.changed);
    if (this.current(lifetime, generation)) this.schedule();
    return this.live;
  };
  settle = () => {
    if (this.disposed) return;
    const lifetime = this.lifetime, sequence = this.sequence, changed = this.changed;
    this.clearSettlement(); this.gesture = "idle";
    const camera = this.flush();
    if (!changed || this.disposed || this.lifetime !== lifetime || this.sequence !== sequence || this.gesture !== "idle") return;
    cameraTrace("settle", { scope: this.scope, seq: this.sequence, camera });
    this.checkpoint(camera);
  };
  dispose() {
    const lifetime = ++this.lifetime;
    this.disposed = true; this.gesture = "idle"; this.clearSettlement(); this.flush();
    if (this.lifetime !== lifetime || !this.disposed) return;
    this.listeners.clear(); this.projections.clear(); this.motionListeners.clear();
  }
}
export const useProjectedCamera = (controller: CanvasCameraController) => useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
export type CanvasCameraPort = { read(): { scope: string; pageId: string; camera: CanvasCamera }; flush(): void };

export const useProjectedZoom = (controller: CanvasCameraController) => useSyncExternalStore(controller.subscribe, () => controller.snapshot().zoom, () => controller.snapshot().zoom);
