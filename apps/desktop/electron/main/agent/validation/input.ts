/**
 * [INPUT]: Agent submission contracts and explicit validation dependencies.
 * [OUTPUT]: parseUserInput, assertDisplayTextConsistency, assertRichInputConsistency, assertAttachmentParity.
 * [POS]: Agent validation input boundary; admission and authority checks stay mandatory.
 */
import { AGENT_INPUT_LIMIT, ATTACHMENT_BYTE_LIMIT, ATTACHMENT_FILENAME_BYTE_LIMIT, ATTACHMENT_LIMIT, OPAQUE_REF_BYTE_LIMIT, SECTION_INPUT_LIMIT, dataUrlByteSize, isValidImageDataUrl } from "../../../../shared/ipc/agent/agent-ipc";
import { MESSAGE_BYTE_LIMIT, type ChatAttachmentPayload } from "../../../../shared/ipc/content/chats-ipc";
import { type SubmissionContentV1 } from "../../../../shared/content/submission/submission";
import { projectRichInput, richInputDisplayText, type RichInputAgentInput } from "../../../../shared/content/rich/rich-input-projection";
import { CHAT_ID_PATTERN } from "../../chats/schema/chat-schema";
import type { AgentSendPayload, AgentUserInput } from "../../../../shared/ipc/agent/agent-ipc";
import { assertExactKeys } from "./primitives";

export function parseUserInput(
  value: unknown,
  conversationId?: string
): AgentUserInput[] {
  if (!Array.isArray(value) || !value.length || value.length > AGENT_INPUT_LIMIT) {
    throw new Error(`结构化输入数量必须为 1-${AGENT_INPUT_LIMIT}`);
  }
  const parsed: AgentUserInput[] = [];
  let textBytes = 0;
  let attachmentCount = 0;
  let meaningful = false;
  let sectionCount = 0;
  for (const item of value as AgentSendPayload["input"]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("结构化输入格式无效");
    }
    if (item.type === "text") {
      assertExactKeys(item, ["type", "text"], "文本输入");
      if (typeof item.text !== "string") throw new Error("文本输入格式无效");
      textBytes += Buffer.byteLength(item.text, "utf8");
      meaningful ||= Boolean(item.text.trim());
      parsed.push({ type: "text", text: item.text });
      continue;
    }
    if (item.type === "image") {
      assertExactKeys(item, ["type", "dataUrl", "filename"], "图片输入");
      attachmentCount += 1;
      if (
        typeof item.filename !== "string" ||
        !item.filename.trim() ||
        Buffer.byteLength(item.filename, "utf8") > ATTACHMENT_FILENAME_BYTE_LIMIT
      ) {
        throw new Error("图片文件名无效");
      }
      if (typeof item.dataUrl !== "string" || !isValidImageDataUrl(item.dataUrl)) {
        throw new Error("图片输入必须是合法的 base64 data URL");
      }
      if (dataUrlByteSize(item.dataUrl) > ATTACHMENT_BYTE_LIMIT) {
        throw new Error("图片附件不能超过 8 MB");
      }
      meaningful = true;
      parsed.push({
        type: "image",
        dataUrl: item.dataUrl,
        filename: item.filename,
      });
      continue;
    }
    if (item.type === "skill") {
      assertExactKeys(item, ["type", "skillRef"], "Skill 输入");
      if (
        typeof item.skillRef !== "string" ||
        !item.skillRef.trim() ||
        Buffer.byteLength(item.skillRef, "utf8") > OPAQUE_REF_BYTE_LIMIT
      ) {
        throw new Error("Skill 引用无效");
      }
      meaningful = true;
      parsed.push({ type: "skill", skillRef: item.skillRef });
      continue;
    }
    if (item.type === "mention") {
      assertExactKeys(item, ["type", "fileRef", "name"], "文件输入");
      attachmentCount += 1;
      if (
        typeof item.fileRef !== "string" ||
        !item.fileRef.trim() ||
        Buffer.byteLength(item.fileRef, "utf8") > OPAQUE_REF_BYTE_LIMIT ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        Buffer.byteLength(item.name, "utf8") > ATTACHMENT_FILENAME_BYTE_LIMIT
      ) {
        throw new Error("文件引用无效");
      }
      meaningful = true;
      parsed.push({
        type: "mention",
        fileRef: item.fileRef,
        name: item.name,
      });
      continue;
    }
    if (item.type === "section") {
      assertExactKeys(item, ["type", "chatId", "name"], "Section 输入");
      sectionCount += 1;
      if (
        typeof item.chatId !== "string" ||
        !CHAT_ID_PATTERN.test(item.chatId) ||
        item.chatId === conversationId ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        Buffer.byteLength(item.name, "utf8") >
          ATTACHMENT_FILENAME_BYTE_LIMIT
      ) {
        throw new Error(
          item.chatId === conversationId
            ? "Section 不能引用当前聊天"
            : "Section 引用无效"
        );
      }
      meaningful = true;
      parsed.push({
        type: "section",
        chatId: item.chatId,
        name: item.name,
      });
      continue;
    }
    if (item.type === "history") {
      assertExactKeys(item, ["type", "opaqueId", "name"], "外源历史输入");
      /* 与 section 共享同一引用限额：都是「整段转录注入」级别的重负载 */
      sectionCount += 1;
      if (
        typeof item.opaqueId !== "string" ||
        !/^[a-f0-9]{40}$/.test(item.opaqueId) ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        Buffer.byteLength(item.name, "utf8") >
          ATTACHMENT_FILENAME_BYTE_LIMIT
      ) {
        throw new Error("外源历史引用无效");
      }
      meaningful = true;
      parsed.push({
        type: "history",
        opaqueId: item.opaqueId,
        name: item.name,
      });
      continue;
    }
    throw new Error("结构化输入格式无效");
  }
  if (textBytes > MESSAGE_BYTE_LIMIT) throw new Error("文本输入不能超过 32 KB");
  if (attachmentCount > ATTACHMENT_LIMIT) {
    throw new Error(`附件数量不能超过 ${ATTACHMENT_LIMIT} 个`);
  }
  if (sectionCount > SECTION_INPUT_LIMIT) {
    throw new Error(`Section 引用不能超过 ${SECTION_INPUT_LIMIT} 个`);
  }
  if (!meaningful) throw new Error("消息不能为空");
  return parsed;
}

export function assertDisplayTextConsistency(
  messageContent: string,
  ...displayTexts: string[]
) {
  const canonical = messageContent.trim();
  if (displayTexts.some((value) => value.trim() !== canonical)) {
    throw new Error("用户消息正文与展示正文不一致");
  }
}

function sameRichInputItem(
  expected: RichInputAgentInput,
  delivered: RichInputAgentInput | undefined
) {
  if (expected.type !== delivered?.type) return false;
  if (expected.type === "text") {
    return delivered.type === "text" && delivered.text === expected.text;
  }
  if (expected.type === "skill") {
    return (
      delivered.type === "skill" && delivered.skillRef === expected.skillRef
    );
  }
  if (expected.type === "section") {
    return (
      delivered.type === "section" &&
      delivered.chatId === expected.chatId &&
      delivered.name === expected.name
    );
  }
  if (expected.type === "history") {
    return (
      delivered.type === "history" &&
      delivered.opaqueId === expected.opaqueId &&
      delivered.name === expected.name
    );
  }
  return (
    delivered.type === "mention" &&
    delivered.fileRef === expected.fileRef &&
    delivered.name === expected.name
  );
}

export function assertRichInputConsistency(
  content: SubmissionContentV1,
  input: readonly AgentUserInput[]
) {
  const richValue = content.content.richValue;
  if (
    richInputDisplayText(richValue).trim() !==
    content.content.displayText.trim()
  ) {
    throw new Error("富文本展示正文与 content.displayText 不一致");
  }
  const expected = projectRichInput(richValue);
  const delivered = input.filter(
    (item): item is RichInputAgentInput => item.type !== "image"
  );
  if (
    expected.length !== delivered.length ||
    expected.some((item, index) => !sameRichInputItem(item, delivered[index]))
  ) {
    throw new Error("富文本结构化输入与 Agent input 不一致");
  }
}

export function assertAttachmentParity(
  payloads: readonly ChatAttachmentPayload[],
  files: SubmissionContentV1["content"]["files"],
  input: readonly AgentUserInput[]
) {
  const images = input.filter(
    (item): item is Extract<AgentUserInput, { type: "image" }> =>
      item.type === "image"
  );
  if (
    files.length !== payloads.length ||
    files.some((file, index) => {
      const payload = payloads[index];
      return (
        !payload ||
        (file.filename ?? "attachment") !== payload.filename ||
        file.mediaType?.toLowerCase() !== payload.mediaType.toLowerCase() ||
        (file.url !== undefined && file.url !== payload.dataUrl)
      );
    })
  ) {
    throw new Error("Submission content 文件与持久化附件不一致");
  }
  if (
    payloads.length !== images.length ||
    payloads.some(
      (payload, index) =>
        payload.filename !== images[index]?.filename ||
        payload.dataUrl !== images[index]?.dataUrl
    )
  ) {
    throw new Error("持久化附件与 Agent 图片输入不一致");
  }
}
