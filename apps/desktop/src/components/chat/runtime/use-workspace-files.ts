/**
 * [INPUT]: Depends on React, shared workspace scope/result
 * [OUTPUT]: Provides the status of the Workspace Files in identity-stable, bound (scopeKey, chatId, query); The last response to cold 120ms/warm 30ms was to scrub and discard the delayed results with generation
 * [POS]: The file candidate of chat/runtime is asymmetrical boundary with the query owner; Keep main can be distinguished from united, without creating an error path
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentWorkspaceScope } from "../../../../shared/agent-ipc";
import type { WorkspaceFilesSearchResult } from "../../../../shared/workspace-files-ipc";
import { searchWorkspaceFiles } from "@/lib/workspace-files-client";

type BoundWorkspaceFilesState = WorkspaceFilesSearchResult & {
  chatId?: string;
  scopeKey: string;
  query: string;
  loading: boolean;
};

type QueryBinding = Pick<BoundWorkspaceFilesState, "scopeKey" | "query"> & {
  chatId?: string;
};

const idleState = (
  scopeKey: string,
  chatId?: string
): BoundWorkspaceFilesState => ({
  kind: "unavailable",
  reason: "no-workspace",
  scopeKey,
  query: "",
  loading: false,
  ...(chatId ? { chatId } : {}),
});

const sameBinding = (left: QueryBinding | null, right: QueryBinding) =>
  left?.scopeKey === right.scopeKey &&
  left.query === right.query &&
  left.chatId === right.chatId;

const requestChatId = (current: {
  chatId?: string;
  workspaceScope: AgentWorkspaceScope;
}) => current.workspaceScope.kind === "conversation" ? undefined : current.chatId;

export function useWorkspaceFiles({
  ready,
  chatId,
  workspaceScope,
  workspaceScopeKey,
}: {
  ready: boolean;
  chatId?: string;
  workspaceScope: AgentWorkspaceScope;
  workspaceScopeKey: string;
}) {
  const [state, setState] = useState<BoundWorkspaceFilesState>(() =>
    idleState(
      workspaceScopeKey,
      requestChatId({ chatId, workspaceScope })
    )
  );
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeQuery = useRef<string | null>(null);
  const scheduledBinding = useRef<QueryBinding | null>(null);
  const scopeRef = useRef({ workspaceScope, workspaceScopeKey, ready, chatId });
  const warmScope = useRef<string | null>(null);
  useLayoutEffect(() => {
    scopeRef.current = { workspaceScope, workspaceScopeKey, ready, chatId };
  }, [chatId, ready, workspaceScope, workspaceScopeKey]);

  const cancel = useCallback(() => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const schedule = useCallback(
    (query: string | null) => {
      const current = scopeRef.current;
      if (query === null || !current.ready) {
        cancel();
        scheduledBinding.current = null;
        setState((previous) =>
          previous.scopeKey === current.workspaceScopeKey &&
          previous.chatId === requestChatId(current) &&
          previous.query === "" &&
          !previous.loading &&
          previous.kind === "unavailable" &&
          previous.reason === "no-workspace"
            ? previous
            : idleState(
                current.workspaceScopeKey,
                requestChatId(current)
              )
        );
        return;
      }
      const nextBinding = {
        scopeKey: current.workspaceScopeKey,
        query,
        chatId: requestChatId(current),
      };
      if (sameBinding(scheduledBinding.current, nextBinding)) return;
      cancel();
      scheduledBinding.current = nextBinding;
      const requestedGeneration = generation.current;
      const requestState = {
        scopeKey: nextBinding.scopeKey,
        query: nextBinding.query,
        loading: true,
        ...(nextBinding.chatId ? { chatId: nextBinding.chatId } : {}),
      };
      setState({
        kind: "ready",
        entries: [],
        indexed: 0,
        indexTruncated: false,
        ...requestState,
      });
      timer.current = setTimeout(() => {
        timer.current = null;
        void searchWorkspaceFiles({
          scope: current.workspaceScope,
          query,
          ...(current.workspaceScope.kind === "conversation"
            ? {}
            : current.chatId ? { chatId: current.chatId } : {}),
        }).then((result) => {
          if (
            requestedGeneration !== generation.current ||
            scopeRef.current.workspaceScopeKey !== current.workspaceScopeKey ||
            requestChatId(scopeRef.current) !== requestChatId(current) ||
            activeQuery.current !== query ||
            !scopeRef.current.ready
          ) {
            return;
          }
          warmScope.current =
            result.kind === "ready" && result.servedFromCache === true
              ? current.workspaceScopeKey
              : null;
          setState({ ...result, ...requestState, loading: false });
        });
      }, warmScope.current === current.workspaceScopeKey ? 30 : 120);
    },
    [cancel]
  );

  const setQuery = useCallback(
    (query: string | null) => {
      const current = scopeRef.current;
      const nextBinding = {
        scopeKey: current.workspaceScopeKey,
        query: query ?? "",
        chatId: requestChatId(current),
      };
      if (
        activeQuery.current === query &&
        (query === null ||
          !current.ready ||
          sameBinding(scheduledBinding.current, nextBinding))
      ) {
        return;
      }
      activeQuery.current = query;
      schedule(query);
    },
    [schedule]
  );

  useEffect(() => {
    warmScope.current = null;
    scheduledBinding.current = null;
    schedule(activeQuery.current);
    return cancel;
  }, [cancel, chatId, ready, schedule, workspaceScopeKey]);

  const visibleChatId = requestChatId({ chatId, workspaceScope });
  const visibleState = useMemo(
    () =>
      ready &&
      state.scopeKey === workspaceScopeKey &&
      state.chatId === visibleChatId
        ? state
        : idleState(workspaceScopeKey, visibleChatId),
    [ready, state, visibleChatId, workspaceScopeKey]
  );
  return useMemo(
    () => ({ state: visibleState, setQuery }),
    [setQuery, visibleState]
  );
}

export type WorkspaceFilesState = ReturnType<
  typeof useWorkspaceFiles
>["state"];
