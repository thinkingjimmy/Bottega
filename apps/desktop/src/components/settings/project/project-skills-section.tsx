"use client";

/**
 * [INPUT]: Depends on Project, installed backend status, explicit Skills owner-scope DTOs, Settings primitives, routing, and i18n
 * [OUTPUT]: Provides ProjectSkillsSection with multi-backend union, exact-owner Project/inherited grouping, Project-local Extensions management routing, force refresh, and latest-request-only state commits
 * [POS]: Project Settings Skills tab; a read-only callable projection linked to the exact Project Extensions management surface
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, Search, Sparkles } from "lucide-react";
import type { Project } from "../../../../shared/projects-ipc";
import { PROJECT_UNAVAILABLE } from "../../../../shared/projects-ipc";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { SkillInfo } from "../../../../shared/skills-ipc";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsDisclosure,
  SettingsEmpty,
  SettingsList,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { listSkills, onSkillsChanged } from "@/lib/skills-client";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Link, useSearchParams } from "react-router";

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

export function ProjectSkillsSection({ project }: { project: Project }) {
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
  }, [load]);

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
    <SettingsCanvas>
      <div className="space-y-8">
        <SettingsSection
          title={t("projectSettings.skills.section")}
          description={<>{t("projectSettings.skills.scopeNote")}<br />{t("projectSettings.skills.runtimeNote")}</>}
          alert={error || undefined}
          action={
            <div className="flex items-center gap-2">
              <Link
                className="inline-flex min-h-11 touch-manipulation items-center rounded-md px-3 text-xs ring-1 ring-foreground/10 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                to={`/projects/${project.id}/settings?tab=extensions`}
              >
                {t("common.extensions")}
              </Link>
              {skills.length > 10 && (
                <div className="relative w-[11rem]">
                  <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
                  <Input aria-label={t("projectSettings.skills.search")} className="h-11 pl-8" placeholder={t("projectSettings.skills.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
                </div>
              )}
              <SettingsButton disabled={loading} onClick={() => void load(true)} variant="outline">
                <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : ""} />
                {t("projectSettings.skills.refresh")}
              </SettingsButton>
            </div>
          }
        >
          {loading && !skills.length ? (
            <p className="flex items-center gap-2 py-8 text-muted-foreground text-sm" role="status">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              {t("common.loadingView")}
            </p>
          ) : projectSkills.length ? (
            <SkillRows skills={projectSkills} />
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
    </SettingsCanvas>
  );
}

function SkillRows({ skills }: { skills: SkillInfo[] }) {
  const { t } = useAppTranslation();
  return (
    <SettingsList>
      {skills.map((skill) => (
        <div className="flex items-start justify-between gap-4 px-4 py-3" key={skill.ref}>
          <div className="min-w-0">
            <p className="font-medium text-sm">{skill.displayName ?? skill.name}</p>
            <p className="mt-1 text-muted-foreground text-xs leading-relaxed">{skill.description}</p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-[11px]">
            {t(`projectSettings.skills.badge.${skill.scope}`)}
          </span>
        </div>
      ))}
    </SettingsList>
  );
}
