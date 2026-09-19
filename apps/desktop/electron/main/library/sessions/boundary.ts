/**
 * [INPUT]: Depends on saved message text, ACP replay notifications and canonical SHA-256.
 * [OUTPUT]: Provides raw transcript boundaries, actual sent-text/assistant hashes and bounded ACP replay verification.
 * [POS]: Session recovery evidence only; hints never grant permissions or bind a CLI session directly.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SessionNotification } from "@agentclientprotocol/sdk";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const sessionBoundarySchema = z.object({ userTurns: z.number().int().nonnegative(), lastTurnHash: digest });
export const sentSessionBoundarySchema = z.object({ userTurns: z.number().int().positive(), userHashes: z.array(digest).min(1).max(2), assistantHash: digest }).strict();
export const nativeSessionHintSchema = z.object({ backend: z.enum(["codex", "claude", "kimi", "opencode"]), sessionId: z.string().min(1).max(4096),
  cwdDigest: digest, headSeq: z.number().int().nonnegative(), messageId: z.string().min(1).max(128).nullable(), boundary: sessionBoundarySchema, sentBoundary: sentSessionBoundarySchema.optional() });
export type NativeSessionHint = z.infer<typeof nativeSessionHintSchema>;
export const sessionCwdDigest = (cwd: string) => hash(cwd);
export const normalizedSessionText = (value: string) => value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
export const sessionTextHash = (text: string) => hash(normalizedSessionText(text));
export function sessionAssistantHash(messages: readonly { role: string; content: string }[]) {
  let assistant = "";
  for (const message of messages) { if (message.role === "user") assistant = ""; else if (message.role === "assistant") assistant += normalizedSessionText(message.content); }
  return sessionTextHash(assistant);
}
export function sessionBoundary(messages: readonly { role: string; content: string }[]) {
  let userTurns = 0, user = "", assistant = "";
  for (const message of messages) {
    if (message.role === "user") { userTurns++; user = normalizedSessionText(message.content); assistant = ""; }
    else if (message.role === "assistant") assistant += normalizedSessionText(message.content);
  }
  return { userTurns, lastTurnHash: hash([user, assistant]) };
}
export class SessionReplayProof {
  private sessionId: string | null = null;
  private messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  private bytes = 0;
  private invalid = false;
  begin(sessionId: string) { this.sessionId = sessionId; this.messages = []; this.bytes = 0; this.invalid = false; }
  observe(notification: SessionNotification) {
    if (notification.sessionId !== this.sessionId) return false;
    const update = notification.update;
    if (update.sessionUpdate === "user_message_chunk" || update.sessionUpdate === "agent_message_chunk") {
      const role = update.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
      if (update.content.type === "text") {
        const text = update.content.text; this.bytes += Buffer.byteLength(text);
        if (this.bytes > 16 * 1024 * 1024 || this.messages.length >= 10000) { this.invalid = true; return true; }
        const previous = this.messages.at(-1);
        if (previous?.role === role) previous.content += text;
        else this.messages.push({ role, content: text });
      }
    } else if (update.sessionUpdate === "tool_call" && this.messages.at(-1)?.role === "user") this.messages.push({ role: "assistant", content: "" });
    return true;
  }
  matches(expected: z.infer<typeof sessionBoundarySchema>, sent?: z.infer<typeof sentSessionBoundarySchema>) {
    const actual = sessionBoundary(this.messages);
    if (sent) return !this.invalid && actual.userTurns === sent.userTurns && sent.userHashes.includes(sessionTextHash(this.messages.filter(message => message.role === "user").at(-1)?.content ?? "")) && sessionAssistantHash(this.messages) === sent.assistantHash;
    return !this.invalid && this.messages[0]?.role === "user" && expected.userTurns > 0 &&
      actual.userTurns === expected.userTurns && actual.lastTurnHash === expected.lastTurnHash;
  }
  end() { this.sessionId = null; this.messages = []; }
}
