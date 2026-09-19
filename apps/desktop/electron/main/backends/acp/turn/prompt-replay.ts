/**
 * [INPUT]: Depends on ACP prompt blocks and locked Claude/Codex adapter conversion contracts.
 * [OUTPUT]: Provides the text representation those adapters persist and replay for native session proofs.
 * [POS]: ACP prompt evidence leaf; structured input remains unchanged on the wire.
 */
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { BackendTurnOptions } from "../../types";

// claude-agent-acp 0.70.0 promptToClaude; codex-acp 1.6.2 buildPromptItems.
export function promptReplayTexts(backend: BackendTurnOptions["payload"]["turnOptions"]["backend"], blocks: readonly ContentBlock[]): string[] {
  if (backend !== "claude" && backend !== "codex") return blocks.flatMap(block => block.type === "text" ? [block.text] : []);
  const texts: string[] = [], context: string[] = [];
  const link = (uri: string, name?: string) => {
    if (backend === "codex" && name) return `[@${name}](${uri})`;
    if (uri.startsWith("file://") || backend === "claude" && uri.startsWith("zed://")) {
      const basename = uri.split("/").pop() || (backend === "claude" ? uri.startsWith("file://") ? uri.slice(7) : uri : "");
      return `[@${basename}](${uri})`;
    }
    return uri;
  };
  for (const block of blocks) {
    if (block.type === "text") {
      const command = backend === "claude" && block.text.match(/^\/mcp:([^:\s]+):(\S+)(?:\s(.*))?$/);
      texts.push(command ? `/${command[1]}:${command[2]} (MCP)${command[3] ? ` ${command[3]}` : ""}` : block.text);
    } else if (block.type === "resource_link") texts.push(link(block.uri, block.name));
    else if (block.type === "resource") {
      const resource = block.resource;
      if ("text" in resource) {
        const value = `<context ref="${resource.uri}">\n${resource.text}\n</context>`;
        if (backend === "claude") { texts.push(link(resource.uri)); context.push(`\n${value}`); }
        else texts.push(`${link(resource.uri)}\n${value}`);
      } else if (backend === "codex" && !resource.mimeType?.startsWith("image/")) {
        texts.push(`${link(resource.uri)}\n<context ref="${resource.uri}" mimeType="${resource.mimeType ?? "application/octet-stream"}" encoding="base64">\n${resource.blob}\n</context>`);
      }
    }
  }
  return [...texts, ...context];
}
