/**
 * [INPUT]: Depends on ACP prompt blocks and locked Claude/Codex adapter conversion contracts.
 * [OUTPUT]: Provides claudePromptReplay and codexPromptReplay (the text each adapter persists and replays for native session proofs; the bridge's turn-values table puts them on a turn's config) and promptReplayTexts (a config's replay, else text blocks only).
 * [POS]: ACP prompt evidence leaf; structured input remains unchanged on the wire. Bridge only: main never loads it.
 */
import type { ContentBlock } from "@agentclientprotocol/sdk";

export type PromptReplay = (blocks: readonly ContentBlock[]) => string[];

const mention = (uri: string, name: string) => `[@${name}](${uri})`;
const contextOf = (uri: string, text: string) => `<context ref="${uri}">\n${text}\n</context>`;

// claude-agent-acp 0.70.0 promptToClaude.
export const claudePromptReplay: PromptReplay = blocks => {
  const link = (uri: string) => uri.startsWith("file://") || uri.startsWith("zed://")
    ? mention(uri, uri.split("/").pop() || (uri.startsWith("file://") ? uri.slice(7) : uri)) : uri;
  const texts: string[] = [], context: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      const command = block.text.match(/^\/mcp:([^:\s]+):(\S+)(?:\s(.*))?$/);
      texts.push(command ? `/${command[1]}:${command[2]} (MCP)${command[3] ? ` ${command[3]}` : ""}` : block.text);
    } else if (block.type === "resource_link") texts.push(link(block.uri));
    else if (block.type === "resource" && "text" in block.resource) {
      texts.push(link(block.resource.uri));
      context.push(`\n${contextOf(block.resource.uri, block.resource.text)}`);
    }
  }
  return [...texts, ...context];
};

// codex-acp 1.6.2 buildPromptItems.
export const codexPromptReplay: PromptReplay = blocks => {
  const link = (uri: string, name?: string) =>
    name ? mention(uri, name) : uri.startsWith("file://") ? mention(uri, uri.split("/").pop() || "") : uri;
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") texts.push(block.text);
    else if (block.type === "resource_link") texts.push(link(block.uri, block.name));
    else if (block.type === "resource") {
      const resource = block.resource;
      if ("text" in resource) texts.push(`${link(resource.uri)}\n${contextOf(resource.uri, resource.text)}`);
      else if (!resource.mimeType?.startsWith("image/")) {
        texts.push(`${link(resource.uri)}\n<context ref="${resource.uri}" mimeType="${resource.mimeType ?? "application/octet-stream"}" encoding="base64">\n${resource.blob}\n</context>`);
      }
    }
  }
  return texts;
};

/** The adapter's persisted text for these blocks; a Provider without a replay persists its text blocks only. */
export const promptReplayTexts = (replay: PromptReplay | undefined, blocks: readonly ContentBlock[]): string[] =>
  replay ? replay(blocks) : blocks.flatMap(block => block.type === "text" ? [block.text] : []);
