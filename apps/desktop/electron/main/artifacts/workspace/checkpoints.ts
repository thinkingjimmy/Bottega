/**
 * [INPUT]: DurableJson, trusted window/view/document lifetimes and bounded review checkpoints.
 * [OUTPUT]: Stores revision-bound checkpoint CAS versions and preserves conflicting view input.
 * [POS]: Recovery input custody; not a second permanent comment store.
 */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { checkpointSchema, type DesignCheckpoint } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { DurableJson } from "../../persistence/durable-json";
import { ARTIFACT_IPC } from "../../../../shared/ipc-channels/apps";
import { BrowserWindow } from "electron";
import { encryptedResourceCommandSchema, type EncryptedResourceCommand } from "@ai-chat/cloud-protocol/resources/model";
const schema = z.object({ schemaVersion: z.literal(1), inputs: z.record(z.string(), checkpointSchema),
  conflicts: z.record(z.string(), z.array(checkpointSchema).max(16)).default({}),
  commands: z.record(z.string(), z.object({ digest: z.string(), sealed: encryptedResourceCommandSchema }).strict()).default({}) }).strict();
export class ArtifactCheckpoints {
  private readonly file: DurableJson<z.infer<typeof schema>>;
  private readonly windows = new Map<number, Map<string, string>>();
  private readonly waits = new Map<string, { windowId: number; viewId: string; scope: string; resolve(): void }>();
  fault = false;
  constructor(root: string) { this.file = new DurableJson(join(root, "review-checkpoints.json"), schema, () => ({ schemaVersion: 1, inputs: {}, conflicts: {}, commands: {} })); }
  initialize() { return this.file.initialize(); }
  key(chatId: string, incarnationId: string, documentId: string) { return JSON.stringify([chatId, incarnationId, documentId]); }
  read(chatId: string, incarnationId: string, documentId: string, revision?: number) { return this.file.read(state => state.inputs[this.key(chatId, incarnationId, documentId) + ":" + revision] ?? null); }
  conflicts(chatId: string, incarnationId: string, documentId: string, revision: number) { return this.file.read(state => state.conflicts[this.key(chatId, incarnationId, documentId) + ":" + revision] ?? []); }
  async save(chatId: string, incarnationId: string, input: DesignCheckpoint) {
    if (this.fault) throw new Error("Artifact checkpoint could not be saved. Retry before closing.");
    const value = checkpointSchema.parse(input);
    const key = this.key(chatId, incarnationId, input.documentId) + ":" + input.revision;
    const result = await this.file.mutate(state => {
      const previous = state.inputs[key];
      if (previous?.save && (!value.save || previous.save.version !== value.save.version || previous.save.viewId === value.save.viewId && previous.save.sequence >= value.save.sequence)) {
        const conflicts = state.conflicts[key] ?? [];
        if (conflicts.length >= 16) return { conflict: true, full: true };
        state.conflicts[key] = [...conflicts.filter(row => row.save?.viewId !== value.save?.viewId), value];
        return { conflict: true };
      }
      const version = (previous?.save?.version ?? 0) + 1;
      state.inputs[key] = { ...value, ...(value.save ? { save: { ...value.save, version } } : {}) };
      return { version };
    });
    if (result.conflict) throw new Error(result.full ? "Checkpoint conflicts are full. Keep this view open." : "Checkpoint conflict. Both drafts are retained. Reload before saving.");
    return result.version;
  }
  command(key: string) { return this.file.read(state => state.commands[key] ?? null); }
  async retainCommand(key: string, digest: string, sealed: EncryptedResourceCommand) {
    return this.file.mutate(state => {
      const existing = state.commands[key];
      if (existing) { if (existing.digest !== digest) throw new Error("artifact-request-conflict"); return existing.sealed; }
      if (Object.keys(state.commands).length >= 128) throw new Error("artifact-command-budget");
      state.commands[key] = { digest, sealed }; return sealed;
    });
  }
  releaseCommand(key: string) { return this.file.mutate(state => { delete state.commands[key]; }); }
  releaseRequest(scope: readonly unknown[], requestId: string) {
    return this.file.mutate(state => {
      for (const key of Object.keys(state.commands)) {
        const value = JSON.parse(key) as unknown[];
        if (scope.every((part, index) => part === value[index]) && value.at(-1) === requestId) delete state.commands[key];
      }
    });
  }
  releaseChat(chatId: string, incarnationId: string) {
    return this.file.mutate(state => {
      for (const key of Object.keys(state.inputs)) { const value = JSON.parse(key.slice(0, key.lastIndexOf("]") + 1)) as string[]; if (value[0] === chatId && value[1] === incarnationId) delete state.inputs[key]; }
      for (const key of Object.keys(state.conflicts)) { const value = JSON.parse(key.slice(0, key.lastIndexOf("]") + 1)) as string[]; if (value[0] === chatId && value[1] === incarnationId) delete state.conflicts[key]; }
      for (const key of Object.keys(state.commands)) { const value = JSON.parse(key.slice(0, key.lastIndexOf("]") + 1)) as string[]; if (value[0] === chatId && value[1] === incarnationId) delete state.commands[key]; }
    });
  }
  observe(windowId: number, viewId: string, scope: string) {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.id === windowId);
    if (!window || window.isDestroyed()) throw new Error("Original Artifact workspace window is unavailable");
    const views = this.windows.get(windowId) ?? new Map<string, string>();
    if (views.has(viewId) && views.get(viewId) !== scope) throw new Error("Artifact workspace view scope changed");
    views.set(viewId, scope); this.windows.set(windowId, views);
  }
  releaseView(windowId: number, viewId: string, scope: string) {
    const views = this.windows.get(windowId); if (!views?.has(viewId)) return;
    if (views.get(viewId) !== scope) throw new Error("Artifact workspace view scope changed");
    views.delete(viewId); if (!views.size) this.windows.delete(windowId);
  }
  ack(windowId: number, nonce: string, viewId: string, scope: string) {
    const wait = this.waits.get(nonce);
    if (!wait || wait.windowId !== windowId || wait.viewId !== viewId || wait.scope !== scope) throw new Error("Invalid Artifact checkpoint acknowledgement");
    wait.resolve(); this.waits.delete(nonce);
  }
  async prepareDisable(generation: string) {
    if (this.fault) throw new Error("Artifact checkpoint could not be saved. Retry before closing.");
    const pending: Promise<void>[] = [];
    for (const [windowId, views] of this.windows) {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.id === windowId);
      if (!window || window.isDestroyed()) { this.windows.delete(windowId); continue; }
      for (const [viewId, scope] of views) {
        const nonce = randomUUID();
        pending.push(new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { this.waits.delete(nonce); reject(new Error("Artifact checkpoint timed out. Keep your input and retry.")); }, 5_000);
          this.waits.set(nonce, { windowId, viewId, scope, resolve: () => { clearTimeout(timer); resolve(); } });
        }));
        window.webContents.send(ARTIFACT_IPC.workspaceEvent, { type: "before-disable", nonce, generation, scope: viewId });
      }
    }
    await Promise.all(pending);
  }
  changed(generation: string, enabled: boolean) {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed())
      window.webContents.send(ARTIFACT_IPC.workspaceEvent, { type: "changed", generation, enabled });
  }
  release(windowId: number) { this.windows.delete(windowId); }
  close() { return this.file.closeAndFlush(); }
}
