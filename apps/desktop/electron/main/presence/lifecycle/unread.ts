/**
 * [INPUT]: Depends on trusted renderer identity, live native visibility/focus, canonical Chat incarnation, and retained unread event consumption.
 * [OUTPUT]: Provides exact terminal presentation validation and authorized unread-consumption broadcasts.
 * [POS]: Main unread authority; title previews and hidden or stale renderers cannot consume results.
 */

import type { PresentedChat } from "../../../../shared/presence-ipc";
import { PRESENCE_CHANNEL } from "../../../../shared/presence-ipc";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";
import { rendererIdentity } from "../../window/renderer-identity";
import type { WindowRegistry } from "../../window/surfaces/window-registry";

export class UnreadConsumption {
  constructor(private readonly ports: {
    windows: WindowRegistry;
    incarnation(chatId: string): string | undefined;
    consume(receipt: PresentedChat): boolean;
    assertScope(context: TrustedRendererContext, chatId: string): void;
  }) {}
  presented(context: TrustedRendererContext, raw: unknown) {
    if (raw === null) return;
    if (!raw || typeof raw !== "object") throw new Error("PRESENTED_CHAT_INVALID");
    const value = raw as PresentedChat;
    if (![value.chatId, value.incarnationId, value.requestId].every((field) => typeof field === "string" && field.length > 0 && field.length <= 128) ||
      !Number.isSafeInteger(value.generation) || value.generation < 1 || !Number.isSafeInteger(value.terminalSeq) || value.terminalSeq < 1) throw new Error("PRESENTED_CHAT_INVALID");
    this.ports.assertScope(context, value.chatId);
    const record = this.ports.windows.fromWebContents(context.webContentsId);
    if (!record || rendererIdentity(context.webContentsId).rendererSessionId !== context.rendererIncarnation) return;
    const native = record.window;
    if (!native.isVisible?.() || native.isMinimized() || !native.isFocused?.() || native.isDestroyed()) return;
    if (this.ports.incarnation(value.chatId) !== value.incarnationId || !this.ports.consume(value)) return;
    this.ports.windows.publish(PRESENCE_CHANNEL.consumed, value);
  }
}
