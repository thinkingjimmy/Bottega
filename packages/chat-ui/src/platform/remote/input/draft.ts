/**
 * [INPUT]: Account/key lifetime, browser files, scoped upload ports and exact submitted command descriptors.
 * [OUTPUT]: Retains complete drafts and unsent first-message text across routes; clears only accepted revisions without replacing a newer draft.
 * [POS]: Page-memory custody; no localStorage, IndexedDB, credentials or durable outbox.
 */
import type { RemoteReference } from "@ai-chat/cloud-protocol/remote/input/references";
import type { FileProgress } from "@ai-chat/cloud-protocol";
import type { RemoteAttachment, RemoteFullAccessConsent, RemotePermissionMode } from "@ai-chat/cloud-protocol/remote/input/model";
import type { RemoteTurnOptions } from "@ai-chat/cloud-protocol/remote/model";
import type { ChatPlatform } from "../../contracts";
import { assertRemoteFile, type RemoteAttachmentPort } from "./upload";
import type { RemoteCreated, RemoteCreateInput } from "../contracts";
import type { FrozenRemoteCreation } from "@ai-chat/cloud-protocol/remote/encrypted";
type DraftCreation = { input: RemoteCreateInput; commandId: string; text: string; permissionMode: RemotePermissionMode; planMode: boolean; options?: RemoteTurnOptions; references?: readonly RemoteReference[]; frozen?: FrozenRemoteCreation; receipt?: RemoteCreated };
/** A model choice belongs to the Agent it was made for; switching Agents drops it. */
type DraftModelChoice = { backend: RemoteCreateInput["backend"]; model?: string; reasoningEffort?: string; serviceTier?: string };
export type DraftFile = { id: string; file: File; preview: string; sketch?: unknown; uploadId: string;
  state: "queued" | "uploading" | "ready" | "failed"; progress?: FileProgress; attachment?: RemoteAttachment; error?: string };
export type DraftReference = { id: string; label: string; value: RemoteReference };
export type ComposerDraft = { references: DraftReference[]; text: string; files: DraftFile[]; permissionMode: RemotePermissionMode | null; planMode: boolean; options: DraftModelChoice | null;
  consent: RemoteFullAccessConsent | null; revision: number; dismissedPlans: string[]; creation?: DraftCreation | null; retainedText?: string | null;
  submittedPlan?: { commandId: string; planId: string; planMode: boolean } | null };
const empty = (): ComposerDraft => ({ references: [], text: "", files: [], permissionMode: null, planMode: false, options: null, consent: null, revision: 0, dismissedPlans: [] });
export class RemoteDraftStore {
  private value = empty();
  private listeners = new Set<() => void>();
  private uploads = new Map<string, { controller: AbortController; promise: Promise<RemoteAttachment> }>();
  private submitted = new Map<string, Pick<ComposerDraft, "text" | "files" | "references">>();
  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  update(patch: Partial<Omit<ComposerDraft, "revision">>) { this.value = { ...this.value, ...patch, revision: this.value.revision + 1 }; this.listeners.forEach(listener => listener()); }
  text = (text: string) => this.update({ text });
  handoffCreation(submitted: boolean) {
    const original = this.value.creation?.text;
    if (submitted || !original) { this.update({ creation: null }); return; }
    this.update({ creation: null, ...(this.value.text ? { retainedText: original } : { text: original }) });
  }
  restoreText() {
    if (this.value.retainedText) this.update({ text: this.value.retainedText, retainedText: this.value.text || null });
  }
  add(files: readonly File[], sketch?: unknown, replaceId?: string) {
    files.forEach(assertRemoteFile);
    if (this.value.files.length + files.length - (replaceId ? 1 : 0) > 8) throw new Error("attachment-count");
    const added = files.map(file => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), sketch,
      uploadId: crypto.randomUUID(), state: "queued" as const }));
    const index = replaceId ? this.value.files.findIndex(file => file.id === replaceId) : -1;
    if (replaceId && index < 0) { added.forEach(file => URL.revokeObjectURL(file.preview)); throw new Error("attachment-changed"); }
    if (replaceId) this.release(this.value.files[index]!);
    const next = [...this.value.files]; if (index >= 0) next.splice(index, 1, ...added); else next.push(...added);
    this.update({ files: next });
  }
  private release(file: DraftFile) { this.uploads.get(file.id)?.controller.abort(); this.uploads.delete(file.id); if (file.preview) URL.revokeObjectURL(file.preview); }
  remove(id: string) { const file = this.value.files.find(file => file.id === id); if (file) this.release(file); this.update({ files: this.value.files.filter(file => file.id !== id) }); }
  private file(id: string, patch: Partial<DraftFile>) { if (this.value.files.some(file => file.id === id)) this.update({ files: this.value.files.map(file => file.id === id ? { ...file, ...patch } : file) }); }
  stage(file: DraftFile, chatId: string, port: RemoteAttachmentPort, signal: AbortSignal) {
    if (file.attachment?.blob.encryption.owner.id === chatId && file.state === "ready") return Promise.resolve(file.attachment);
    const previous = this.uploads.get(file.id); if (previous) return previous.promise;
    const controller = new AbortController(); this.file(file.id, { state: "uploading", error: undefined });
    const promise = port.stage({ chatId, attachmentId: file.id, uploadId: file.uploadId, file: file.file }, AbortSignal.any([signal, controller.signal]), progress => this.file(file.id, { progress }))
      .then(attachment => { this.file(file.id, { attachment, state: "ready" }); return attachment; })
      .catch(error => { this.file(file.id, { state: "failed", error: error instanceof Error ? error.message : "attachment-unavailable" }); throw error; })
      .finally(() => { if (this.uploads.get(file.id)?.controller === controller) this.uploads.delete(file.id); });
    this.uploads.set(file.id, { controller, promise }); return promise;
  }
  async prepare(chatId: string, port: RemoteAttachmentPort | undefined, signal: AbortSignal) {
    if (!this.value.files.length) return [];
    if (!port) throw new Error("input-unsupported");
    const values: RemoteAttachment[] = [];
    for (const file of this.value.files) values.push(await this.stage(file, chatId, port, signal));
    return values;
  }
  awaiting(commandId: string, text: string, attachments: readonly RemoteAttachment[] = [], references: readonly RemoteReference[] = []) {
    if (this.submitted.has(commandId)) return;
    const ids = new Set(attachments.map(file => file.attachmentId)), keys = new Set(references.map(reference => JSON.stringify(reference)));
    this.submitted.set(commandId, { text, files: this.value.files.filter(file => ids.has(file.id)),
      references: this.value.references.filter(reference => keys.has(JSON.stringify(reference.value))) });
    this.accepted(text, attachments, references, false);
  }
  transfer(from: string, to: string) {
    const original = this.submitted.get(from); if (!original) return;
    this.submitted.set(to, original); this.submitted.delete(from);
  }
  confirmed(commandId: string) {
    this.submitted.get(commandId)?.files.forEach(file => this.release(file));
    this.submitted.delete(commandId);
  }
  restore(commandId: string) {
    const original = this.submitted.get(commandId); if (!original) return false;
    this.submitted.delete(commandId);
    const fileIds = new Set(this.value.files.map(file => file.id)), references = new Set(this.value.references.map(reference => JSON.stringify(reference.value)));
    this.update({ ...(this.value.text ? { retainedText: original.text || this.value.retainedText } : { text: original.text }),
      files: [...this.value.files, ...original.files.filter(file => !fileIds.has(file.id))],
      references: [...this.value.references, ...original.references.filter(reference => !references.has(JSON.stringify(reference.value)))] });
    return true;
  }
  accepted(text: string, attachments: readonly RemoteAttachment[] = [], references: readonly RemoteReference[] = [], release = true) {
    const ids = new Set(attachments.map(file => file.attachmentId));
    const files = this.value.files.filter(file => { if (!ids.has(file.id)) return true; if (release) this.release(file); return false; });
    const keys = new Set(references.map(reference => JSON.stringify(reference)));
    this.update({ text: this.value.text === text ? "" : this.value.text, files, references: this.value.references.filter(reference => !keys.has(JSON.stringify(reference.value))) });
  }
  invalidate(attachments: readonly RemoteAttachment[]) {
    const missing = new Set(attachments.map(file => file.blob.blobId));
    this.update({ files: this.value.files.map(file => file.attachment && missing.has(file.attachment.blob.blobId)
      ? { ...file, state: "queued", attachment: undefined, uploadId: crypto.randomUUID(), progress: undefined, error: undefined } : file) });
  }
  reset() { this.value.files.forEach(file => this.release(file)); for (const draft of this.submitted.values()) draft.files.forEach(file => this.release(file)); this.submitted.clear(); this.value = empty(); this.listeners.forEach(listener => listener()); }
}
type DraftPlatform = Pick<ChatPlatform, "account"> & Partial<Pick<ChatPlatform, "commands">>;
const scopes = new WeakMap<object, Map<string, RemoteDraftStore>>();
export function remoteDraftStore(platform: DraftPlatform, key: string, initialText = "") {
  const port = platform.commands?.remote, identity = port?.cacheScope ?? port ?? platform.account;
  let drafts = scopes.get(identity);
  if (!drafts) {
    drafts = new Map(); const owned = drafts, account = platform.account.snapshot(); let stop = () => {};
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if ([...owned.values()].some(draft => { const value = draft.snapshot(); return value.text.trim() || value.files.length || value.references.length || value.creation || value.retainedText; })) { event.preventDefault(); event.returnValue = ""; }
    };
    if (typeof window !== "undefined") window.addEventListener("beforeunload", beforeUnload);
    const clear = () => { owned.forEach(draft => draft.reset()); owned.clear(); scopes.delete(identity); stop(); port?.lifetime?.removeEventListener("abort", clear);
      if (typeof window !== "undefined") window.removeEventListener("beforeunload", beforeUnload); };
    stop = platform.account.subscribe(() => { const current = platform.account.snapshot(); if (current.profile?.userId !== account.profile?.userId || current.deviceId !== account.deviceId) clear(); });
    port?.lifetime?.addEventListener("abort", clear, { once: true }); scopes.set(identity, drafts);
  }
  let draft = drafts.get(key); if (!draft) { draft = new RemoteDraftStore(); if (initialText) draft.text(initialText); drafts.set(key, draft); }
  return draft;
}
export function handoffRemoteDraft(platform: DraftPlatform, sourceKey: string, destinationKey: string) {
  const port = platform.commands?.remote, drafts = scopes.get(port?.cacheScope ?? port ?? platform.account), draft = drafts?.get(sourceKey);
  if (draft) { drafts!.set(destinationKey, draft); drafts!.delete(sourceKey); }
}
