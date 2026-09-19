/**
 * [INPUT]: Current input target, synchronized Skill source, retained remote session and reference draft custody.
 * [OUTPUT]: Debounced native RichInput suggestions with exact target-bound file selection and clear offline feedback.
 * [POS]: Shared composer source adapter; changing computers preserves chips and requires explicit reselection.
 */
import { useCallback, useEffect, useState } from "react";
import type { RichInputProps, RichInputSuggestion } from "@ai-chat/ui/components/ai-elements/rich-input";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
import type { RemoteWorkspaceResult } from "@ai-chat/cloud-protocol/remote/input/references";
import type { ChatPlatform, ExecutorFacade } from "../../../../platform/contracts";
import type { RemoteCommandSession } from "../../../../platform/remote/commands/session";
import type { RemoteDraftStore } from "../../../../platform/remote/input/draft";
import { queryRemoteWorkspace } from "../../../../platform/remote/workspace";
import { remoteCopy } from "../../../../i18n/remote";
import { remoteInputCopy } from "../copy";
type Query = Parameters<NonNullable<RichInputProps["onQueryChange"]>>[0];
export function useRemoteReferences(input: { head: CloudChatHead | null; target?: RemoteTarget; platform: (Partial<Pick<ChatPlatform, "capabilities" | "skills" | "commands" | "transcript">> & { executor?: Pick<ExecutorFacade, "remote"> }) | null; session: RemoteCommandSession | null;
  projectId?: string | null; store: RemoteDraftStore; locale: string; disabled: boolean }) {
  const [query, setQuery] = useState<Query>(null), [value, setValue] = useState<{ scope: string; store: RemoteDraftStore; target: string; kind: "skill" | "mention"; query: string;
    suggestions: RichInputSuggestion[]; files?: Extract<RemoteWorkspaceResult, { kind: "workspace-files" }>; failed?: boolean } | null>(null);
  const { target, head, platform, session, store, disabled, projectId } = input, copy = remoteCopy(input.locale), text = remoteInputCopy(input.locale);
  const online = Boolean(target?.online), deviceId = target?.deviceId;
  const chatId = head?.chat.id, incarnationId = head?.chat.incarnationId, executionEpoch = head?.executionEpoch;
  const scope = `${chatId ?? ""}/${incarnationId ?? ""}/${executionEpoch ?? ""}/${projectId ?? ""}`;
  useEffect(() => {
    if (!platform || !query || disabled || platform.capabilities?.[query.kind === "mention" ? "files" : "skills"] === false || query.kind === "mention" && (!deviceId || !online)) return;
    const abort = new AbortController(), signal = platform.commands?.remote?.lifetime ? AbortSignal.any([abort.signal, platform.commands?.remote.lifetime]) : abort.signal;
    const timer = setTimeout(() => { void (async () => {
      if (query.kind === "skill") {
        const items = await platform.skills?.list(query.value, signal) ?? []; signal.throwIfAborted();
        setValue({ scope, store, target: deviceId ?? "", kind: query.kind, query: query.value, suggestions: items.map(item => ({ kind: "skill", ref: `library:${item.libraryId}`, name: item.name, label: item.name, description: item.description })) });
      } else {
        const files = session && chatId && incarnationId && executionEpoch !== undefined && platform.transcript
          ? await queryRemoteWorkspace({ session, transcript: platform.transcript }, { chat: { id: chatId, incarnationId }, executionEpoch }, deviceId!, { kind: "list-workspace-files", query: query.value }, signal)
          : projectId ? await platform.executor?.remote?.projectFiles?.({ targetDeviceId: deviceId!, projectId, query: query.value }, signal) : null;
        signal.throwIfAborted();
        if (!files && !projectId && !chatId) { setValue({ scope, store, target: deviceId ?? "", kind: query.kind, query: query.value, suggestions: [] }); return; }
        if (!files || files.kind !== "workspace-files") throw new Error("workspace-file-unavailable");
        setValue({ scope, store, target: deviceId ?? "", kind: query.kind, query: query.value, files, suggestions: files.entries.map(entry => ({ kind: "workspace-file", path: entry.path,
          entryKind: entry.entryKind, label: entry.path.split("/").at(-1)!, description: entry.path })) });
      }
    })().catch(() => { if (!signal.aborted) setValue({ scope, store, target: deviceId ?? "", kind: query.kind, query: query.value, suggestions: [], failed: true }); }); }, 600);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, deviceId, online, disabled, platform, session, chatId, incarnationId, executionEpoch, projectId, scope, store]);
  const matched = value && value.scope === scope && value.store === store && value.target === (deviceId ?? "") && value.kind === query?.kind && value.query === query.value ? value : null;
  const select = useCallback((suggestion: RichInputSuggestion) => {
    if (disabled || !matched || suggestion.kind === "workspace-file" && (!online || !deviceId) || store.snapshot().references.length >= 32) return false;
    const reference = suggestion.kind === "skill" ? { kind: "skill" as const, libraryId: suggestion.ref.slice("library:".length) } :
      suggestion.kind === "workspace-file" && matched.files ? { kind: "file" as const, deviceId: deviceId!, workspaceDigest: matched.files.workspaceDigest, path: suggestion.path, entryKind: suggestion.entryKind ?? "file" } : null;
    if (!reference) return false;
    const references = store.snapshot().references.filter(item => reference.kind === "skill" ? item.value.kind !== "skill" || item.value.libraryId !== reference.libraryId : item.value.kind !== "file" || item.value.path !== reference.path);
    store.update({ references: [...references, { id: crypto.randomUUID(), label: suggestion.label, value: reference }] }); return true;
  }, [online, deviceId, disabled, matched, store]);
  const empty = query?.kind === "mention" && !online ? copy.computerOffline.replace("{name}", target?.name ?? copy.computer) : matched?.failed ? copy.requestFailed : !matched ? text.loadingReferences : query?.kind === "skill" ? copy.skillsEmpty : text.noFiles;
  return { suggestions: matched?.suggestions ?? [], onQueryChange: setQuery, onSuggestionSelect: select,
    suggestionCopy: { mention: { empty, noMatch: empty, groups: [{ kind: "workspace-file" as const, label: text.attach }] },
      skill: { empty, noMatch: empty } } satisfies RichInputProps["suggestionCopy"] };
}
