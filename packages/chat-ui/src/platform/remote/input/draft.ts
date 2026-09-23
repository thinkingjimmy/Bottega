/**
 * [INPUT]: Account/key lifetime, browser files, the shared image pipeline, scoped upload ports, an optional encrypted checkpoint port and exact submitted command descriptors.
 * [OUTPUT]: Retains complete drafts and unsent first-message text across routes; images pass source admission, a cancellable processing state and one fixed processed File; unsent uploads older than DRAFT_UPLOAD_TTL_MS (20 h) turn into expired failed tiles and upload again; clears only accepted revisions without replacing a newer draft; tracks in-flight commands for W23 recovery.
 * [POS]: Draft custody. Page memory is the live copy; checkpoint.ts persists it through a host port (never localStorage) and recovers it after the page is gone.
 */
import type { RemoteReference } from "@ai-chat/cloud-protocol/remote/input/references";
import type { FileProgress } from "@ai-chat/cloud-protocol";
import { REMOTE_ATTACHMENT_BYTES, type RemoteAttachment, type RemoteConsentScope, type RemotePermissionMode } from "@ai-chat/cloud-protocol/remote/input/model";
import type { RemoteTurnOptions } from "@ai-chat/cloud-protocol/remote/model";
import type { ChatPlatform } from "../../contracts";
import { assertRemoteFile, type RemoteAttachmentPort } from "./upload";
import type { RemoteCreated, RemoteCreateInput, RemoteCommandInput } from "../contracts";
import type { FrozenRemoteCommand, FrozenRemoteCreation } from "@ai-chat/cloud-protocol/remote/encrypted";
import { awaitingRemoteAdmission, type RemoteEntry } from "../commands/session";
import { admitImageSource, isImageSource, processImage, type ImageCodec } from "./image/pipeline";
import { canvasImageCodec } from "./image/canvas";
import { blobKey, DraftCheckpointBinder, type DraftCheckpoint, type CheckpointFile } from "./checkpoint";
type DraftCreation = { input: RemoteCreateInput; commandId: string; text: string; permissionMode: RemotePermissionMode; planMode: boolean; options?: RemoteTurnOptions; references?: readonly RemoteReference[]; frozen?: FrozenRemoteCreation; receipt?: RemoteCreated;
  /** Restored from a checkpoint: its result must be looked up before anything is sent again. */
  recovered?: boolean };
/** A model choice belongs to the Agent it was made for; switching Agents drops it. */
type DraftModelChoice = { backend: RemoteCreateInput["backend"]; model?: string; reasoningEffort?: string; serviceTier?: string };
/* processing: an image source holds a slot while it becomes the fixed File; rejected: it could not (format/size/dimensions);
   reselect: restored after the page was gone without its bytes, so the user has to pick it again. */
export type DraftFile = { id: string; file: File; preview: string; image: boolean; sketch?: unknown; uploadId: string;
  state: "processing" | "queued" | "uploading" | "ready" | "failed" | "rejected" | "reselect"; progress?: FileProgress; attachment?: RemoteAttachment; error?: string;
  /** When the upload became ready; an unsent upload older than DRAFT_UPLOAD_TTL_MS is uploaded again. */
  readyAt?: number };
/* The service keeps an unreferenced upload for 24 h; an unsent one is retired at 20 h so a send never carries a descriptor about to vanish (R4). */
export const DRAFT_UPLOAD_TTL_MS = 20 * 60 * 60_000;
export type DraftReference = { id: string; label: string; value: RemoteReference };
export type TrackedCommand = { input: RemoteCommandInput; frozen?: FrozenRemoteCommand };
export type ComposerDraft = { references: DraftReference[]; text: string; files: DraftFile[]; permissionMode: RemotePermissionMode | null; planMode: boolean; options: DraftModelChoice | null;
  consent: RemoteConsentScope | null; revision: number; dismissedPlans: string[]; creation?: DraftCreation | null; retainedText?: string | null;
  submittedPlan?: { commandId: string; planId: string; planMode: boolean } | null;
  /** Commands restored from a checkpoint that the Chat's command session must adopt and look up — never resend as new messages. */
  recovered?: readonly TrackedCommand[] };
type SubmittedDraft = Pick<ComposerDraft, "text" | "files" | "references">;
export type DraftCustody = { value: ComposerDraft; submitted: ReadonlyMap<string, SubmittedDraft>; commands: ReadonlyMap<string, TrackedCommand> };
const empty = (): ComposerDraft => ({ references: [], text: "", files: [], permissionMode: null, planMode: false, options: null, consent: null, revision: 0, dismissedPlans: [] });
const errorCode = (error: unknown) => error instanceof Error && /^attachment-[a-z]+$/.test(error.message) ? error.message : "attachment-format";
const DRAFT_KINDS = new Set(["start-turn", "steer", "retry-authentication"]);
export class RemoteDraftStore {
  private value = empty();
  private listeners = new Set<() => void>();
  private uploads = new Map<string, { controller: AbortController; promise: Promise<RemoteAttachment> }>();
  private processing = new Map<string, AbortController>();
  private queue: Promise<unknown> = Promise.resolve();
  private submitted = new Map<string, SubmittedDraft>();
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private commands: ReadonlyMap<string, TrackedCommand> = new Map();
  checkpoint: DraftCheckpointBinder | null = null;
  constructor(private readonly codec: ImageCodec = canvasImageCodec) {}
  snapshot = () => this.value;
  custody = (): DraftCustody => ({ value: this.value, submitted: this.submitted, commands: this.commands });
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
  /** Source admission reserves the slots synchronously; images then process one at a time while their tiles show progress. */
  add(files: readonly File[], sketch?: unknown, replaceId?: string) {
    const images = files.map(isImageSource);
    files.forEach((file, index) => { if (images[index]) admitImageSource(file); else assertRemoteFile(file); });
    if (this.value.files.length + files.length - (replaceId ? 1 : 0) > 8) throw new Error("attachment-count");
    const added: DraftFile[] = files.map((file, index) => ({ id: crypto.randomUUID(), file, image: images[index]!, preview: images[index] ? "" : URL.createObjectURL(file), sketch,
      uploadId: crypto.randomUUID(), state: images[index] ? "processing" : "queued" }));
    const index = replaceId ? this.value.files.findIndex(file => file.id === replaceId) : -1;
    if (replaceId && index < 0) { added.forEach(file => this.release(file)); throw new Error("attachment-changed"); }
    if (replaceId) this.release(this.value.files[index]!);
    const next = [...this.value.files]; if (index >= 0) next.splice(index, 1, ...added); else next.push(...added);
    this.update({ files: next });
    for (const file of added) if (file.state === "processing") this.process(file);
  }
  /** Removal, a Sketch replacement or reset aborts the work; a result that arrives anyway never re-enters the draft. */
  private process(entry: DraftFile) {
    const controller = new AbortController(), source = entry.file; this.processing.set(entry.id, controller);
    const run = this.queue.then(() => processImage(source, this.codec, controller.signal, REMOTE_ATTACHMENT_BYTES));
    this.queue = run.catch(() => {});
    const current = () => !controller.signal.aborted && this.value.files.some(file => file.id === entry.id && file.file === source && file.state === "processing");
    void run.then(file => { if (current()) this.file(entry.id, { file, preview: URL.createObjectURL(file), state: "queued", error: undefined }); },
      error => { if (current()) this.file(entry.id, { state: "rejected", error: errorCode(error) }); })
      .finally(() => { if (this.processing.get(entry.id) === controller) this.processing.delete(entry.id); });
  }
  private release(file: DraftFile) {
    this.uploads.get(file.id)?.controller.abort(); this.uploads.delete(file.id);
    this.processing.get(file.id)?.abort(); this.processing.delete(file.id);
    if (file.preview) URL.revokeObjectURL(file.preview);
  }
  remove(id: string) { const file = this.value.files.find(file => file.id === id); if (file) this.release(file); this.update({ files: this.value.files.filter(file => file.id !== id) }); }
  private file(id: string, patch: Partial<DraftFile>) { if (this.value.files.some(file => file.id === id)) this.update({ files: this.value.files.map(file => file.id === id ? { ...file, ...patch } : file) }); }
  private fresh = (file: DraftFile, now = Date.now()) => (file.readyAt ?? 0) + DRAFT_UPLOAD_TTL_MS > now;
  /** An expired upload keeps its fixed File and becomes a failed tile whose retry uploads it under a new identity. */
  private expire(id: string) {
    this.file(id, { state: "failed", error: "attachment-expired", attachment: undefined, readyAt: undefined, progress: undefined, uploadId: crypto.randomUUID() });
    return this.value.files.find(file => file.id === id);
  }
  /** Retires every expired unsent upload now and wakes again at the next deadline. */
  private sweep() {
    if (this.expiry) clearTimeout(this.expiry); this.expiry = null;
    const now = Date.now();
    for (const file of this.value.files) if (file.state === "ready" && !this.fresh(file, now)) this.expire(file.id);
    const next = Math.min(...this.value.files.filter(file => file.state === "ready").map(file => file.readyAt! + DRAFT_UPLOAD_TTL_MS));
    // A day-long wake-up must never keep a non-browser host (tests, the desktop mirror) alive on its own.
    if (Number.isFinite(next)) { this.expiry = setTimeout(() => this.sweep(), next - now); (this.expiry as { unref?: () => void }).unref?.(); }
  }
  /** Uploads the fixed processed File only; a retry reuses it byte for byte and never converts the source again. */
  stage(file: DraftFile, chatId: string, port: RemoteAttachmentPort, signal: AbortSignal) {
    if (file.state === "ready" && !this.fresh(file)) file = this.expire(file.id) ?? file;
    if (file.attachment?.blob.encryption.owner.id === chatId && file.state === "ready") return Promise.resolve(file.attachment);
    if (file.state === "processing" || file.state === "rejected" || file.state === "reselect") return Promise.reject(new Error("attachment-processing"));
    const previous = this.uploads.get(file.id); if (previous) return previous.promise;
    const controller = new AbortController(); this.file(file.id, { state: "uploading", error: undefined });
    const promise = port.stage({ chatId, attachmentId: file.id, uploadId: file.uploadId, file: file.file }, AbortSignal.any([signal, controller.signal]), progress => this.file(file.id, { progress }))
      .then(attachment => { this.file(file.id, { attachment, state: "ready", readyAt: Date.now() }); this.sweep(); return attachment; })
      .catch(error => { this.file(file.id, { state: "failed", error: error instanceof Error ? error.message : "attachment-unavailable" }); throw error; })
      .finally(() => { if (this.uploads.get(file.id)?.controller === controller) this.uploads.delete(file.id); });
    this.uploads.set(file.id, { controller, promise }); return promise;
  }
  /**
   * Stages every draft file, or exactly the `only` ids (a restored message's files, never its old descriptors).
   * An exact set that is not all here — removed, or never on this device — is refused rather than sent short.
   */
  async prepare(chatId: string, port: RemoteAttachmentPort | undefined, signal: AbortSignal, only?: ReadonlySet<string>) {
    const files = only ? this.value.files.filter(file => only.has(file.id)) : this.value.files;
    if (only && files.length !== only.size) throw new Error("attachment-missing");
    if (!files.length) return [];
    if (!port) throw new Error("input-unsupported");
    const values: RemoteAttachment[] = [];
    for (const file of files) values.push(await this.stage(file, chatId, port, signal));
    return values;
  }
  /** Mirrors the session's draft-bearing commands that are not yet admitted, so a checkpoint can recover them by their original commandId. */
  track(entries: readonly RemoteEntry[]) {
    const next = new Map<string, TrackedCommand>();
    for (const entry of entries) if (DRAFT_KINDS.has(entry.input.payload.kind) && awaitingRemoteAdmission(entry)) next.set(entry.input.commandId, { input: entry.input, ...(entry.frozen ? { frozen: entry.frozen } : {}) });
    // A recovered command stays saved until its session holds it; once adopted, the session entry is the one tracked.
    const waiting = (this.value.recovered ?? []).filter(pending => !entries.some(entry => entry.input.commandId === pending.input.commandId));
    for (const pending of waiting) next.set(pending.input.commandId, pending);
    const same = next.size === this.commands.size && [...next].every(([id, value]) => this.commands.get(id)?.input === value.input && this.commands.get(id)?.frozen === value.frozen);
    if (!same) this.commands = next;
    if (this.value.recovered && waiting.length !== this.value.recovered.length) this.update({ recovered: waiting.length ? waiting : undefined });
    else if (!same) this.listeners.forEach(listener => listener());
  }
  awaiting(commandId: string, text: string, attachments: readonly RemoteAttachment[] = [], references: readonly RemoteReference[] = []) {
    if (this.submitted.has(commandId)) return;
    const ids = new Set(attachments.map(file => file.attachmentId)), keys = new Set(references.map(reference => JSON.stringify(reference)));
    this.submitted.set(commandId, { text, files: this.value.files.filter(file => ids.has(file.id)),
      references: this.value.references.filter(reference => keys.has(JSON.stringify(reference.value))) });
    this.accepted(text, attachments, references, false);
  }
  confirmed(commandId: string) {
    const original = this.submitted.get(commandId); if (!original) return;
    original.files.forEach(file => this.release(file));
    this.submitted.delete(commandId); this.listeners.forEach(listener => listener());
  }
  restore(commandId: string) {
    const original = this.submitted.get(commandId); if (!original) return false;
    this.submitted.delete(commandId);
    const fileIds = new Set(this.value.files.map(file => file.id)), references = new Set(this.value.references.map(reference => JSON.stringify(reference.value)));
    this.update({ ...(this.value.text ? { retainedText: original.text || this.value.retainedText } : { text: original.text }),
      files: [...this.value.files, ...original.files.filter(file => !fileIds.has(file.id))],
      references: [...this.value.references, ...original.references.filter(reference => !references.has(JSON.stringify(reference.value)))] });
    this.sweep(); return true;
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
  /**
   * Rebuilds a checkpointed draft. Held processed bytes return as the same fixed File (a fresh uploadId unless already uploaded);
   * held sources are processed again; anything not held asks to be picked again. A draft already edited here keeps its text and gets the saved one as retained.
   */
  recover(saved: DraftCheckpoint, blobs: ReadonlyMap<string, Blob>) {
    const restore = (file: CheckpointFile): DraftFile => {
      const blob = file.kind === "reselect" ? undefined : blobs.get(blobKey(file));
      if (!blob) return { id: file.id, file: new File([], file.name, { type: file.mime }), preview: "", image: file.image, sketch: file.sketch, uploadId: file.uploadId, state: "reselect" };
      const value = new File([blob], file.name, { type: file.mime });
      if (file.kind === "source") return { id: file.id, file: value, preview: "", image: true, sketch: file.sketch, uploadId: crypto.randomUUID(), state: "processing" };
      return { id: file.id, file: value, preview: URL.createObjectURL(value), image: file.image, sketch: file.sketch, ...(file.attachment
        ? { uploadId: file.uploadId, attachment: file.attachment, state: "ready" as const, readyAt: file.readyAt } : { uploadId: crypto.randomUUID(), state: "queued" as const }) };
    };
    const current = this.value, pristine = !current.text.trim() && !current.files.length && !current.references.length && !current.creation && !current.retainedText;
    const known = new Set(current.files.map(file => file.id)), files = saved.files.filter(file => !known.has(file.id)).slice(0, Math.max(0, 8 - current.files.length)).map(restore);
    for (const draft of saved.submitted) if (!this.submitted.has(draft.commandId)) this.submitted.set(draft.commandId, { text: draft.text, references: draft.references, files: draft.files.map(restore) });
    const recovered = saved.commands.filter(command => !this.commands.has(command.input.commandId));
    this.commands = new Map([...this.commands, ...recovered.map(command => [command.input.commandId, command] as const)]);
    const references = [...current.references, ...saved.references.filter(reference => !current.references.some(item => JSON.stringify(item.value) === JSON.stringify(reference.value)))];
    this.update({ files: [...current.files, ...files], references, ...(recovered.length ? { recovered: [...current.recovered ?? [], ...recovered] } : {}),
      ...(pristine ? { text: saved.text, retainedText: saved.retainedText, permissionMode: saved.permissionMode, planMode: saved.planMode, options: saved.options as DraftModelChoice | null,
        dismissedPlans: saved.dismissedPlans, creation: saved.creation ? { ...saved.creation, recovered: true } : null }
        : saved.text.trim() && saved.text !== current.text ? { retainedText: saved.text } : {}) });
    for (const file of files) if (file.state === "processing") this.process(file);
    this.sweep();
  }
  reset() {
    this.checkpoint?.stop(); this.checkpoint = null; if (this.expiry) clearTimeout(this.expiry); this.expiry = null;
    this.value.files.forEach(file => this.release(file)); for (const draft of this.submitted.values()) draft.files.forEach(file => this.release(file));
    this.submitted.clear(); this.commands = new Map(); this.value = empty(); this.listeners.forEach(listener => listener());
  }
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
  let draft = drafts.get(key);
  if (!draft) {
    draft = new RemoteDraftStore(); if (initialText) draft.text(initialText); drafts.set(key, draft);
    if (port?.drafts && !port.lifetime?.aborted) { draft.checkpoint = new DraftCheckpointBinder(draft, port.drafts, key); void draft.checkpoint.start(); }
  }
  return draft;
}
export function handoffRemoteDraft(platform: DraftPlatform, sourceKey: string, destinationKey: string) {
  const port = platform.commands?.remote, drafts = scopes.get(port?.cacheScope ?? port ?? platform.account), draft = drafts?.get(sourceKey);
  if (draft) { drafts!.set(destinationKey, draft); drafts!.delete(sourceKey); draft.checkpoint?.rekey(destinationKey); }
}
