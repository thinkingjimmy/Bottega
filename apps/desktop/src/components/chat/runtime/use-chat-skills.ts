/**
 * [INPUT]: Depends on React, renderer Skills client/changed events, backend static capabilities, workspace scope/key and error integration
 * [OUTPUT]: Provides identity-stable skill catalog, Plan capability, model switching and mandatory consultation before sending
 * [POS]: The manual Skill/Plan state boundary of chat/runtime; Codex Check collaborationMode, ACP backend trusted by version-blocked descriptor
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
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { SkillInfo } from "../../../../shared/skills-ipc";
import { errorMessage } from "@/lib/errors";
import { listSkills, loadSkillCapabilities } from "@/lib/skills-client";

export function useChatSkills({
  ready,
  workspaceScope,
  workspaceScopeKey,
  backend,
  planSupported,
}: {
  ready: boolean;
  workspaceScope: AgentWorkspaceScope;
  workspaceScopeKey: string;
  backend: AgentBackendId;
  planSupported: boolean;
}) {
  const [planMode, setPlanMode] = useState(false);
  const [planAvailable, setPlanAvailable] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState("");
  const [planCapabilityChecking, setPlanCapabilityChecking] = useState(false);
  const [catalogGeneration, setCatalogGeneration] = useState(0);
  const checkingRef = useRef(false);
  const scopeKeyRef = useRef(workspaceScopeKey);

  useLayoutEffect(() => {
    scopeKeyRef.current = workspaceScopeKey;
  }, [workspaceScopeKey]);

  useEffect(
    () =>
      window.skills?.onChanged(() =>
        setCatalogGeneration((generation) => generation + 1)
      ) ?? (() => {}),
    []
  );

  useEffect(() => {
    let active = true;
    if (!ready) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setSkills([]);
        setPlanAvailable(false);
        setPlanMode(false);
        setSkillsLoading(false);
      });
      return () => {
        active = false;
      };
    }
    void Promise.resolve()
      .then(() => {
        if (!active) return undefined;
        setSkillsLoading(true);
        setSkillsError("");
        return Promise.all([
          listSkills({ scope: workspaceScope, backend, planMode }),
          backend === "codex"
            ? loadSkillCapabilities(workspaceScope)
            : Promise.resolve({ plan: planSupported }),
        ]);
      })
      .then((result) => {
        if (!active || !result) return;
        const [nextSkills, capabilities] = result;
        setSkills(nextSkills);
        const available = planSupported && capabilities.plan;
        setPlanAvailable(available);
        if (!available) setPlanMode(false);
      })
      .catch((cause) => {
        if (!active) return;
        setSkills([]);
        setPlanAvailable(false);
        setPlanMode(false);
        setSkillsError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setSkillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    backend,
    planMode,
    planSupported,
    ready,
    workspaceScope,
    workspaceScopeKey,
    catalogGeneration,
  ]);

  const requirePlanCapability = useCallback(async () => {
    if (checkingRef.current) {
      throw new Error("正在检查 Plan 能力，请稍候");
    }
    const requestedScopeKey = workspaceScopeKey;
    checkingRef.current = true;
    setPlanCapabilityChecking(true);
    setSkillsLoading(true);
    setSkillsError("");
    try {
      const capabilities =
        backend === "codex"
          ? await loadSkillCapabilities(workspaceScope)
          : { plan: planSupported };
      if (scopeKeyRef.current !== requestedScopeKey) {
        throw new Error("Workspace 已切换，请重试");
      }
      const available = planSupported && capabilities.plan;
      setPlanAvailable(available);
      if (!available) {
        throw new Error("当前 Agent 不支持 Plan，请升级后重试");
      }
    } catch (cause) {
      if (scopeKeyRef.current === requestedScopeKey) {
        setPlanAvailable(false);
        setPlanMode(false);
        setSkillsError(errorMessage(cause));
      }
      throw cause;
    } finally {
      checkingRef.current = false;
      setPlanCapabilityChecking(false);
      if (scopeKeyRef.current === requestedScopeKey) setSkillsLoading(false);
    }
  }, [backend, planSupported, workspaceScope, workspaceScopeKey]);

  const togglePlanMode = useCallback(async () => {
    if (planMode) {
      setPlanMode(false);
      return;
    }
    try {
      await requirePlanCapability();
      setPlanMode(true);
    } catch {
      // 错误已投影到 skillsError；菜单保持可重试。
    }
  }, [planMode, requirePlanCapability]);

  const isPlanCapabilityChecking = useCallback(
    () => checkingRef.current,
    []
  );

  return useMemo(() => ({
    isPlanCapabilityChecking,
    planAvailable,
    planCapabilityChecking,
    planMode,
    requirePlanCapability,
    setPlanMode,
    skills,
    skillsError,
    skillsLoading,
    togglePlanMode,
  }), [
    isPlanCapabilityChecking,
    planAvailable,
    planCapabilityChecking,
    planMode,
    requirePlanCapability,
    skills,
    skillsError,
    skillsLoading,
    togglePlanMode,
  ]);
}
