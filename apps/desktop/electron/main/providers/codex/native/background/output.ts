/**
 * [INPUT]: Uses retained owner snapshots and request-scoped command identity.
 * [OUTPUT]: Projects original-command DTOs and appends item-scoped output under one UTF-8 owner byte budget.
 * [POS]: Lazy background projection loaded before staging; keeps inactive execution transforms out of main startup.
 */
import type { NativeBackgroundCommand } from "../../../../../../shared/ipc/agent/background-ipc";
import type { BackgroundEntry } from "./registry";
import { nativeCommandItemId } from "../mapping/identity";
export const commandItemId = nativeCommandItemId;
const TRUNCATED = "[Output truncated]\n";
const tail = (value: string, limit: number) => {
  const bytes = Buffer.from(value);
  if (bytes.length <= limit) return value;
  const marker = TRUNCATED.slice(0, limit);
  let offset = bytes.length - Math.max(0, limit - marker.length);
  while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset++;
  return marker + bytes.subarray(offset).toString("utf8");
};

export function listCommands(entries: Iterable<BackgroundEntry>, chatId: string): NativeBackgroundCommand[] {
  return [...entries].filter(e => e.active && e.chatId === chatId).flatMap(e => e.terminals.filter(terminal => !e.persisted.has(terminal.itemId)).map(terminal => ({
    id: e.key, itemId: nativeCommandItemId(e.requestId, terminal.itemId), chatId, incarnationId: e.incarnationId,
    command: terminal.command.slice(0, 8192), cwd: terminal.cwd,
    permissionMode: e.permissionMode, status: e.status, output: tail(e.output.get(terminal.itemId) ?? "", 8192),
  })));
}

export function appendOutput(entry: BackgroundEntry, output: { itemId: string; delta: string }) {
  if (!entry.terminals.some(t => t.itemId === output.itemId) || Buffer.byteLength(output.delta) > 65_536) throw new Error("Background output has no owned command item");
  entry.output.set(output.itemId, tail((entry.output.get(output.itemId) ?? "") + output.delta, 65_536));
  let excess = [...entry.output.values()].reduce((sum, value) => sum + Buffer.byteLength(value), 0) - 65_536;
  for (const [itemId, value] of entry.output) {
    if (excess <= 0) break;
    const bounded = tail(value, Math.max(TRUNCATED.length, Buffer.byteLength(value) - excess));
    entry.output.set(itemId, bounded); excess -= Buffer.byteLength(value) - Buffer.byteLength(bounded);
  }
}
