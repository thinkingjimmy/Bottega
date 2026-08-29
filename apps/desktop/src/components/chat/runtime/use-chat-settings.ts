/**
 * [INPUT]: Depends on React, SetupProvider shared backend directory, shared settings/models/workspace agreements, drafted default Agent, settings-client and renderer errorMessage
 * [OUTPUT]: Provides identity-stable useChatSettings with scoped options, explicit model/Speed session reset intent, model catalogs, backend locks, and stale-ack rejection
 * [POS]: The Agent status source for chat/runtime is set; Asynchronous regression only rewrites the conversation it started, and the model finds that it consumes a credible workspace scope
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AgentBackendId,
  AgentScope,
  AgentTurnOptions,
  AgentWorkspaceScope,
  BackendInfo,
  BackendModelInfo,
} from "../../../../shared/agent-ipc";
import { errorMessage } from "@/lib/errors";
import {
  getSettings,
  listModels,
  resolveChatOptions,
  setChatOptions,
} from "@/lib/settings-client";

const initialTurnOptions: AgentTurnOptions = {
  backend: "codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "xhigh",
  serviceTier: "priority",
  permissionMode: "approve-for-me",
};

export function useChatSettings(
  scope: AgentScope,
  modelScope: AgentWorkspaceScope | null,
  backends: BackendInfo[],
  retryBackends: () => Promise<void>,
  draftBackend?: AgentBackendId
) {
  const activeConversation = useRef({
    conversationId: scope.conversationId,
    generation: 0,
  });
  const draftBackendRef = useRef(draftBackend);
  useLayoutEffect(() => {
    if (activeConversation.current.conversationId === scope.conversationId) {
      return;
    }
    activeConversation.current = {
      conversationId: scope.conversationId,
      generation: activeConversation.current.generation + 1,
    };
    draftBackendRef.current = draftBackend;
  }, [draftBackend, scope.conversationId]);
  const [scopedTurnOptions, setScopedTurnOptions] = useState({
    conversationId: scope.conversationId,
    value: initialTurnOptions,
  });
  const [backendLock, setBackendLock] = useState<{
    conversationId: string;
    value: AgentBackendId;
  } | null>(null);
  const turnOptions =
    scopedTurnOptions.conversationId === scope.conversationId
      ? scopedTurnOptions.value
      : initialTurnOptions;
  const lockedBackend =
    backendLock?.conversationId === scope.conversationId
      ? backendLock.value
      : null;
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [models, setModels] = useState<BackendModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const modelRequestGeneration = useRef(0);

  const captureConversation = useCallback(() => {
    return { ...activeConversation.current };
  }, []);

  const isCurrentConversation = useCallback(
    (capture: { conversationId: string; generation: number }) =>
      activeConversation.current.conversationId === capture.conversationId &&
      activeConversation.current.generation === capture.generation,
    []
  );

  const loadModels = useCallback(
    async (backend = turnOptions.backend) => {
      if (!modelScope) return;
      const conversation = captureConversation();
      const generation = ++modelRequestGeneration.current;
      setModelsLoading(true);
      setModels([]);
      try {
        const next = await listModels(backend, modelScope);
        if (
          generation !== modelRequestGeneration.current ||
          !isCurrentConversation(conversation)
        ) return;
        setModels(next);
        setModelsError("");
      } catch (cause) {
        if (
          generation !== modelRequestGeneration.current ||
          !isCurrentConversation(conversation)
        ) return;
        setModels([]);
        setModelsError(errorMessage(cause));
      } finally {
        if (
          generation === modelRequestGeneration.current &&
          isCurrentConversation(conversation)
        ) {
          setModelsLoading(false);
        }
      }
    },
    [
      captureConversation,
      isCurrentConversation,
      modelScope,
      turnOptions.backend,
    ]
  );

  useEffect(() => {
    if (settingsLoading || !modelScope) return;
    void Promise.resolve().then(() => loadModels());
    return () => {
      modelRequestGeneration.current += 1;
    };
  }, [loadModels, modelScope, settingsLoading]);

  useEffect(() => {
    const capture = captureConversation();
    const stableScope = { conversationId: capture.conversationId };
    void Promise.resolve().then(async () => {
      if (!isCurrentConversation(capture)) return;
      setSettingsSaving(false);
      setSettingsError("");
      setSettingsLoading(true);
      try {
        const options = await resolveChatOptions(
          stableScope,
          draftBackendRef.current
        );
        if (isCurrentConversation(capture)) {
          setScopedTurnOptions({
            conversationId: capture.conversationId,
            value: options,
          });
        }
      } catch (cause) {
        if (isCurrentConversation(capture)) {
          setSettingsError(`Agent 设置读取失败：${errorMessage(cause)}`);
        }
      } finally {
        if (isCurrentConversation(capture)) setSettingsLoading(false);
      }
    });
  }, [captureConversation, isCurrentConversation, scope.conversationId]);

  const updateTurnOptions = useCallback(
    async (next: AgentTurnOptions, resetSessionEffective = false) => {
      const capture = captureConversation();
      if (lockedBackend && next.backend !== lockedBackend) {
        throw new Error("已有聊天不能切换 Agent");
      }
      const previous = turnOptions;
      setSettingsError("");
      setScopedTurnOptions({
        conversationId: capture.conversationId,
        value: next,
      });
      setSettingsSaving(true);
      try {
        const stored = await setChatOptions(
          { conversationId: capture.conversationId },
          next,
          resetSessionEffective
        );
        if (isCurrentConversation(capture)) {
          setScopedTurnOptions({
            conversationId: capture.conversationId,
            value: stored,
          });
        }
      } catch (cause) {
        if (isCurrentConversation(capture)) {
          setScopedTurnOptions({
            conversationId: capture.conversationId,
            value: previous,
          });
          setSettingsError(`Agent 设置保存失败：${errorMessage(cause)}`);
        }
        throw cause;
      } finally {
        if (isCurrentConversation(capture)) setSettingsSaving(false);
      }
    },
    [captureConversation, isCurrentConversation, lockedBackend, turnOptions]
  );

  const selectBackend = useCallback(
    async (backend: AgentBackendId) => {
      const capture = captureConversation();
      if (lockedBackend) return;
      const candidate = backends.find((item) => item.id === backend);
      if (!candidate || candidate.runtimeStatus !== "installed") {
        throw new Error("当前 Agent 尚未安装或未通过版本检测");
      }
      const { settings } = await getSettings();
      if (!isCurrentConversation(capture)) return;
      const next =
        settings.defaultChatOptionsByBackend[backend] ??
        ({ backend, permissionMode: "ask-for-approval" } as AgentTurnOptions);
      await updateTurnOptions(next, true);
    },
    [
      backends,
      captureConversation,
      isCurrentConversation,
      lockedBackend,
      updateTurnOptions,
    ]
  );

  const lockBackend = useCallback(
    async (backend: AgentBackendId) => {
      const capture = captureConversation();
      setBackendLock({
        conversationId: capture.conversationId,
        value: backend,
      });
      const next = await resolveChatOptions(
        { conversationId: capture.conversationId },
        backend
      );
      if (isCurrentConversation(capture)) {
        setScopedTurnOptions({
          conversationId: capture.conversationId,
          value: next,
        });
      }
      return next;
    },
    [captureConversation, isCurrentConversation]
  );

  const retryModels = useCallback(() => loadModels(), [loadModels]);

  return useMemo(() => ({
    turnOptions,
    lockedBackend,
    backends,
    settingsLoading,
    settingsSaving,
    settingsError,
    models,
    modelsLoading,
    modelsError,
    retryBackends,
    retryModels,
    selectBackend,
    lockBackend,
    updateTurnOptions,
  }), [
    backends,
    lockBackend,
    lockedBackend,
    models,
    modelsError,
    modelsLoading,
    retryBackends,
    retryModels,
    selectBackend,
    settingsError,
    settingsLoading,
    settingsSaving,
    turnOptions,
    updateTurnOptions,
  ]);
}
