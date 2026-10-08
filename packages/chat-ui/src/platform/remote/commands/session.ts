/**
 * [INPUT]: Immutable remote DTOs, account-bound command ports, scoped subscriptions, canonical content hashing and optional structural document visibility through globalThis; no ambient DOM types.
 * [OUTPUT]: awaitingRemoteAdmission / awaitingReport (ruling 12); awaitingResubmit and resubmit, the one resend under a new id of a command refused for a changed connection (TASK-20 D10); refuses a command too large to seal before it becomes an entry; provides exact retries and receipt reconciliation, including automatic read-only reconnect lookup under the original command identity, uncertain withdrawal recovery, checkpoint adoption by original commandId and terminal draft release without an execution outbox; watches the newest page plus one receipts watch per twenty unsettled commands (settled ones are never watched). Background queue owners retain receipt watches; source-scoped Stop survives checkpoints; queue controls never receive automatic new identities.
 * [POS]: Shared CommandSink consumer; confirmed receipts or strict post-lookup rejections resolve transport uncertainty.
 */
import type { FrozenRemoteCommand } from "@ai-chat/cloud-protocol/remote/encrypted";
import { assertRemoteCommandBudget } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import { REMOTE_LIMITS, remoteIntentIdentity, remoteCommandInputSchema } from "@ai-chat/cloud-protocol/remote/model";
import type { RemoteAdmissionRejection } from "@ai-chat/cloud-protocol/remote/selection";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { RemoteCommand, RemoteCommandInput, RemoteCommandPort } from "../contracts";
import type { SendPosition } from "./presentation";
/** resubmittedAs / resubmitOf link a command refused for a changed connection to its one resend (TASK-20 D10). */
export type RemoteEntry = { canonical?: boolean; withdrawnByUser?: boolean; frozen?: FrozenRemoteCommand; rejected?: RemoteAdmissionRejection; input: RemoteCommandInput; receipt: RemoteCommand | null; busy: boolean; uncertain: boolean; optimistic: boolean; owned: boolean;
  resubmittedAs?: string; resubmitOf?: string; position?: SendPosition;
  stopRequested?: boolean; cancelCommandId?: string; pauseQueue?: boolean; cancelledBeforeSend?: boolean };
/**
 * The server never admitted this command because the computer's connection changed under it, so it may go out once more under a
 * new id. Not a resend itself, and not a Full Access start, whose consent is bound to the original id.
 */
export const awaitingResubmit = (entry: RemoteEntry) => entry.owned && !entry.stopRequested && !entry.resubmittedAs && !entry.resubmitOf && !entry.canonical &&
  (entry.input.payload.kind === "start-turn" || entry.input.payload.kind === "retry-authentication") &&
  !(("queueExchange" in entry.input.payload && entry.input.payload.queueExchange) || ("queued" in entry.input.payload && entry.input.payload.queued)) &&
  entry.receipt?.state === "rejected" && entry.receipt.reason === "connection-changed" && !entry.receipt.admission &&
  !("fullAccessConsent" in entry.input.payload && entry.input.payload.fullAccessConsent);
export const awaitingRemoteAdmission = (entry: RemoteEntry) => awaitingResubmit(entry) || entry.owned && !entry.canonical && !entry.cancelledBeforeSend && !entry.rejected && !entry.receipt?.admission &&
  (entry.uncertain || !entry.receipt || !["done", "error", "cancelled", "expired", "rejected"].includes(entry.receipt.state));
/** Ruling 12: the owning computer holds the command but has not reported on it; transport doubt (no receipt yet) is not this. */
export const awaitingReport = (entry: RemoteEntry) => awaitingRemoteAdmission(entry) && !entry.uncertain && Boolean(entry.receipt) &&
  ["pending", "claimed", "outcome-unknown"].includes(entry.receipt!.state);
type RemoteCommandView = { entries: RemoteEntry[]; error: boolean; more: boolean; loading: boolean };
const terminal = new Set(["done", "cancelled", "error", "expired", "rejected"]);
export const commandInput = (receipt: RemoteCommand): RemoteCommandInput => {
  const { commandId, chatId, incarnationId, targetDeviceId, intent, payload } = receipt.command;
  return remoteCommandInputSchema.parse({ commandId, chatId, incarnationId, targetDeviceId, ...(intent ? { intent } : {}), payload });
};
export class RemoteCommandSession {
  private state: RemoteCommandView = { entries: [], error: false, more: false, loading: false };
  private listeners = new Set<() => void>();
  private follows: Array<() => void> = [];
  private followKey = "";
  private followGeneration = 0;
  private pageStop: (() => void) | null = null;
  private cursor: string | null = null;
  private generation = 0;
  private custodyGeneration = 0;
  private submissions = new Set<string>();
  private watchGeneration = 0;
  private openState = false;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryStep = 0;
  private stopFlights = new Set<string>();
  private stopVersions = new Map<string, string>();
  private retainers = 0;
  constructor(private port: RemoteCommandPort, private chatId: string) {}
  bind(port: RemoteCommandPort) { this.port = port; }
  forget() { this.custodyGeneration++; this.submissions.clear(); this.retainers = 0; this.close(); this.publish({ entries: [], error: false, more: false, loading: false }); }
  retain() { this.retainers++; this.open(); let held = true; return () => { if (held) { held = false; this.retainers = Math.max(0, this.retainers - 1); } }; }
  /** Closed, and every command it holds reached a terminal receipt: nothing unconfirmed would be lost by dropping it. */
  settled() {
    return !this.openState && this.state.entries.every(entry => (entry.cancelledBeforeSend || entry.receipt && terminal.has(entry.receipt.state)) && !entry.busy && !entry.uncertain);
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(change: Partial<RemoteCommandView>) {
    this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener();
    if (change.entries) this.follow();
    this.recoverLater();
    if (change.entries) for (const entry of this.state.entries) if (entry.stopRequested) void this.continueStop(entry.input.commandId);
  }
  private update(commandId: string, change: Partial<RemoteEntry>) {
    this.publish({ entries: this.state.entries.map(entry => entry.input.commandId === commandId ? { ...entry, ...change } : entry) });
  }
  private receive(receipt: RemoteCommand, ownInput?: RemoteCommandInput) {
    if (receipt.command.chatId !== this.chatId) throw new Error("REMOTE_RECEIPT_SCOPE");
    const input = commandInput(receipt), previous = this.state.entries.find(entry => entry.input.commandId === input.commandId);
    if (hashChatContent(remoteIntentIdentity(input)) !== hashChatContent(remoteIntentIdentity(ownInput ?? previous?.input ?? input))) throw new Error("REMOTE_RECEIPT_IDENTITY");
    if (previous?.receipt && (receipt.updatedAt < previous.receipt.updatedAt || terminal.has(previous.receipt.state) && !terminal.has(receipt.state))) return;
    const entry: RemoteEntry = { input: previous?.input ?? ownInput ?? input, receipt, canonical: previous?.canonical, frozen: previous?.frozen, withdrawnByUser: previous?.withdrawnByUser, busy: previous?.busy ?? false, uncertain: false, optimistic: previous?.optimistic ?? false, owned: previous?.owned ?? false,
      position: previous?.position, stopRequested: previous?.stopRequested, cancelCommandId: previous?.cancelCommandId, pauseQueue: previous?.pauseQueue,
      ...(previous?.resubmittedAs ? { resubmittedAs: previous.resubmittedAs } : {}), ...(previous?.resubmitOf ? { resubmitOf: previous.resubmitOf } : {}) };
    this.publish({ entries: previous ? this.state.entries.map(value => value.input.commandId === input.commandId ? entry : value) : [...this.state.entries, entry] });
  }
  /**
   * Terminal receipts never change, so only unsettled commands are watched: one receipts subscription per twenty ids,
   * rebuilt only when that set changes (C-24). Commands on the newest page are also covered by the page watch.
   */
  private follow() {
    const ids = this.openState ? this.state.entries.filter(entry => !entry.cancelledBeforeSend && !entry.rejected && !(entry.receipt && terminal.has(entry.receipt.state)))
      .map(entry => entry.input.commandId).sort() : [];
    const key = ids.join("\n");
    if (key === this.followKey) return;
    this.stopFollows(); this.followKey = key;
    const generation = this.followGeneration;
    for (let start = 0; start < ids.length; start += REMOTE_LIMITS.pageRows) {
      this.follows.push(this.port.watchReceipts(this.chatId, ids.slice(start, start + REMOTE_LIMITS.pageRows), receipts => {
        if (generation !== this.followGeneration) return;
        try { for (const receipt of receipts) this.receive(receipt); } catch { this.publish({ error: true }); }
      }, () => { if (generation === this.followGeneration) this.publish({ error: true }); }));
    }
  }
  private stopFollows() {
    this.followGeneration++; this.followKey = "";
    for (const stop of this.follows.splice(0)) stop();
  }
  open() {
    if (this.openState) return;
    this.openState = true; this.generation++; this.resubscribe();
  }
  resubscribe() {
    if (!this.openState) return;
    this.stopWatches(); const generation = this.watchGeneration;
    this.pageStop = this.port.watchPage(this.chatId, null, page => {
      if (generation !== this.watchGeneration) return;
      try {
        for (const receipt of page.items) this.receive(receipt);
        this.cursor = page.cursor; this.publish({ error: false, more: !page.complete, loading: false });
      } catch { this.publish({ error: true, loading: false }); }
    }, () => { if (generation === this.watchGeneration) this.publish({ error: true, loading: false }); });
    this.follow();
    // A reconnect can miss an older command outside the newest page. Look up its
    // original receipt once; neither an absent receipt nor uncertainty permits dispatch.
    for (const entry of this.state.entries) {
      if (entry.owned && !entry.canonical && !entry.rejected &&
          (entry.uncertain || entry.receipt?.state === "outcome-unknown")) {
        void this.check(entry.input.commandId);
      }
    }
  }
  close() {
    if (this.retainers) return;
    this.openState = false; this.generation++; this.stopWatches();
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer); this.recoveryTimer = null;
    this.publish({ entries: this.state.entries.map(entry => ({ ...entry, busy: this.submissions.has(entry.input.commandId), uncertain: entry.uncertain || entry.owned && !entry.receipt && !entry.rejected })) });
  }
  private stopWatches() {
    this.watchGeneration++; this.pageStop?.(); this.pageStop = null;
    this.stopFollows();
  }
  async more() {
    if (!this.state.more || !this.cursor || this.state.loading) return;
    const generation = this.generation, cursor = this.cursor; this.publish({ loading: true });
    try {
      const page = await this.port.page(this.chatId, cursor); if (generation !== this.generation) return;
      for (const receipt of page.items) this.receive(receipt);
      this.cursor = page.cursor; this.publish({ more: !page.complete, error: false });
    } catch { if (generation === this.generation) this.publish({ error: true }); }
    finally { if (generation === this.generation) this.publish({ loading: false }); }
  }
  async submit(raw: RemoteCommandInput, signal?: AbortSignal, position?: SendPosition) {
    if (signal?.aborted) return null;
    const input = remoteCommandInputSchema.parse(structuredClone(raw));
    if (input.chatId !== this.chatId) throw new Error("REMOTE_COMMAND_SCOPE");
    // Too large to seal is a definite refusal: it must never become an entry whose outcome is unknown.
    assertRemoteCommandBudget(input);
    const previous = this.state.entries.find(entry => entry.input.commandId === input.commandId);
    if (previous && hashChatContent(previous.input) !== hashChatContent(input)) throw new Error("REMOTE_COMMAND_CHANGED");
    if (previous?.busy) return null;
    if (!previous) this.publish({ entries: [...this.state.entries, { input, receipt: null, busy: false, uncertain: false, optimistic: input.payload.kind === "start-turn", owned: true, position }] });
    this.submissions.add(input.commandId);
    this.update(input.commandId, { busy: true });
    // Leaving a view detaches its readers, not a send the user already authorized.
    const generation = this.custodyGeneration, port = this.port;
    const valid = () => generation === this.custodyGeneration && !port.lifetime?.aborted;
    try {
      let frozen = this.state.entries.find(entry => entry.input.commandId === input.commandId)?.frozen;
      if (!frozen) { frozen = await port.prepare(input); if (!valid()) return null; this.update(input.commandId, { frozen }); }
      if (signal?.aborted) { this.update(input.commandId, { cancelledBeforeSend: true }); return null; }
      if (!previous && this.state.entries.find(entry => entry.input.commandId === input.commandId)?.stopRequested) {
        this.update(input.commandId, { cancelledBeforeSend: true }); return null;
      }
      const receipt = await port.submit(input, frozen);
      if (!valid()) return null;
      if ("rejected" in receipt) { this.update(input.commandId, { rejected: receipt.rejected, uncertain: false, optimistic: false }); return null; }
      this.receive(receipt, input); return receipt;
    } catch {
      if (valid() && !this.state.entries.find(entry => entry.input.commandId === input.commandId)?.receipt) this.update(input.commandId, { uncertain: true, rejected: undefined });
      return null;
    } finally { if (generation === this.custodyGeneration) { this.submissions.delete(input.commandId); this.update(input.commandId, { busy: false }); } }
  }
  async load(commandId: string) {
    if (this.state.entries.some(entry => entry.input.commandId === commandId)) return;
    const generation = this.generation, receipt = await this.port.get(commandId);
    if (generation === this.generation && receipt) this.receive(receipt);
  }
  /** A command recovered from a draft checkpoint re-enters as owned and uncertain, then is looked up by its original id; only an explicit retry may submit it again, with that same id. */
  adopt(command: Pick<RemoteEntry, "input" | "frozen" | "position" | "stopRequested" | "cancelCommandId" | "pauseQueue">) {
    if (command.input.chatId !== this.chatId || this.state.entries.some(entry => entry.input.commandId === command.input.commandId)) return;
    this.publish({ entries: [...this.state.entries, { ...command, receipt: null, busy: false, uncertain: true, optimistic: false, owned: true }] });
    void this.check(command.input.commandId);
  }
  /** The one resend of a command refused for a changed connection: a new id, so a fresh seal, linked both ways. */
  resubmit(commandId: string, newCommandId: string = crypto.randomUUID()) {
    const entry = this.state.entries.find(value => value.input.commandId === commandId);
    if (!entry || entry.busy || !awaitingResubmit(entry)) return Promise.resolve(null);
    const input = { ...entry.input, commandId: newCommandId };
    this.publish({ entries: [...this.state.entries.map(value => value === entry ? { ...value, resubmittedAs: newCommandId } : value),
      { input, receipt: null, busy: false, uncertain: false, optimistic: input.payload.kind === "start-turn", owned: true, resubmitOf: commandId,
        position: entry.position, stopRequested: entry.stopRequested, cancelCommandId: entry.cancelCommandId }] });
    return this.submit(input);
  }
  retry(commandId: string) {
    const entry = this.state.entries.find(value => value.input.commandId === commandId);
    return entry ? this.submit(entry.input) : Promise.resolve(null);
  }
  async withdraw(commandId: string) {
    if (!this.port.withdraw) return null;
    const entry = this.state.entries.find(value => value.input.commandId === commandId);
    if (!entry || entry.busy) return null;
    this.update(commandId, { busy: true, withdrawnByUser: true });
    const generation = this.generation;
    try {
      const receipt = await this.port.withdraw(commandId);
      if (generation !== this.generation) return null;
      this.receive(receipt); return receipt;
    } catch { if (generation === this.generation) this.update(commandId, { uncertain: true }); return null; }
    finally { if (generation === this.generation) this.update(commandId, { busy: false }); }
  }
  async check(commandId: string) {
    const entry = this.state.entries.find(value => value.input.commandId === commandId);
    if (!entry || entry.busy) return;
    this.update(commandId, { busy: true }); const generation = this.generation;
    try {
      const receipt = await this.port.get(commandId);
      if (generation !== this.generation) return;
      if (receipt) this.receive(receipt, entry.input);
      else this.update(commandId, { uncertain: true });
    } catch { if (generation === this.generation) this.update(commandId, { uncertain: true }); }
    finally { if (generation === this.generation) this.update(commandId, { busy: false }); }
  }
  /** Standard Stop retains the original request until withdrawal or turn cancellation is confirmed. */
  stop(commandId: string, pauseQueue = false) {
    const entry = this.state.entries.find(value => value.input.commandId === commandId);
    if (!entry || entry.stopRequested || entry.cancelledBeforeSend || entry.rejected || entry.receipt && terminal.has(entry.receipt.state)) return;
    this.update(commandId, { stopRequested: true, cancelCommandId: crypto.randomUUID(), pauseQueue });
  }
  private async continueStop(commandId: string) {
    const entry = this.state.entries.find(value => value.input.commandId === commandId);
    if (!this.openState || !entry?.stopRequested || entry.busy || entry.cancelledBeforeSend || entry.rejected || !entry.receipt || terminal.has(entry.receipt.state) || this.stopFlights.has(commandId)) return;
    const receipt = entry.receipt, stamp = `${receipt.state}/${receipt.updatedAt}/${Boolean(receipt.withdrawalRequested)}`;
    if (this.stopVersions.get(commandId) === stamp) return;
    this.stopVersions.set(commandId, stamp); this.stopFlights.add(commandId);
    try {
      if (receipt.state === "running" && receipt.admission && entry.cancelCommandId) {
        const previous = this.state.entries.find(value => value.input.commandId === entry.cancelCommandId);
        if (!previous) await this.submit({ commandId: entry.cancelCommandId, chatId: entry.input.chatId,
          incarnationId: entry.input.incarnationId, targetDeviceId: entry.input.targetDeviceId,
          payload: { kind: "cancel", requestId: receipt.admission.requestId, ...(entry.pauseQueue ? { pauseQueue: true } : {}) } });
      } else if (!receipt.withdrawalRequested) {
        if (!await this.withdraw(commandId)) this.stopVersions.delete(commandId);
      }
    } finally {
      this.stopFlights.delete(commandId);
      // A running receipt can arrive while withdrawal is in flight.
      const latest = this.state.entries.find(value => value.input.commandId === commandId)?.receipt;
      if (latest && `${latest.state}/${latest.updatedAt}/${Boolean(latest.withdrawalRequested)}` !== stamp) void this.continueStop(commandId);
    }
  }
  /** A missing reply only triggers reads. Recovery never submits an uncertain message again. */
  private recoverLater() {
    const needsRead = (entry: RemoteEntry) => entry.owned && !entry.cancelledBeforeSend && !entry.rejected &&
      !(entry.receipt && terminal.has(entry.receipt.state)) && (entry.uncertain || entry.receipt?.state === "outcome-unknown" || entry.stopRequested);
    if (!this.openState || !this.state.error && !this.state.entries.some(needsRead)) {
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null; this.recoveryStep = 0; return;
    }
    if (this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      const scope = globalThis as { document?: { readonly visibilityState?: string } };
      if (scope.document?.visibilityState === "hidden") { this.recoverLater(); return; }
      this.recoveryStep++;
      if (this.state.error) this.resubscribe();
      for (const entry of this.state.entries) if (needsRead(entry)) void this.check(entry.input.commandId);
      this.recoverLater();
    }, [2000, 5000, 15000, 30000][Math.min(this.recoveryStep, 3)]);
    (this.recoveryTimer as { unref?: () => void }).unref?.();
  }
  canonical = (commandIds: string[]) => {
    const ids = new Set(commandIds);
    if (this.state.entries.some(entry => !entry.canonical && ids.has(entry.input.commandId))) {
      this.publish({ entries: this.state.entries.map(entry => ids.has(entry.input.commandId) ? { ...entry, canonical: true, uncertain: false, optimistic: false } : entry) });
    }
  };
}
