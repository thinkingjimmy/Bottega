/**
 * [INPUT]: Depends on ACP ContentBlock and BackendTurnOptions structured input
 * [OUTPUT]: Provides resolvedInputBlocks: a turn's structured input as ACP prompt blocks (text, base64 image, resource link for files and Skills)
 * [POS]: Pure ACP projection shared by main (agent-bridge validates input with it before a turn starts) and the bridge's prompt building; it spawns nothing
 */

import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { BackendTurnOptions } from "../types";

export function resolvedInputBlocks(
  input: BackendTurnOptions["input"]["input"]
): ContentBlock[] {
  const result: ContentBlock[] = [];
  for (const item of input) {
    if (item.type === "text") {
      result.push({ type: "text", text: item.text });
      continue;
    }
    if (item.type === "image") {
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(item.dataUrl);
      if (!match) throw new Error("ACP 图片输入格式无效");
      result.push({ type: "image", mimeType: match[1], data: match[2] });
      continue;
    }
    result.push({
      type: "resource_link",
      uri: `file://${encodeURI(item.path)}`,
      name: item.name,
      ...(item.type === "skill"
        ? { description: "必须读取并遵循的 SKILL.md" }
        : { description: "用户显式引用的上下文文件" }),
    });
  }
  return result;
}
