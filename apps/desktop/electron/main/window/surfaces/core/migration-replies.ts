/**
 * [INPUT]: Depends on Product window identities, renderer incarnations, migration commands, and bounded timeouts.
 * [OUTPUT]: Queues requests until the current document installs its listener, within the original deadline; validates exact source/mode ACKs and rejects window loss.
 * [POS]: Surface handoff reply owner used by SurfaceWindowController.
 */
import { WINDOW_SURFACES_CHANNEL } from "../../../../../shared/ipc/settings/window-surfaces-ipc";
import type { SurfaceMigrationCommand, SurfaceMigrationReply } from "../../../../../shared/ipc/settings/window-surfaces-ipc";
import type { TrustedRendererContext } from "../trusted-renderer-context";
import type { WindowRegistry } from "../window-registry";
import { rendererIdentity } from "../../security/renderer-identity";

type PendingReply = {
  rendererIncarnation: string | null;
  command: SurfaceMigrationCommand;
  expectedMode?: "present" | "background";
  expectedWindowId: string;
  expectedOutcome: SurfaceMigrationReply["outcome"];
  resolve(value: SurfaceMigrationReply): void;
  reject(cause: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};

export class MigrationReplies {
  private readonly pending = new Map<string, PendingReply>();
  private readonly readyRenderers = new Map<string, string>();
  constructor(private readonly registry: WindowRegistry) {}
  request(
    windowId: string,
    command: SurfaceMigrationCommand,
    expectedOutcome: SurfaceMigrationReply["outcome"]
  ) {
    const record = this.registry.get(windowId);
    if (!record) return Promise.reject(new Error("Migration window is unavailable"));
    const transactionId = "transactionId" in command ? command.transactionId : "";
    return new Promise<SurfaceMigrationReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(transactionId);
        reject(new Error(`Surface migration timed out: ${expectedOutcome}`));
      }, 4_000);
      this.pending.set(transactionId, {
        expectedWindowId: windowId,
        rendererIncarnation: null,
        command,
        expectedMode: command.type === "hydrate" ? command.mode ?? "present" : undefined,
        expectedOutcome,
        resolve,
        reject,
        timer,
      });
      this.deliver(transactionId);
    });
  }

  ready(context: TrustedRendererContext) {
    this.readyRenderers.set(context.windowId, context.rendererIncarnation);
    for (const [id, pending] of this.pending) {
      if (pending.expectedWindowId === context.windowId) this.deliver(id);
    }
  }

  private deliver(transactionId: string) {
    const pending = this.pending.get(transactionId);
    if (!pending || pending.rendererIncarnation !== null) return;
    const record = this.registry.get(pending.expectedWindowId);
    if (!record) return;
    const incarnation = rendererIdentity(record.webContentsId).rendererSessionId;
    if (this.readyRenderers.get(record.windowId) !== incarnation) return;
    // Bind only when sent: initial navigation may start after quit has queued the request.
    // A sent request never moves to a replacement document or gets replayed on duplicate readiness.
    pending.rendererIncarnation = incarnation;
    try { record.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, pending.command); }
    catch (cause) {
      this.pending.delete(transactionId);
      clearTimeout(pending.timer);
      pending.reject(cause);
    }
  }

  accept(context: TrustedRendererContext, rawReply: unknown) {
    if (!rawReply || typeof rawReply !== "object") return;
    const reply = rawReply as SurfaceMigrationReply;
    if (typeof reply.transactionId !== "string") return;
    const pending = this.pending.get(reply.transactionId);
    if (!pending || pending.expectedWindowId !== context.windowId || pending.rendererIncarnation !== context.rendererIncarnation) return;
    this.pending.delete(reply.transactionId);
    clearTimeout(pending.timer);
    if (reply.outcome !== pending.expectedOutcome || (pending.expectedMode && reply.mode !== pending.expectedMode)) {
      pending.reject(new Error(reply.message || "Renderer migration failed"));
      return;
    }
    pending.resolve(reply);
  }

  rejectWindow(windowId: string) {
    this.readyRenderers.delete(windowId);
    for (const [id, pending] of this.pending) {
      if (pending.expectedWindowId !== windowId) continue;
      this.pending.delete(id); clearTimeout(pending.timer); pending.reject(new Error("MIGRATION_RENDERER_LOST"));
    }
  }
}
