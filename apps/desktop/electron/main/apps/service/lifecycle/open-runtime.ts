/**
 * [INPUT]: Depends on the App lifecycle admission gate (who closed it, bounded whenOpen), the App record and the runtime's ensureRunning.
 * [OUTPUT]: Provides openRuntime and OPEN_WAIT_MS: start an App for the renderer; an open that lands while a server-data cutover holds the gate waits for it (at most 10 s from the click), and the deadline, App quit, any other closure or a record that is not ready refuses at once with APP_LIFECYCLE_ADMISSION_CLOSED. Uses the shared named availability refusal before runtime admission.
 * [POS]: The apps:open entry behind service/ipc.ts. AppStore commits a cutover's record (now ready) before the cutover's durable ledger write reopens admission, so without the wait a click right after an install or update could be refused.
 */
import { assertAppEnabled } from "../availability/guard";
import type { AppLifecycleAdmissionGate } from "../../../lifecycle/app-platform-admission";

/** One deadline per open: long enough for a cutover's ledger write, short of the cutover's own 30 s drain bound. */
export const OPEN_WAIT_MS = 10_000;

type OpenRuntimeDependencies<Result> = {
  lifecycleGate: AppLifecycleAdmissionGate;
  requireRecord(appId: string): { id?: string; enabled?: boolean; state: string; generationBinding: { active?: { generationId: string } | null } };
  runtime: { ensureRunning(appId: string): Promise<Result> };
};
const refusal = () => Object.assign(new Error("APP_LIFECYCLE_ADMISSION_CLOSED: App 正在换代，稍后再打开"), { status: 409 });
const RETRY = Symbol("retry");

/* Called only from the IPC entry, outside every gate scope: the wait must never run inside lifecycleGate.run. */
export async function openRuntime<Result extends object>(deps: OpenRuntimeDependencies<Result>, appId: string) {
  assertAppEnabled(deps.requireRecord(appId));
  const gate = deps.lifecycleGate, deadline = Date.now() + OPEN_WAIT_MS;
  let result: Result;
  for (;;) {
    // false is the deadline or App quit (the gate was disposed): either ends this open; a disposed gate must never loop back through run.
    if (gate.closedBy(appId) === "server-cutover" && !(await gate.whenOpen(appId, deadline - Date.now()))) throw refusal();
    const outcome = await gate.run<Result | typeof RETRY>(appId, () => {
      const record = deps.requireRecord(appId);
      assertAppEnabled(record);
      if (gate.isOpen(appId) && record.state === "ready") return deps.runtime.ensureRunning(appId);
      // Closed again by another cutover while time is left: wait again against the same deadline.
      if (gate.closedBy(appId) === "server-cutover" && record.state === "ready" && Date.now() < deadline) return RETRY;
      throw refusal();
    });
    if (outcome !== RETRY) { result = outcome; break; }
  }
  const generationId = deps.requireRecord(appId).generationBinding.active?.generationId;
  return { ...result, ...(generationId ? { generationId, activationId: `activation:${appId}:${generationId}` } : {}) };
}
