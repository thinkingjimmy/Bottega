/**
 * [INPUT]: Depends on closed main-frame Chat/remote bridges, account/device/key status and shared live replay contracts.
 * [OUTPUT]: Provides confirmed local mirror access after offline identity restoration and online key-admitted remote capabilities with scoped private-file URL ownership; the read-only half keeps its identity across account status changes and only the remote layer follows them; live watch failures are classified transient or terminal and transient ones re-attach (T20-8b).
 * [POS]: Renderer adapter; SQLite, filesystem paths, SDKs and credentials stay in main.
 */
import { listUnifiedSkills } from "../../skills/unified-skills-client";
import { useEffect, useMemo } from "react";
import type { CloudChatBridge } from "../../../../shared/cloud/chat";
import { CLOUD_CHAT_CAPABILITIES, readonlyCommands, type ChatPlatform, type AccountFacade, type ChatListSource, type TranscriptSource, type ExecutionFacade } from "@ai-chat/chat-ui/contracts";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { LiveReadFailure, liveTurnSource, reattachingLive } from "@ai-chat/chat-ui/live-source";
import { useCloudAccount } from "../client";
import { cloudSourcesAllowed } from "./access/access";
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
    /* 「还没登录」不是错误，是这一刻的答案：画一页空目录，binding 落下时
       onLocalChanged 会把这里叫醒。挂错误面只会在登录途中闪一下红。 */
    page: async (input, signal) => { signal.throwIfAborted(); const result = await bridge.catalog(input); signal.throwIfAborted(); controller.signal.throwIfAborted();
      return result.kind === "catalog" ? result.page : { items: [], facts: [], cursor: null, revision: 0, complete: true }; },
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
  const live = reattachingLive(liveTurnSource({
    head: (chatId, changed, failed) => bridge.watch("chats/metadata:head", { chatId }, changed, transient => failed(new LiveReadFailure(transient))),
    state: (chatId, turnId, changed, failed) => bridge.watch("turns/reads:state", { chatId, turnId }, changed, transient => failed(new LiveReadFailure(transient))),
    page: async (chatId, turnId, afterSeq, throughSeq, signal) => { signal.throwIfAborted();
      const page = await bridge.query("turns/reads:page", { chatId, turnId, afterSeq, throughSeq }); signal.throwIfAborted(); controller.signal.throwIfAborted(); return page; },
  }));
  const execution: ExecutionFacade = { read: chatId => bridge.execution({ chatId }), subscribe: (_chatId, changed) => bridge.onLocalChanged(changed),
    prepare: chatId => bridge.prepare({ chatId }),
    homeCapture: { retry: chatId => bridge.retryHome({ chatId }), skip: (chatId, jobId) => bridge.skipHome({ chatId, jobId }) } };
  const remote = remoteBridge ? desktopRemotePorts(remoteBridge, account, userId) : null;
  const platform: ChatPlatform = { capabilities: CLOUD_CHAT_CAPABILITIES, skills: { list: async (query, signal) => {
    signal.throwIfAborted(); controller.signal.throwIfAborted();
    if (account.snapshot().profile?.userId !== userId) throw new Error("CHAT_ACCOUNT_UNAVAILABLE");
    const snapshot = await listUnifiedSkills(); signal.throwIfAborted(); controller.signal.throwIfAborted();
    if (account.snapshot().profile?.userId !== userId) throw new Error("CHAT_ACCOUNT_UNAVAILABLE");
    const needle = query.toLocaleLowerCase();
    /* `enabled` is this computer's switch, not the owner's, and it is the only Skill evidence a draft
       has before a target answers: a Skill turned off here would not be injected from here either. */
    const matched = snapshot.library.filter(item => item.enabled && item.ref.startsWith("library:") &&
      [item.displayName, item.description].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle));
    // A name that starts with what was typed is what the user meant; a body match is the fallback, and the cap comes last.
    const prefix = (item: (typeof matched)[number]) => Number(item.displayName.toLocaleLowerCase().startsWith(needle));
    return matched.sort((left, right) => prefix(right) - prefix(left)).slice(0, 50)
      .map(item => ({ libraryId: item.ref.slice("library:".length), name: item.displayName, description: item.description }));
  } }, account, chats, transcript, live, execution: { ...execution, remote: remote?.execution },
    commands: remote ? { ...readonlyCommands, remote: remote.commands, available: remote.available } : readonlyCommands };
  /* scope: which account these reads belong to. Sources are rebuilt on every status change (ready ↔ temporarily-offline);
     views keep what they last read for the same scope instead of blanking until the new read lands. */
  return { ...platform, scope: userId, bindProject: (chatId: string) => bridge.bindProject({ chatId }), open: () => { if (controller.signal.aborted) controller = new AbortController(); },
    close: () => { controller.abort(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); } };
}
/* Read-only mirror access outlives status changes (ready ↔ temporarily-offline, a wake after sleep): only the remote layer follows
   them, so the open transcript, its live source and the catalog keep their identity and never restart from empty (TASK-20). */
export function useDesktopChatSources() {
  const account = useCloudAccount(), userId = account.profile?.userId, facade = useDesktopAccountFacade();
  const allowed = cloudSourcesAllowed(account);
  const base = useMemo(() => allowed && userId && account.deviceId && window.cloudChat ? desktopChatSources(window.cloudChat, userId, facade) : null,
    [allowed, userId, facade, account.deviceId]);
  const online = account.status === "ready" && account.encryption.status === "unlocked";
  const sources = useMemo(() => {
    if (!base || !online || !window.cloudRemote || !userId) return base;
    const remote = desktopRemotePorts(window.cloudRemote, facade, userId);
    return { ...base, execution: { ...base.execution, remote: remote.execution },
      commands: { ...readonlyCommands, remote: remote.commands, available: remote.available } };
  }, [base, online, facade, userId]);
  useEffect(() => { base?.open(); return () => base?.close(); }, [base]); return sources;
}
