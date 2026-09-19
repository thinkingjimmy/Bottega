/**
 * [INPUT]: Depends on shared content validators and desktop Gallery source references.
 * [OUTPUT]: Provides native/imported/input part validators with local completed-image provenance.
 * [POS]: Desktop storage extension of the shared part grammar; provenance is never accepted by the cloud codec.
 */
import { z } from "zod";
import { createToolPartSchema, textPartSchema, subagentPartSchema,
  type ChatToolPart as PortableToolPart } from "@ai-chat/cloud-protocol/chats/content/parts";
import { MESSAGE_BYTE_LIMIT, TOOL_DETAIL_BYTE_LIMIT, IMPORTED_TOOL_DETAIL_BYTE_LIMIT,
  PART_TITLE_CHAR_LIMIT } from "@ai-chat/cloud-protocol/chats/content/budgets";
import type { ChatToolPart } from "../../../shared/chats-ipc";
import { transcriptGallerySourceRefSchema } from "../../../shared/gallery-media-ipc";
export { PART_TITLE_CHAR_LIMIT } from "@ai-chat/cloud-protocol/chats/content/budgets";
export { utf8Length, messageBytes, overNativeDetail } from "@ai-chat/cloud-protocol/chats/content/parts";

type MissingToolKind = Exclude<ChatToolPart["tool"], PortableToolPart["tool"]>;
const _toolKindsExhaustive: MissingToolKind extends never ? true : never = true;
void _toolKindsExhaustive;

function partsWithLimit(detailLimit: number, titleLimit: number) {
  const tool = createToolPartSchema(detailLimit, titleLimit)
    .extend({ mediaSource: transcriptGallerySourceRefSchema.optional() })
    .superRefine((part, context) => {
      if (part.mediaSource && (part.tool !== "image" || part.status !== "completed")) {
        context.addIssue({ code: "custom", path: ["mediaSource"],
          message: "mediaSource is valid only for a completed image part" });
      }
    });
  return z.discriminatedUnion("type", [tool, textPartSchema, subagentPartSchema]);
}
export const chatPartSchema = partsWithLimit(TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT);
export const importedPartSchema = partsWithLimit(IMPORTED_TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT);
export const chatPartInputSchema = partsWithLimit(MESSAGE_BYTE_LIMIT, 100_000);
