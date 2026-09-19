"use client";

/**
 * [INPUT]: Depends on Project, installed backend status, explicit Skills owner-scope DTOs, shared SkillRow/SkillBadge/SkillSearch presentation, Settings primitives, routing, and i18n
 * [OUTPUT]: Provides ProjectSkillsSection with shared global Skills styling, always-visible search, multi-backend union, exact-owner Project/inherited grouping, and latest-request-only refresh after imports
 * [POS]: Read-only callable catalog inside the Project Skills/Extensions settings surface
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import type { Project } from "../../../../shared/projects-ipc";
import { PROJECT_UNAVAILABLE } from "../../../../shared/projects-ipc";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { SkillInfo } from "../../../../shared/skills-ipc";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsDisclosure,
  SettingsEmpty,
  SettingsList,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { SkillBadge, SkillRow } from "@/components/settings/skills/skill-row";
import { SkillSearch } from "@/components/settings/skills/skill-search";
import { listSkills, onSkillsChanged } from "@/lib/skills-client";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useSearchParams } from "react-router";

const unavailable = (cause: unknown) =>
  cause instanceof Error && cause.message.includes(PROJECT_UNAVAILABLE);

function unionSkills(groups: SkillInfo[][]) {
  const byRef = new Map<string, SkillInfo>();
  for (const group of groups) {
    for (const skill of group) byRef.set(skill.ref, skill);
  }
  return [...byRef.values()].sort((left, right) =>
    (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name)
  );
}

export function ProjectSkillsSection({
  project,
  refreshRevision = 0,
}: {
  project: Project;
  refreshRevision?: number;
}) {
  const { t } = useAppTranslation();
  const [searchParams] = useSearchParams();
  const setup = useSetup();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [noWorkspace, setNoWorkspace] = useState(project.workspaceBinding.kind === "none");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const requestSequence = useRef(0);
  const backends = useMemo(
    () => (setup.status?.backends ?? [])
      .filter((backend) => backend.runtimeStatus === "installed")
      .map((backend) => backend.id as AgentBackendId),
    [setup.status?.backends]
  );

  const load = useCallback(async (forceReload = false) => {
    const request = ++requestSequence.current;
    const current = () => request === requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const groups = await Promise.all(backends.map((backend) => listSkills({
        scope: { kind: "project", projectId: project.id },
        backend,
        planMode: false,
        forceReload,
      })));
      if (current()) {
        setSkills(unionSkills(groups.map((group) => [...group.skills])));
        setNoWorkspace(project.workspaceBinding.kind === "none");
      }
    } catch (cause) {
      if (!current()) return;
      if (unavailable(cause)) setNoWorkspace(true);
      else setError(t("projectSettings.skills.loadFailed"));
    } finally {
      if (current()) setLoading(false);
    }
  }, [backends, project.id, project.workspaceBinding.kind, t]);

  useEffect(() => {
    queueMicrotask(() => void load().catch(() => {}));
    const unsubscribe = onSkillsChanged(() => {
      void load();
    });
    return () => {
      requestSequence.current += 1;
      unsubscribe();
    };
  }, [load, refreshRevision]);

  const needle = query.trim().toLocaleLowerCase();
  const packageIdentity = searchParams.get("package");
  const scoped = packageIdentity
    ? skills.filter(
        (skill) => skill.extensionInstallIdentity === packageIdentity
      )
    : skills;
  const shown = needle
    ? scoped.filter((skill) => `${skill.displayName ?? skill.name} ${skill.description}`.toLocaleLowerCase().includes(needle))
    : scoped;
  const projectSkills = shown.filter(
    (skill) =>
      skill.ownerScope.kind === "project" &&
      skill.ownerScope.projectId === project.id
  );
  const inherited = shown.filter(
    (skill) =>
      skill.ownerScope.kind !== "project" ||
      skill.ownerScope.projectId !== project.id
  );

  return (
    <div className="space-y-4">
      <SettingsSection
        title={t("projectSettings.skills.section")}
        description={<>{t("projectSettings.skills.scopeNote")}<br />{t("projectSettings.skills.runtimeNote")}</>}
        alert={error || undefined}
        action={
          <Button
            aria-label={t("settings.skills.refresh")}
            disabled={loading}
            onClick={() => void load(true)}
            size="icon-lg"
            variant="ghost"
          >
            <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : ""} />
          </Button>
        }
      >
        <div className="flex items-center gap-3">
          <SkillSearch onChange={setQuery} value={query} />
        </div>
        {loading && !skills.length ? (
          <p className="flex items-center gap-2 py-8 text-muted-foreground text-sm" role="status">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            {t("common.loadingView")}
          </p>
        ) : projectSkills.length ? (
          <SkillRows skills={projectSkills} />
        ) : needle ? (
          !inherited.length && (
            <p className="py-12 text-center text-muted-foreground text-sm">
              {t("settings.skills.noMatches")}
            </p>
          )
        ) : (
          <SettingsEmpty
            icon={<Sparkles />}
            title={t(noWorkspace ? "projectSettings.skills.noWorkspace" : "projectSettings.skills.empty")}
            hint={noWorkspace
              ? t("projectSettings.skills.noWorkspaceHint")
              : t("projectSettings.skills.emptyHint", { dir: project.dir })}
          />
        )}
      </SettingsSection>

      {inherited.length > 0 && (
        <SettingsDisclosure label={t("projectSettings.skills.inheritedGroup", { count: inherited.length })}>
          <SkillRows skills={inherited} />
        </SettingsDisclosure>
      )}
    </div>
  );
}

function SkillRows({ skills }: { skills: SkillInfo[] }) {
  const { t } = useAppTranslation();
  return (
    <SettingsList>
      {skills.map((skill) => (
        <SkillRow
          badges={<SkillBadge>{t(`projectSettings.skills.badge.${skill.scope}`)}</SkillBadge>}
          description={skill.description}
          key={skill.ref}
          name={skill.displayName ?? skill.name}
        />
      ))}
    </SettingsList>
  );
}
