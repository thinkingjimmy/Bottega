/**
 * [INPUT]: An explicitly installed bounded numeric timing probe and immutable input identities.
 * [OUTPUT]: Optional input, writer, bootstrap-task/frame-tail lifecycle and exact world/screen/atomic prefix observations without scheduling authority.
 * [POS]: Measurement-only adapter for the single camera owner; absent probes allocate no input ledger.
 */
export type CameraInput = { session: string; boot: string; lease?: string; seq: number };
export type CameraProjection = { owner: string; id: number; frame: number; epoch: number; task?: number; camera?: { x: number; y: number; zoom: number }; through: number; inputs: { input: CameraInput; operation: number }[]; trigger: "raf" | "child-input" | "frame-tail" | "input-task" | "dirty-frame" | "flush" };
type TimingProbe = {
  enabled: boolean;
  overflow(): void;
  unknown(): void;
  lookup(event: WheelEvent, lease?: string): CameraInput | undefined;
  reject(input: CameraInput | undefined, reason: string): void;
  receive(lease: string, seq: number, at: number, metadata: unknown): CameraInput | undefined;
  admit(input: CameraInput | undefined): void;
  accept(input: CameraInput, owner: string, operation: number, frame: number, camera: { x: number; y: number; zoom: number }): void;
  task?(owner: string, task: number, phase: "scheduled" | "callback" | "cancelled"): void;
  schedule(owner: string, frame: number): void;
  callback(owner: string, frame: number, timestamp: number): void;
  cancel(owner: string, frame: number): void;
  tail(owner: string, frame: number, phase: "scheduled" | "fired" | "cancelled", deadline: number, eligibilityAt?: number | null): void;
  dom(projection: CameraProjection): void;
  applied(projection: CameraProjection): void;
  screen(projection: CameraProjection): void;
  atomic(projection: CameraProjection | undefined, committed: boolean): void;
};
export const canvasTiming = () => (globalThis as typeof globalThis & { __canvasTiming?: TimingProbe }).__canvasTiming;
export function timedInput(event: WheelEvent) { const probe = canvasTiming(); return probe?.enabled ? probe.lookup(event) : undefined; }
export function timedAdmission(input: CameraInput | undefined) { if (input) canvasTiming()?.admit(input); }
export function timedDomProjection(projection?: CameraProjection) { if (projection?.inputs.length) canvasTiming()?.dom(projection); }
