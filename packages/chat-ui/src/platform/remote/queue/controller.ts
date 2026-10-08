/**
 * [INPUT]: Account-bound command/draft custody, complete queue metadata and fresh execution facts.
 * [OUTPUT]: One queue controller for local, cloud-waiting and admitted messages, durable edits and Steer, ordering and source pause.
 * [POS]: Shared remote queue authority; the UI renders its state and the account lifetime owns its effects.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { AcceptedQueue, AwaitingQueue } from "@ai-chat/cloud-protocol/remote/queue";
import type { RemoteConsentScope } from "@ai-chat/cloud-protocol/remote/input/model";
import type { ChatPlatform } from "../../contracts";
import type { RemoteCommandInput, RemoteCommandPort } from "../contracts";
import { awaitingRemoteAdmission, type RemoteCommandSession } from "../commands/session";
import { awaitRemoteResult } from "../commands/result";
import { emptyLocalQueue, nextLocalStep, type FrozenSendSettings } from "../input/local-queue";
import type { QueueOperation, RemoteDraftStore, SubmittedDraft } from "../input/draft";
import { awaitQueueAdmission } from "./settle";
import { queueStart, queueTarget } from "./requests";

export type QueueRow = { intentId: string; sourceDeviceId: string | null; commandId?: string; kind: "local" | "accepted" | "awaiting" | "pending"; locked?: boolean };
type View = { settings: FrozenSendSettings; disabled: boolean; steerRequest: string | null;
  confirm(scope: RemoteConsentScope): Promise<RemoteConsentScope | null>; focus(): void };
const refused = new Set(["rejected", "expired", "cancelled", "error"]);
const code = (error: unknown) => error instanceof Error && error.message.length <= 256 ? error.message : "input-unsupported";
export class RemoteQueueController {
  private state: { waiting: AwaitingQueue | null; busy: boolean; error: string | null; revision: number } = { waiting: null, busy: false, error: null, revision: 0 };
  private listeners = new Set<() => void>();
  private stops: Array<() => void> = [];
  private view: View | null = null;
  private scheduled = false;
  private started = false;
  private closed = false;
  private gesture = false;
  private draining = false;
  private observedFailures = new Set<string>();
  private adopting = new Set<string>();
  private queueStop = () => {};
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryStep = 0;
  constructor(readonly platform: ChatPlatform, public head: CloudChatHead, readonly store: RemoteDraftStore,
    readonly session: RemoteCommandSession, readonly port: RemoteCommandPort) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<typeof this.state> = {}) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }; this.listeners.forEach(listener => listener());
  }
  configure(head: CloudChatHead, view: View) {
    const changed = head !== this.head || view.disabled !== this.view?.disabled || view.steerRequest !== this.view?.steerRequest;
    this.head = head; this.view = view; if (changed) this.schedule();
  }
  detach() { this.view = null; this.gesture = false; this.store.lockQueue(this.state.busy); this.schedule(); }
  start() {
    if (this.started || this.closed) return;
    this.started = true;
    this.stops.push(this.session.retain(), this.session.subscribe(this.schedule), this.store.subscribe(this.schedule));
    const identity = this.platform.account.snapshot();
    this.stops.push(this.platform.account.subscribe(() => {
      const current = this.platform.account.snapshot();
      if (current.profile?.userId !== identity.profile?.userId || current.deviceId !== identity.deviceId) this.close();
    }));
    this.port.lifetime?.addEventListener("abort", this.close, { once: true });
    if (typeof window !== "undefined") { window.addEventListener("online", this.connect); window.addEventListener("pageshow", this.connect); }
    this.connect(); this.schedule();
  }
  private connect = () => {
    if (this.closed) return;
    clearTimeout(this.retry); this.queueStop();
    this.queueStop = this.port.queue?.watch(this.head.chat.id, waiting => {
      this.retryStep = 0; this.publish({ waiting }); this.schedule();
    }, () => {
      this.retry = setTimeout(this.connect, [2000, 5000, 15000, 30000][Math.min(this.retryStep++, 3)]);
    }) ?? (() => {});
  };
  close = () => {
    if (this.closed) return;
    this.closed = true; this.suspend();
  };
  private suspend() {
    this.started = false; clearTimeout(this.retry); this.queueStop(); this.stops.splice(0).forEach(stop => stop());
    this.port.lifetime?.removeEventListener("abort", this.close);
    if (typeof window !== "undefined") { window.removeEventListener("online", this.connect); window.removeEventListener("pageshow", this.connect); }
    if (!this.view) this.session.close();
  }
  private schedule = () => {
    if (this.scheduled || this.closed || !this.started) return;
    this.scheduled = true; queueMicrotask(() => { this.scheduled = false; if (!this.closed) this.tick(); });
  };
  get source() { return this.platform.account.snapshot().deviceId; }
  get accepted() { const value = this.state.waiting?.accepted ?? this.head.queue; return value?.deviceId === this.head.ownerDeviceId ? value : null; }
  rows(): QueueRow[] {
    const accepted = this.accepted?.items ?? [], known = new Set(accepted.map(item => item.intentId));
    const rows: QueueRow[] = [...accepted.map(item => ({ ...item, kind: "accepted" as const })),
      ...(this.state.waiting?.items ?? []).filter(item => !known.has(item.intentId)).map(item => ({ ...item, kind: "awaiting" as const })),
      ...(this.store.snapshot().local?.items ?? []).map(item => ({ intentId: item.commandId, sourceDeviceId: this.source, kind: "local" as const }))];
    for (const operation of this.store.snapshot().queueOperations ?? []) if (operation.originalId && !rows.some(row => row.intentId === operation.originalId))
      rows.push({ intentId: operation.originalId, sourceDeviceId: this.source, kind: "pending", locked: true });
    return rows;
  }
  private entry(id: string) {
    const commandId = this.accepted?.items.find(row => row.intentId === id)?.commandId ?? id;
    return this.session.snapshot().entries.find(entry => entry.input.commandId === commandId);
  }
  own(row: QueueRow) { return Boolean(this.source && row.sourceDeviceId === this.source && (row.kind === "local" || this.entry(row.intentId)?.receipt?.command.sourceDeviceId === this.source)); }
  draft(id: string): SubmittedDraft | undefined {
    const saved = this.store.submittedDraft(id); if (saved) return saved;
    const entry = this.entry(id), payload = entry?.input.payload;
    if (!payload || !("text" in payload) || entry?.receipt?.command.sourceDeviceId !== this.source) return;
    const value: SubmittedDraft = { text: payload.text, references: ("references" in payload ? payload.references ?? [] : []).map(value => ({ id: crypto.randomUUID(), label: value.kind, value })),
      files: ("attachments" in payload ? payload.attachments ?? [] : []).map(file => ({ id: file.attachmentId, file: new File([], file.filename, { type: file.blob.mime }),
        image: file.kind === "image", preview: "", uploadId: crypto.randomUUID(), attachment: file, state: "reselect" })),
      planMode: "planMode" in payload ? payload.planMode : false,
      settings: { backend: "agentSelection" in payload ? payload.agentSelection?.backend ?? entry.input.intent?.baselineAgent ?? this.head.chat.agent : this.head.chat.agent,
        permissionMode: "permissionMode" in payload ? payload.permissionMode ?? "approve-for-me" : "approve-for-me", ...("options" in payload ? { options: payload.options } : {}) } };
    return value;
  }
  canEdit(row: QueueRow) {
    const entry = this.entry(row.intentId);
    return this.own(row) && !row.locked && row.kind !== "pending" && !entry?.canonical && (Boolean(row.commandId) || !refused.has(entry?.receipt?.state ?? "") &&
      !["running", "done", "outcome-unknown"].includes(entry?.receipt?.state ?? "")) && !this.store.queueOwns(row.intentId) && Boolean(this.draft(row.intentId));
  }
  canSteer(row: QueueRow) { return Boolean(this.view?.steerRequest && this.canEdit(row) && this.draft(row.intentId)?.files.every(file => file.state === "ready" && file.attachment && file.file.size)); }
  get steerSupported() { return Boolean(this.view?.steerRequest); }
  get paused() { return Boolean(this.store.snapshot().local?.paused || this.source && this.accepted?.pausedSources?.includes(this.source)); }
  lock = (locked: boolean) => { this.gesture = locked; this.store.lockQueue(locked || this.state.busy); };
  dismiss = () => this.publish({ error: null });
  private tick() {
    const entries = this.session.snapshot().entries;
    for (const command of this.store.snapshot().recovered ?? []) this.session.adopt(command);
    for (const operation of this.store.snapshot().queueOperations ?? []) {
      const id = operation.input.commandId, entry = this.entry(id);
      if (!entry && !this.adopting.has(id) && !this.state.busy && !this.draining) { this.adopting.add(id); this.session.adopt({ input: operation.input }); continue; }
      if (!entry) continue;
      const receipt = entry.receipt;
      const success = operation.input.payload.kind === "start-turn" ? Boolean(receipt?.admission) : receipt?.state === "done";
      if (!success && !entry.rejected && !entry.cancelledBeforeSend && !refused.has(receipt?.state ?? "")) continue;
      const taken = operation.originalId && this.entry(operation.originalId)?.receipt?.output?.kind === "queue-withdrawal";
      if (success && operation.kind === "steer" && operation.originalId && receipt?.output?.kind === "steer" && receipt.output.outcome === "transferred" && receipt.output.intentId)
        this.store.transfer(operation.originalId, receipt.output.intentId, id);
      this.store.finishQueueOperation(operation, success, Boolean(taken));
      if (success && operation.input.payload.kind === "set-queue-paused" && !operation.input.payload.paused) this.store.resumeLocal();
      if (!success) { this.store.pauseLocal(receipt?.reason ?? entry.rejected ?? "admission-failed"); this.publish({ error: receipt?.reason ?? entry.rejected ?? "admission-failed" }); }
      if (success && operation.kind === "edit") this.view?.focus();
      void this.store.checkpoint?.flush();
    }
    this.store.track(entries);
    for (const entry of entries) {
      if (entry.canonical) this.store.confirmAliases(entry.input.commandId);
      if (this.store.queueOwns(entry.input.commandId)) continue;
      if (entry.owned && entry.receipt?.command.sourceDeviceId === this.source && entry.receipt.state === "error" && !this.observedFailures.has(entry.input.commandId)) {
        this.observedFailures.add(entry.input.commandId); this.store.pauseLocal(entry.receipt.reason ?? "execution-failed");
      }
    }
    for (const row of this.rows()) if (row.kind !== "local" && row.sourceDeviceId && !this.entry(row.intentId)) void this.session.load(row.commandId ?? row.intentId).catch(() => {});
    this.publish();
    const local = this.store.snapshot().local, empty = !this.rows().some(row => row.sourceDeviceId === this.source) && !local?.gate &&
      !entries.some(entry => entry.owned && (awaitingRemoteAdmission(entry) || entry.stopRequested && !entry.cancelledBeforeSend && !entry.rejected && !entry.canonical && !refused.has(entry.receipt?.state ?? "") && entry.receipt?.state !== "done")) && !this.store.snapshot().queueOperations?.length;
    if (empty && !this.state.busy && !this.draining) {
      if (local?.paused) this.store.resumeLocal();
      if (this.source && this.accepted?.pausedSources?.includes(this.source)) { void this.run(() => this.pauseRemote(false)); return; }
    }
    if (!this.view && empty && !this.state.busy && !this.draining && !entries.some(entry =>
      (entry.owned || entry.receipt?.command.sourceDeviceId === this.source && this.store.submittedDraft(entry.input.commandId)) &&
      !entry.cancelledBeforeSend && !entry.rejected && !["done", "error", "cancelled", "expired", "rejected"].includes(entry.receipt?.state ?? ""))) {
      this.suspend(); return;
    }
    if (!this.state.busy && !this.gesture && !this.draining && !this.store.snapshot().queueOperations?.length) void this.drain();
  }
  private input(payload: RemoteCommandInput["payload"], commandId = crypto.randomUUID()): RemoteCommandInput {
    if (!this.head.ownerDeviceId) throw new Error("not-owner");
    return { commandId, chatId: this.head.chat.id, incarnationId: this.head.chat.incarnationId, targetDeviceId: this.head.ownerDeviceId, payload };
  }
  private async execute(input: RemoteCommandInput, kind: QueueOperation["kind"] = "control", originalId?: string, replacement?: SubmittedDraft) {
    const operation = this.store.beginQueueOperation({ input, kind, originalId }, replacement);
    try { await this.store.checkpoint?.flushStrict(); }
    catch (error) { this.store.finishQueueOperation(operation, false); throw error; }
    try {
      const result = await awaitRemoteResult(this.session, input, this.port.lifetime, 65_000, input.payload.kind === "start-turn");
      this.tick();
      if (result.state !== "done" && !(input.payload.kind === "start-turn" && result.admission)) throw new Error(result.reason ?? "queue-changed");
    } catch (error) {
      // Parsing and byte-budget refusal happen before session custody or any transport effect.
      if (!this.session.snapshot().entries.some(entry => entry.input.commandId === input.commandId)) this.store.finishQueueOperation(operation, false);
      this.tick(); throw error;
    }
  }
  private run = async (effect: () => Promise<void>) => {
    if (this.state.busy || this.view?.disabled || this.store.snapshot().queueOperations?.length) return false;
    this.publish({ busy: true, error: null }); this.store.lockQueue(true);
    try { await effect(); await this.store.checkpoint?.flushStrict(); return true; }
    catch (error) { this.publish({ error: code(error) }); this.connect(); this.session.resubscribe(); return false; }
    finally { this.publish({ busy: false }); this.store.lockQueue(this.gesture); this.schedule(); }
  };
  private async admitted(): Promise<AcceptedQueue> {
    const accepted = this.accepted ?? await this.published(() => true);
    if (!this.head.ownerDeviceId) throw new Error("queue-changed");
    if (!this.state.waiting?.items.some(row => !accepted.items.some(item => item.intentId === row.intentId))) return accepted;
    return awaitQueueAdmission(this.port, this.head.chat.id, { ...this.state.waiting, accepted }, { deviceId: this.head.ownerDeviceId }, this.port.lifetime);
  }
  private published(matches: (value: AcceptedQueue) => boolean): Promise<AcceptedQueue> {
    return new Promise((resolve, reject) => {
      let settled = false, stop = () => {};
      const done = (value?: AcceptedQueue, error?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); stop(); this.port.lifetime?.removeEventListener("abort", abort); if (value) resolve(value); else reject(error); };
      const abort = () => done(undefined, new Error("identity-changed"));
      const timer = setTimeout(() => done(undefined, new Error("queue-changed")), 60_000);
      this.port.lifetime?.addEventListener("abort", abort, { once: true });
      if (!this.port.queue || this.port.lifetime?.aborted) { abort(); return; }
      stop = this.port.queue.watch(this.head.chat.id, value => {
        if (value.accepted?.deviceId === this.head.ownerDeviceId && matches(value.accepted)) { this.publish({ waiting: value }); done(value.accepted); }
      }, error => done(undefined, error));
      if (settled) stop();
    });
  }
  edit = (id: string) => this.run(async () => {
    await this.store.checkpoint?.start();
    const row = this.rows().find(row => row.intentId === id);
    if (!row || !this.canEdit(row) || !this.view) throw new Error("already-dispatched");
    this.store.retain(id, this.draft(id)!);
    if (row.kind === "local") { this.store.editLocal(id, this.view.settings); this.view.focus(); return; }
    const version = this.store.draftVersion(), replacement = this.store.capture(this.view.settings);
    const queue = await this.admitted(), commandId = crypto.randomUUID();
    const populated = Boolean(replacement.text || replacement.files.length || replacement.references.length);
    const reference = { intentId: id, expectedRevision: queue.revision };
    const input = populated ? await queueStart(this.platform, this.head, this.store, commandId, replacement, reference, this.view.confirm)
      : this.input({ kind: "take-queued", ...reference }, commandId);
    // Consent and target refresh are asynchronous. Freeze only the exact draft they validated.
    if (version !== this.store.draftVersion()) throw new Error("queue-changed");
    await this.execute(input, "edit", id, populated ? replacement : undefined);
  });
  steer = (id: string) => this.run(async () => {
    await this.store.checkpoint?.start();
    const row = this.rows().find(row => row.intentId === id), requestId = this.view?.steerRequest;
    if (!row || !requestId || !this.canSteer(row)) throw new Error("request-not-active");
    const value = this.draft(id)!;
    this.store.retain(id, value);
    const queue = row.kind === "local" ? null : await this.admitted();
    if (requestId !== this.view?.steerRequest) throw new Error("request-not-active");
    await queueTarget(this.platform, this.head);
    await this.execute(this.input({ kind: "steer", requestId, text: value.text, attachments: value.files.map(file => file.attachment!), references: value.references.map(item => item.value),
      ...(queue ? { queued: { intentId: id, expectedRevision: queue.revision } } : {}) }), "steer", id);
  });
  remove = (id: string) => this.run(async () => {
    const row = this.rows().find(row => row.intentId === id); if (!row) throw new Error("queue-changed");
    if (row.kind === "local") { this.store.removeLocal(id); return; }
    if (row.locked || row.kind === "pending") throw new Error("already-dispatched");
    const queue = await this.admitted();
    await this.execute(this.input({ kind: "withdraw-queued", intentId: id, expectedRevision: queue.revision }), "remove", id);
  });
  private async pauseRemote(paused: boolean) {
    const queue = this.accepted ?? await this.published(() => true);
    await this.execute(this.input({ kind: "set-queue-paused", paused, expectedRevision: queue.revision }));
    await this.published(value => Boolean(this.source && value.pausedSources?.includes(this.source)) === paused);
  }
  resume = () => this.run(async () => {
    await this.store.checkpoint?.start();
    await queueTarget(this.platform, this.head);
    for (const row of this.rows().filter(row => row.sourceDeviceId === this.source)) {
      if (row.kind !== "local" && !this.entry(row.intentId)) await this.session.load(row.commandId ?? row.intentId);
      if (!this.own(row)) throw new Error("queue-changed");
      const draft = this.draft(row.intentId); if (draft) this.store.retain(row.intentId, draft);
      const value = await this.store.prepareSubmitted(row.intentId, this.head.chat.id, this.port.attachments, this.port.lifetime ?? new AbortController().signal);
      await queueStart(this.platform, this.head, this.store, row.intentId, value, undefined, this.view?.confirm);
    }
    if (this.source && this.accepted?.pausedSources?.includes(this.source)) await this.pauseRemote(false);
    this.store.resumeLocal();
  });
  stop = (foregroundId: string | null, requestId: string | null) => {
    this.store.pauseLocal("cancelled");
    // Queue pause remains valid if the turn finishes while Stop is in flight.
    const remoteWaiting = this.rows().some(row => row.kind !== "local" && row.sourceDeviceId === this.source);
    if (foregroundId && (!remoteWaiting || this.state.busy || this.store.snapshot().queueOperations?.length)) this.session.stop(foregroundId, true);
    else if (foregroundId) void this.run(async () => { await this.pauseRemote(true); this.session.stop(foregroundId, true); });
    else if (requestId) void this.run(async () => { if (remoteWaiting) await this.pauseRemote(true); await this.execute(this.input({ kind: "cancel", requestId, pauseQueue: true })); });
    else void this.run(() => this.pauseRemote(true));
  };
  move = (visibleIds: readonly string[], from: number, to: number) => this.run(async () => {
    const rows = this.rows(), id = visibleIds[from], destination = visibleIds[to];
    if (!id || !destination || from === to) return;
    const visible = [...visibleIds]; visible.splice(to, 0, visible.splice(from, 1)[0]!);
    let index = 0; const order = rows.map(row => visible.includes(row.intentId) ? visible[index++]! : row.intentId);
    const start = rows.find(row => row.intentId === id), end = rows.find(row => row.intentId === destination);
    if (!start || !end || start.locked || end.locked) throw new Error("already-dispatched");
    if (start.kind === "local" && end.kind === "local") { this.store.reorderLocal(order.filter(id => rows.some(row => row.intentId === id && row.kind === "local"))); return; }
    const local = this.store.snapshot().local?.items ?? [], crossing = start.kind === "local" || end.kind === "local", wasPaused = this.paused;
    if (crossing) {
      this.store.pauseLocal("queue-changed"); await this.pauseRemote(true);
      for (const item of local) {
        const value = await this.store.prepareSubmitted(item.commandId, this.head.chat.id, this.port.attachments, this.port.lifetime ?? new AbortController().signal);
        const input = await queueStart(this.platform, this.head, this.store, item.commandId, value, undefined, this.view?.confirm);
        await this.execute(input, "admit", item.commandId);
      }
    }
    const ids = order.filter(id => crossing || !local.some(item => item.commandId === id));
    const queue = crossing ? await this.published(value => value.items.length === ids.length && value.items.every(row => ids.includes(row.intentId))) : await this.admitted();
    if (queue.items.length !== ids.length || queue.items.some(row => !ids.includes(row.intentId))) throw new Error("queue-changed");
    await this.execute(this.input({ kind: "reorder-queue", expectedRevision: queue.revision, intentIds: ids }));
    if (crossing && !wasPaused) { await this.published(value => value.revision !== queue.revision); await this.pauseRemote(false); }
  });
  private async drain() {
    const local = this.store.snapshot().local ?? emptyLocalQueue;
    if (this.paused || this.store.snapshot().queueLocked || this.view?.disabled || this.platform.account.snapshot().state !== "ready") return;
    const step = nextLocalStep(local, { waiting: this.session.snapshot().entries.some(awaitingRemoteAdmission), busy: false, ready: true,
      incarnationId: this.head.chat.incarnationId, ownerDeviceId: this.head.ownerDeviceId });
    if (!step) return;
    if (step.kind === "pause") { this.store.pauseLocal(step.reason); return; }
    this.draining = true;
    try {
      const item = step.item, value = await this.store.prepareSubmitted(item.commandId, this.head.chat.id, this.port.attachments, this.port.lifetime ?? new AbortController().signal);
      const input = await queueStart(this.platform, this.head, this.store, item.commandId, value, undefined, this.view?.confirm);
      if (this.state.busy || this.gesture || this.store.snapshot().queueLocked || this.paused || this.closed) return;
      this.store.beginLocal(item.commandId);
      await this.execute(input, "admit", item.commandId);
      this.store.track(this.session.snapshot().entries);
    } catch (error) { this.store.pauseLocal(code(error)); this.publish({ error: code(error) }); }
    finally { this.draining = false; }
  }
}
