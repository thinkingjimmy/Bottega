/**
 * [INPUT]: Team store and persistent member delivery/status ports.
 * [OUTPUT]: Byte-bounded coalesced messages, exact initial tasks, one shared delivery/inbox claim and explicit acknowledgement.
 * [POS]: Feature delivery owner; unknown results remain queryable and never auto-retry.
 */
import { randomUUID } from "node:crypto";
import { MESSAGE_BYTE_LIMIT } from "@ai-chat/cloud-protocol/chats/content/budgets";
import type { PluginMemberSession } from "@bottega/contracts/plugins/platform";
import type { PluginTeamSnapshot } from "@bottega/contracts/plugins/team";
import type { PluginTeamSessionPorts } from "./service";
import type { PluginTeamStore } from "./store";

function deliveryText(messages: PluginTeamSnapshot["messages"], consumptionId: string) {
  const text = "[Delivery " + consumptionId + "]\n" + messages.map(message => "[Message " + message.id + " from " + message.senderChatId + "]\n" + message.body).join("\n\n");
  // The ledger retains delivery identities; a full-size body must fit the canonical Chat envelope unchanged.
  return messages.length === 1 && (messages[0]!.id.startsWith("initial_") || Buffer.byteLength(text, "utf8") > MESSAGE_BYTE_LIMIT) ? messages[0]!.body : text;
}
export class PluginTeamDelivery {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly flights = new Map<string, Promise<void>>();
  private readonly dirty = new Set<string>();
  private closed = false;
  constructor(private ports: { store: PluginTeamStore; sessions: PluginTeamSessionPorts; now(): number;
    coalesceMs: number; canDeliver?(team: PluginTeamSnapshot): boolean; changed(teamId: string): void; leadSession?(team: PluginTeamSnapshot): PluginMemberSession | null }) {}
  schedule(teamId: string) {
    if (this.closed) return;
    this.dirty.add(teamId);
    if (this.timers.has(teamId) || this.flights.has(teamId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(teamId);
      void this.flush(teamId).catch(() => undefined);
    }, this.ports.coalesceMs);
    timer.unref(); this.timers.set(teamId, timer);
  }
  flush(teamId: string): Promise<void> {
    const existing = this.flights.get(teamId);
    if (existing) return existing;
    clearTimeout(this.timers.get(teamId)); this.timers.delete(teamId); this.dirty.delete(teamId);
    const flight = this.deliver(teamId);
    this.flights.set(teamId, flight);
    void flight.finally(() => {
      if (this.flights.get(teamId) !== flight) return;
      this.flights.delete(teamId);
      if (this.dirty.has(teamId)) this.schedule(teamId);
    }).catch(() => undefined);
    return flight;
  }
  private async deliver(teamId: string) {
    const snapshot = this.ports.store.get(teamId);
    if (!snapshot || snapshot.status !== "active" || this.closed || this.ports.canDeliver && !this.ports.canDeliver(snapshot)) return;
    const targets = [...new Set(snapshot.messages.filter(message => message.status === "queued" && !message.consumptionId).map(message => message.targetChatId))];
    for (const chatId of targets) {
      const team = this.ports.store.get(teamId);
      if (!team || team.status !== "active" || this.closed || this.ports.canDeliver && !this.ports.canDeliver(team)) return;
      const member = team.members.find(value => value.chatId === chatId) ??
        (chatId === team.leadChatId ? this.ports.leadSession?.(team) : null);
      if (!member || ("stoppedByUser" in member && member.stoppedByUser) || member.status === "stopped" || member.status === "stopping") continue;
      const consumptionId = randomUUID();
      const messages = await this.ports.store.update(teamId, current => {
        if (current.status !== "active") return [];
        const claimed: PluginTeamSnapshot["messages"] = [];
        for (const message of current.messages) {
          if (message.targetChatId !== chatId || message.targetIncarnation !== member.incarnation || message.status !== "queued" || message.consumptionId) continue;
          if (claimed.length === 256 || Buffer.byteLength(deliveryText([...claimed, message], consumptionId), "utf8") > MESSAGE_BYTE_LIMIT) break;
          claimed.push(message);
        }
        // Persist uncertainty before the external effect. A crash here cannot silently repeat work.
        for (const message of claimed) { message.status = "unknown"; message.consumptionId = consumptionId; }
        return structuredClone(claimed);
      });
      if (!messages.length) continue;
      this.ports.changed(teamId);
      let outcome: "inserted" | "delivered" | "queued" | "unknown" | "not-consumed" = "unknown";
      try {
        const result = await this.ports.sessions.deliver({ session: member, teamId, messageId: consumptionId,
          text: deliveryText(messages, consumptionId) });
        outcome = result.outcome;
      } catch { /* The host may have consumed a message before the response failed. */ }
      const activity = await this.ports.sessions.status({ chatId: member.chatId, incarnation: member.incarnation }).catch(() => "failed" as const);
      await this.ports.store.update(teamId, current => {
        const currentMember = current.members.find(value => value.chatId === chatId);
        if (currentMember && !currentMember.stoppedByUser) currentMember.status = activity;
        for (const claimed of messages) {
          const message = current.messages.find(value => value.id === claimed.id);
          if (!message || message.consumptionId !== consumptionId || message.status !== "unknown") continue;
          if (current.status !== "active" || current.members.find(value => value.chatId === chatId)?.stoppedByUser) { message.status = "cancelled"; continue; }
          if (outcome === "not-consumed") { message.status = "queued"; delete message.consumptionId; }
          else message.status = outcome;
        }
      });
      this.ports.changed(teamId);
      if (["inserted", "delivered", "queued"].includes(outcome) && this.ports.store.get(teamId)?.messages.some(message =>
        message.targetChatId === chatId && message.status === "queued" && !message.consumptionId)) this.schedule(teamId);
    }
  }
  async inbox(input: { teamId: string; memberChatId: string; incarnation: string }) {
    const consumptionId = randomUUID();
    const messages = await this.ports.store.update(input.teamId, team => {
      const member = team.members.find(value => value.chatId === input.memberChatId && value.incarnation === input.incarnation);
      const lead = team.leadChatId === input.memberChatId && team.leadIncarnation === input.incarnation;
      if ((!member && !lead) || team.status !== "active" || member?.stoppedByUser) throw new Error("Team inbox is not available for this session");
      const messages = team.messages.filter(value => value.targetChatId === input.memberChatId && value.targetIncarnation === input.incarnation &&
        value.status === "queued" && !value.consumptionId);
      for (const message of messages) { message.consumptionId = consumptionId; message.status = "delivered"; }
      return messages;
    });
    this.ports.changed(input.teamId);
    return { consumptionId, messages };
  }
  async acknowledge(input: { teamId: string; memberChatId: string; incarnation: string; ids: string[]; consumptionId: string }) {
    await this.ports.store.update(input.teamId, team => {
      if (!team.members.some(value => value.chatId === input.memberChatId && value.incarnation === input.incarnation) &&
        !(team.leadChatId === input.memberChatId && team.leadIncarnation === input.incarnation)) throw new Error("Team session identity differs");
      for (const id of input.ids) {
        const message = team.messages.find(value => value.id === id);
        if (!message || message.targetChatId !== input.memberChatId || message.targetIncarnation !== input.incarnation ||
          message.consumptionId !== input.consumptionId || message.status === "cancelled") throw new Error("Message consumption identity differs");
      }
      for (const message of team.messages.filter(value => input.ids.includes(value.id))) { message.status = "processed"; message.processedAt = this.ports.now(); }
    });
    this.ports.changed(input.teamId);
  }
  async close() {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.dirty.clear(); await Promise.allSettled([...this.flights.values()]);
  }
}
