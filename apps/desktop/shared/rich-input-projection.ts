/**
 * [INPUT]: Depends on zod and shared AgentUserInput
 * [OUTPUT]: Provides strict RichInput value schema, display text with RichValue→ non-image AgentUserInput canonical projection
 * [POS]: The shared rich input is a single source of truth across processes; The renderer is responsible for constructing, repositioning and verifying the actual wire before staging/injecting
 */

import { z } from "zod";
import {
  ATTACHMENT_FILENAME_BYTE_LIMIT,
  OPAQUE_REF_BYTE_LIMIT,
  type AgentUserInput,
} from "./agent-ipc";
import { MESSAGE_BYTE_LIMIT } from "./chats-ipc";

const utf8Length = (value: string) => new TextEncoder().encode(value).length;
const boundedText = (bytes: number, required = false) =>
  z
    .string()
    .max(bytes)
    .refine(
      (value) =>
        (!required || value.length > 0) && utf8Length(value) <= bytes,
      {
        message: `文本不能超过 ${bytes} 字节`,
      }
    );
const idSchema = boundedText(OPAQUE_REF_BYTE_LIMIT, true);
const textSchema = boundedText(MESSAGE_BYTE_LIMIT);
const nameSchema = boundedText(ATTACHMENT_FILENAME_BYTE_LIMIT, true);
const refSchema = boundedText(OPAQUE_REF_BYTE_LIMIT, true);
const conversationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const RICH_INPUT_NODE_LIMIT = 128;

const richInputNodeSchema = z.discriminatedUnion("type", [
  z
    .object({ id: idSchema, type: z.literal("text"), value: textSchema })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal("skill"),
      ref: refSchema,
      name: nameSchema,
      label: nameSchema,
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal("file"),
      ref: refSchema,
      name: nameSchema,
      mediaType: boundedText(128, true),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal("section"),
      chatId: conversationIdSchema,
      name: nameSchema,
      // 恢复的 Steer section 可能已不知原 backend；agent 只是展示元数据，不是权限身份。
      agent: boundedText(64),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal("history"),
      opaqueId: z.string().regex(/^[a-f0-9]{40}$/),
      name: nameSchema,
      agent: boundedText(64),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal("workspace-file"),
      path: boundedText(4_096, true),
      entryKind: z.enum(["file", "dir"]).optional(),
    })
    .strict(),
]);

export const richInputValueSchema = z
  .array(richInputNodeSchema)
  .max(RICH_INPUT_NODE_LIMIT);

type CanonicalRichInputNode = z.infer<typeof richInputNodeSchema>;
export type RichInputAgentInput = Exclude<
  AgentUserInput,
  { type: "image" }
>;

function append(output: RichInputAgentInput[], item: RichInputAgentInput) {
  const previous = output.at(-1);
  if (item.type === "text" && previous?.type === "text") {
    previous.text += item.text;
  } else {
    output.push(item);
  }
}

export function projectRichInput(
  value: readonly CanonicalRichInputNode[]
): RichInputAgentInput[] {
  const output: RichInputAgentInput[] = [];
  for (const node of value) {
    if (node.type === "text") {
      if (node.value) append(output, { type: "text", text: node.value });
    } else if (node.type === "workspace-file") {
      append(output, {
        type: "text",
        text: `@${node.path}${node.entryKind === "dir" ? "/" : ""}`,
      });
    } else if (node.type === "skill") {
      output.push({ type: "skill", skillRef: node.ref });
    } else if (node.type === "section") {
      output.push({ type: "section", chatId: node.chatId, name: node.name });
    } else if (node.type === "history") {
      output.push({ type: "history", opaqueId: node.opaqueId, name: node.name });
    } else {
      output.push({ type: "mention", fileRef: node.ref, name: node.name });
    }
  }
  return output;
}

export function richInputDisplayText(
  value: readonly CanonicalRichInputNode[]
) {
  return value
    .map((node) => {
      if (node.type === "text") return node.value;
      if (node.type === "skill") return `$${node.label}`;
      if (node.type === "section" || node.type === "history") return `@${node.name}`;
      if (node.type === "workspace-file") {
        return `@${node.path}${node.entryKind === "dir" ? "/" : ""}`;
      }
      return `[文件: ${node.name}]`;
    })
    .join("");
}
