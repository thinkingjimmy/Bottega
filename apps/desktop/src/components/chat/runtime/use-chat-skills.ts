/**
 * [INPUT]: Depends on React, renderer Skills client/changed events, backend static capabilities, workspace scope/key and error integration
 * [OUTPUT]: Provides one raw catalog load with memoized normal/Plan eligibility, scope-bound monotonic invalidated refs, persistent warnings, Plan capability, and fresh send consultation
 * [POS]: Chat runtime boundary for Skill and Plan state; backend capability facts remain descriptor-owned
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
import type { SkillsListResult } from "../../../../shared/skills-ipc";
import { errorMessage } from "@/lib/errors";
import { listSkills, loadSkillCapabilities } from "@/lib/skills-client";
import { ProductFailureError } from "../../../../shared/product-failure";
import { skillFailureText } from "@/lib/skill-failure-text";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/* envelope 失败走五语目录组句，其余（本地控制态的预译文本）原样透传——
   裸 `skills-runtime/unavailable` 一类的码永远不该到 Plan tooltip 上。 */
function skillsErrorText(
  t: (key: string, options?: Record<string, unknown>) => string,
  cause: unknown
) {
  return cause instanceof ProductFailureError
    ? skillFailureText(t, cause.failure)
    : errorMessage(cause);
}

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
  const { t } = useAppTranslation();
  const [planMode, setPlanMode] = useState(false);
  const [planAvailable, setPlanAvailable] = useState(false);
  const [catalogs, setCatalogs] = useState<Readonly<{
    normal: SkillsListResult;
    plan: SkillsListResult;
  }> | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [invalidatedSkillRefs, setInvalidatedSkillRefs] = useState<readonly string[]>([]);
  const [planCapabilityChecking, setPlanCapabilityChecking] = useState(false);
  const [catalogGeneration, setCatalogGeneration] = useState(0);
  const checkingRef = useRef(false);
  const scopeKeyRef = useRef(workspaceScopeKey);
  const workspaceScopeRef = useRef(workspaceScope);
  const invalidationBucketRef = useRef({
    ready,
    scopeKey: workspaceScopeKey,
    refs: new Set<string>(),
  });

  useLayoutEffect(() => {
    scopeKeyRef.current = workspaceScopeKey;
    workspaceScopeRef.current = workspaceScope;
  }, [workspaceScope, workspaceScopeKey]);

  useLayoutEffect(() => {
    const bucket = invalidationBucketRef.current;
    if (bucket.ready === ready && bucket.scopeKey === workspaceScopeKey) return;
    invalidationBucketRef.current = {
      ready,
      scopeKey: workspaceScopeKey,
      refs: new Set(),
    };
    setInvalidatedSkillRefs([]);
    setCatalogError("");
  }, [ready, workspaceScopeKey]);

  useEffect(
    () =>
      window.skills?.onChanged((event) => {
        const bucket = invalidationBucketRef.current;
        if (!bucket.ready) return;
        for (const ref of event.invalidatedRefs) bucket.refs.add(ref);
        setInvalidatedSkillRefs([...bucket.refs]);
        setCatalogGeneration((generation) => generation + 1);
      }) ?? (() => {}),
    []
  );

  useEffect(() => {
    let active = true;
    if (!ready) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setCatalogs(null);
        setPlanAvailable(false);
        setPlanMode(false);
        setSkillsLoading(false);
        setCatalogError("");
      });
      return () => {
        active = false;
      };
    }
    const requestedScope = workspaceScopeRef.current;
    void Promise.resolve()
      .then(() => {
        if (!active) return undefined;
        setSkillsLoading(true);
        setCatalogError("");
        return Promise.all([
          listSkills({ scope: requestedScope, backend, planMode: false }),
          listSkills({ scope: requestedScope, backend, planMode: true }),
          backend === "codex"
            ? loadSkillCapabilities(requestedScope)
            : Promise.resolve({ plan: planSupported }),
        ]);
      })
      .then((result) => {
        if (!active || !result) return;
        const [normal, plan, capabilities] = result;
        setCatalogs({ normal, plan });
        const available = planSupported && capabilities.plan;
        setPlanAvailable(available);
        if (!available) setPlanMode(false);
      })
      .catch((cause) => {
        if (!active) return;
        setCatalogs(null);
        setPlanAvailable(false);
        setPlanMode(false);
        setCatalogError(skillsErrorText(t, cause));
      })
      .finally(() => {
        if (active) setSkillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    backend,
    planSupported,
    ready,
    t,
    workspaceScopeKey,
    catalogGeneration,
  ]);

  const requirePlanCapability = useCallback(async () => {
    if (checkingRef.current) {
      throw new Error(t("chat.skillControl.capabilityChecking"));
    }
    const requestedScopeKey = workspaceScopeKey;
    const requestedScope = workspaceScopeRef.current;
    checkingRef.current = true;
    setPlanCapabilityChecking(true);
    setCatalogError("");
    try {
      const capabilities =
        backend === "codex"
          ? await loadSkillCapabilities(requestedScope)
          : { plan: planSupported };
      if (scopeKeyRef.current !== requestedScopeKey) {
        throw new Error(t("chat.skillControl.workspaceChanged"));
      }
      const available = planSupported && capabilities.plan;
      setPlanAvailable(available);
      if (!available) {
        throw new Error(t("chat.skillControl.planUnavailable"));
      }
    } catch (cause) {
      if (scopeKeyRef.current === requestedScopeKey) {
        setPlanAvailable(false);
        setPlanMode(false);
        setCatalogError(skillsErrorText(t, cause));
      }
      throw cause;
    } finally {
      checkingRef.current = false;
      setPlanCapabilityChecking(false);
    }
  }, [backend, planSupported, t, workspaceScopeKey]);

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

  const projection = catalogs?.[planMode ? "plan" : "normal"];
  const skills = useMemo<SkillInfo[]>(() => projection ? [...projection.skills] : [], [projection]);
  const skillsHiddenCount = projection?.hiddenCount ?? 0;
  const skillsError = catalogError || (
    invalidatedSkillRefs.length ? t("chat.skillControl.invalidated") : ""
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
    skillsHiddenCount,
    invalidatedSkillRefs,
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
    skillsHiddenCount,
    invalidatedSkillRefs,
    skillsLoading,
    togglePlanMode,
  ]);
}
