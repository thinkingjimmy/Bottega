/**
 * [INPUT]: Depends on chat-composer-store readComposer/updateComposer, the preload authorizeFile/releaseFile bridge and locale translation
 * [OUTPUT]: Provides renewComposerFileGrants / renewMessageFileGrants (fresh grants for a send's file nodes)
 * [POS]: lib/chat-composer's F-33 grant boundary; main grants expire after 30 minutes, so every send re-grants from the File the composer retained instead of trusting an old ref, updating the resource and the submission but never the live draft (E3-02); loaded lazily by create-session-submit
 */

import type { PromptInputMessage, RichValue } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { translate } from "../../../shared/i18n/runtime";
import { readComposer, updateComposer, type FileNode } from "../chat/state/composer/chat-composer-store";
import { effectiveLocale } from "../appearance/i18n-locale";

const unavailable = (name: string) =>
  new Error(translate(effectiveLocale(), "chat.runtime.attachment.grantUnavailable", { name }));

/**
 * All-or-nothing: if any retained file can't be granted again, the grants issued so far are released and the
 * store is untouched. A node without a retained File (migrated from another window) keeps its ref; main
 * decides whether that ref is still valid.
 */
export async function renewComposerFileGrants(chatId: string, value: RichValue): Promise<RichValue> {
  const app = window.app;
  const resources = readComposer(chatId).fileResources;
  const renewals = value.flatMap((node) => {
    if (node.type !== "file") return [];
    const resource = resources.get(node.id);
    return resource?.file && resource.scope ? [{ node, resource, file: resource.file, scope: resource.scope }] : [];
  });
  if (!app || renewals.length === 0) return value;
  const settled = await Promise.allSettled(renewals.map((item) => app.authorizeFile(item.file, item.scope)));
  const issued = settled.flatMap((result) => result.status === "fulfilled" ? [result.value.fileRef] : []);
  const failed = settled.findIndex((result) => result.status === "rejected");
  if (failed >= 0) {
    issued.forEach((ref) => void app.releaseFile(ref));
    throw unavailable(renewals[failed]!.node.name);
  }
  const fresh = new Map<string, string>();
  const stale: string[] = [];
  updateComposer(chatId, (current) => {
    const fileResources = new Map(current.fileResources);
    renewals.forEach((item, index) => {
      const fileRef = issued[index]!;
      // The chip was removed or replaced while main granted it; the new grant has no owner.
      if (fileResources.get(item.node.id) !== item.resource) { stale.push(fileRef); return; }
      fileResources.set(item.node.id, { ...item.resource, node: { ...item.resource.node, ref: fileRef } });
      fresh.set(item.node.id, fileRef);
      stale.push(item.resource.node.ref);
    });
    // E3-02: the live draft keeps its node as the person left it. A renewed grant is not an edit, and PromptInput's
    // clear-if-unchanged check compares that draft; only the resource and the frozen submission carry the new ref.
    return fresh.size === 0 ? current : { ...current, fileResources };
  });
  stale.forEach((ref) => void app.releaseFile(ref));
  return value.map((node) =>
    node.type === "file" && fresh.has(node.id) ? { ...node, ref: fresh.get(node.id)! } satisfies FileNode : node);
}

/**
 * The frozen submission (Gallery's prepared message) carries the same rich nodes; main checks that its file refs match the
 * Agent input's, so both get the renewed refs. Neither the caller's objects nor the live draft are mutated.
 */
export async function renewMessageFileGrants(chatId: string, message: PromptInputMessage): Promise<PromptInputMessage> {
  if (message.input.kind !== "rich") return message;
  const value = await renewComposerFileGrants(chatId, message.input.value);
  const refs = new Map(value.flatMap((node) => node.type === "file" ? [[node.id, node.ref] as const] : []));
  const renew = (nodes: RichValue) => nodes.map((node) => node.type === "file" && refs.has(node.id) ? { ...node, ref: refs.get(node.id)! } : node);
  const frozen = message.submissionData as { message?: { richValue?: RichValue } } | undefined;
  return { ...message, input: { ...message.input, value },
    ...(frozen?.message?.richValue ? { submissionData: { ...frozen, message: { ...frozen.message, richValue: renew(frozen.message.richValue) } } } : {}) };
}
