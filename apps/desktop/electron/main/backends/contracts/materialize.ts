/**
 * [INPUT]: Depends on ProviderTurnInput and BackendTurnOptions structured input
 * [OUTPUT]: Provides providerInput: a turn's structured input as product-owned prompt blocks (text, base64 image, resource link for files and Skills)
 * [POS]: Pure product input projection shared by main (agent-bridge validates input with it before a turn starts) and the bridge's prompt building; it spawns nothing
 */

import { pathToFileURL } from "node:url";
import type { ProviderTurnInput } from "./turn-input";
import type { BackendTurnOptions } from "./types";

export function providerInput(
  input: BackendTurnOptions["input"]["input"]
): ProviderTurnInput[] {
  const result: ProviderTurnInput[] = [];
  for (const item of input) {
    if (item.type === "text") {
      result.push({ type: "text", text: item.text });
      continue;
    }
    if (item.type === "image") {
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(item.dataUrl);
      if (!match) throw new Error("Invalid image input data URL");
      result.push({ type: "image", mimeType: match[1], data: match[2] });
      continue;
    }
    result.push({
      type: "resource_link",
      uri: pathToFileURL(item.path).href,
      name: item.name,
      ...(item.type === "skill"
        ? { resourceKind: "skill", description: "Read and follow this SKILL.md" }
        : { description: "User-selected context file" }),
    });
  }
  return result;
}
