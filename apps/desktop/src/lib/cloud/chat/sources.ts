/**
 * [INPUT]: Depends on closed main-frame Chat/remote bridges, account/device/key status and shared live replay contracts.
 * [OUTPUT]: Provides confirmed local mirror access after offline identity restoration and online key-admitted remote capabilities with scoped private-file URL ownership.
 * [POS]: Renderer adapter; SQLite, filesystem paths, SDKs and credentials stay in main.
 */
import { listUnifiedSkills } from "../../unified-skills-client";
import { useEffect, useMemo } from "react";
import type { CloudChatBridge } from "../../../../shared/cloud/chat";
import { CLOUD_CHAT_CAPABILITIES, readonlyCommands, type ChatPlatform, type AccountFacade, type ChatListSource, type TranscriptSource, type ExecutorFacade } from "@ai-chat/chat-ui/contracts";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { liveTurnSource } from "@ai-chat/chat-ui/live-source";
import { useCloudAccount } from "../client";
import { cloudSourcesAllowed } from "./access";
import { chatFileURL } from "./files";
import { useDesktopAccountFacade } from "./platform/account";
import type { CloudRemoteBridge } from "../../../../shared/cloud/remote/contracts";
import { desktopRemotePorts } from "./remote/ports";
declare global { interface Window { cloudChat?: CloudChatBridge } }
export function desktopChatSources(bridge: CloudChatBridge, userId: string, account: AccountFacade, remoteBridge?: CloudRemoteBridge) {
  if (!userId) throw new Error("CHAT_ACCOUNT_UNAVAILABLE");
  let controller = new AbortController(); const urls = new Set<string>();
  const chats: ChatListSource = {
    browse: async (input, signal) => { signal.throwIfAborted(); const page = await bridge.query("chats/catalog:page", input); signal.throwIfAborted(); controller.signal.throwIfAborted(); return page; },
    page: async (input, signal) => { signal.throwIfAborted(); const page = await bridge.catalog(input); signal.throwIfAborted(); controller.signal.throwIfAborted(); return page; },
    head: async (chatId, signal) => { signal.throwIfAborted(); const head = await bridge.head({ chatId }); signal.throwIfAborted(); controller.signal.throwIfAborted(); return head; },
    subscribe: changed => bridge.onLocalChanged(changed),
  };
  const transcript: TranscriptSource = {
    locate: async (chatId, messageId, signal) => {
      signal.throwIfAborted();
      if (/^import-[1-9][0-9]*$/.test(messageId)) return { segment: "imported", seq: Number(messageId.slice(7)) };
      const message = await bridge.query("chats/body/reads:get", { chatId, messageId });
      signal.throwIfAborted(); controller.signal.throwIfAborted(); return message ? { segment: "native", seq: message.summary.seq } : null;
    },
    page: async (input, signal) => { signal.throwIfAborted(); const page = await bridge.transcript(input); signal.throwIfAborted(); controller.signal.throwIfAborted(); return page; },
    subscribe: (_chatId, changed) => bridge.onLocalChanged(changed),
    file: async (chatId, descriptor, external) => {
      const signal = AbortSignal.any([external, controller.signal]); signal.throwIfAborted();
      return chatFileURL(bridge, () => bridge.openFile({ chatId, descriptor: encryptedFileDescriptorSchema.parse(descriptor) }), descriptor, signal, urls);
    },
  };
  const live = liveTurnSource({
    head: (chatId, changed, failed) => bridge.watch("chats/metadata:head", { chatId }, changed, () => failed(new Error("CHAT_LIVE_UNAVAILABLE"))),
    state: (chatId, turnId, changed, failed) => bridge.watch("turns/reads:state", { chatId, turnId }, changed, () => failed(new Error("CHAT_LIVE_UNAVAILABLE"))),
    page: async (chatId, turnId, afterSeq, throughSeq, signal) => { signal.throwIfAborted();
      const page = await bridge.query("turns/reads:page", { chatId, turnId, afterSeq, throughSeq }); signal.throwIfAborted(); controller.signal.throwIfAborted(); return page; },
  });
  const executor: ExecutorFacade = { read: chatId => bridge.execution({ chatId }), subscribe: (_chatId, changed) => bridge.onLocalChanged(changed),
    claim: chatId => bridge.claim({ chatId }), prepare: chatId => bridge.prepare({ chatId }) };
  const remote = remoteBridge ? desktopRemotePorts(remoteBridge, account, userId) : null;
  const platform: ChatPlatform = { capabilities: CLOUD_CHAT_CAPABILITIES, skills: { list: async (query, signal) => {
    signal.throwIfAborted(); controller.signal.throwIfAborted();
    if (account.snapshot().profile?.userId !== userId) throw new Error("CHAT_ACCOUNT_UNAVAILABLE");
    const snapshot = await listUnifiedSkills(); signal.throwIfAborted(); controller.signal.throwIfAborted();
    if (account.snapshot().profile?.userId !== userId) throw new Error("CHAT_ACCOUNT_UNAVAILABLE");
    const needle = query.toLocaleLowerCase();
    /* `enabled` is this computer's switch, not the executor's, and it is the only Skill evidence a draft
       has before a target answers: a Skill turned off here would not be injected from here either. */
    const matched = snapshot.library.filter(item => item.enabled && item.ref.startsWith("library:") &&
      [item.displayName, item.description].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle));
    // A name that starts with what was typed is what the user meant; a body match is the fallback, and the cap comes last.
    const prefix = (item: (typeof matched)[number]) => Number(item.displayName.toLocaleLowerCase().startsWith(needle));
    return matched.sort((left, right) => prefix(right) - prefix(left)).slice(0, 50)
      .map(item => ({ libraryId: item.ref.slice("library:".length), name: item.displayName, description: item.description }));
  } }, account, chats, transcript, live, executor: { ...executor, remote: remote?.executor },
    commands: remote ? { ...readonlyCommands, remote: remote.commands, available: remote.available } : readonlyCommands };
  return { ...platform, bindProject: (chatId: string) => bridge.bindProject({ chatId }), open: () => { if (controller.signal.aborted) controller = new AbortController(); },
    close: () => { controller.abort(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); } };
}
export function useDesktopChatSources() {
  const account = useCloudAccount(), userId = account.profile?.userId, facade = useDesktopAccountFacade();
  const allowed = cloudSourcesAllowed(account);
  const sources = useMemo(() => allowed && userId && account.deviceId && window.cloudChat ? desktopChatSources(window.cloudChat, userId, facade,
    account.status === "ready" && account.encryption.status === "unlocked" ? window.cloudRemote : undefined) : null, [allowed, userId, facade, account.deviceId, account.status, account.encryption.status]);
  useEffect(() => { sources?.open(); return () => sources?.close(); }, [sources]); return sources;
}
