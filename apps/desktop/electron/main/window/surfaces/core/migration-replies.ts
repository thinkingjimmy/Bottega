/**
 * [INPUT]: Depends on Product window identities, renderer incarnations, migration commands, and bounded timeouts.
 * [OUTPUT]: Provides correlated migration requests and exact source/mode ACK validation with window-loss rejection.
 * [POS]: Surface handoff reply owner used by SurfaceWindowController.
 */
import { WINDOW_SURFACES_CHANNEL } from "../../../../../shared/window-surfaces-ipc";
import type { SurfaceMigrationCommand, SurfaceMigrationReply } from "../../../../../shared/window-surfaces-ipc";
import type { TrustedRendererContext } from "../trusted-renderer-context";
import type { WindowRegistry } from "../window-registry";
import { rendererIdentity } from "../../renderer-identity";

type PendingReply = {
  rendererIncarnation: string;
  expectedMode?: "present" | "background";
  expectedWindowId: string;
  expectedOutcome: SurfaceMigrationReply["outcome"];
  resolve(value: SurfaceMigrationReply): void;
  reject(cause: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};

export class MigrationReplies {
  private readonly pending = new Map<string, PendingReply>();
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
        rendererIncarnation: rendererIdentity(record.webContentsId).rendererSessionId,
        expectedMode: command.type === "hydrate" ? command.mode ?? "present" : undefined,
        expectedOutcome,
        resolve,
        reject,
        timer,
      });
      record.window.webContents.send(WINDOW_SURFACES_CHANNEL.command, command);
    });
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
    for (const [id, pending] of this.pending) {
      if (pending.expectedWindowId !== windowId) continue;
      this.pending.delete(id); clearTimeout(pending.timer); pending.reject(new Error("MIGRATION_RENDERER_LOST"));
    }
  }
}
