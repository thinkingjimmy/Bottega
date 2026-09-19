/**
 * [INPUT]: Depends on portable native message bodies and shared Unicode normalization.
 * [OUTPUT]: Provides complete native search text and bounded, scalar-safe index/text partitions.
 * [POS]: Derived search projection; imported bodies and execution notices are intentionally excluded.
 */
import type { ChatBody } from "../chats/transcript/body";
import { normalizeSearchText } from "./text";
export function nativeSearchText(body: ChatBody) {
  const message = body.message;
  if (message.segment === "imported" || message.role === "notice") return "";
  const values = [message.content];
  if (message.role === "assistant") for (const part of message.parts ?? []) {
    if (part.type === "text" && part.text !== message.content) values.push(part.text);
    else if (part.type === "tool") values.push(part.title, part.tool === "image" ? "" : part.detail ?? "");
    else if (part.type === "subagent") values.push(part.name);
  }
  return normalizeSearchText(values.join("\n"));
}
export function* splitSearchText(text: string, size: number, overlap = 0): Generator<string> {
  let points: string[] = [];
  for (const point of text) {
    points.push(point);
    if (points.length === size) { yield points.join(""); points = overlap ? points.slice(-overlap) : []; }
  }
  if (points.length > overlap || (points.length && text.length < size)) yield points.join("");
}
