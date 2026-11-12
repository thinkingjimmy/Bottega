/**
 * [INPUT]: Depends on Project identity, installed backends, the callable Skills catalog, shared Skills controls, routing, and i18n
 * [OUTPUT]: Provides ProjectSkillsSettings with exact-Project Skill rows, search, force refresh, and personal Library import
 * [POS]: Skills panel in Project Settings; the runtime catalog retains its own scope rules
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useSearchParams } from "react-router";
import { PROJECT_UNAVAILABLE, type Project } from "../../../../../shared/ipc/workspace/projects-ipc";
import type { SkillInfo, SkillsListResult } from "../../../../../shared/ipc/agent/skills-ipc";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import {
  SettingsCanvas,
  SettingsEmpty,
  SettingsList,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { SkillAddButton, SkillRefreshButton } from "@/components/settings/skills/controls/buttons";
import { useSkillImport } from "@/components/settings/skills/controls/use-skill-import";
import { SkillImportDialog } from "@/components/settings/skills/skill-import-dialog";
import { SkillBadge, SkillRow } from "@/components/settings/skills/skill-row";
import { SkillSearch } from "@/components/settings/skills/skill-search";
import { listSkills, onSkillsChanged } from "@/lib/skills/skills-client";

function projectSkillUnion(results: readonly SkillsListResult[], projectId: string) {
  const byRef = new Map<string, SkillInfo>();
  for (const { skills } of results) {
    for (const skill of skills) {
      if (skill.ownerScope.kind === "project" && skill.ownerScope.projectId === projectId) {
        byRef.set(skill.ref, skill);
      }
    }
  }
  return [...byRef.values()].sort((left, right) =>
    (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name)
  );
}

export function ProjectSkillsSettings({ project }: { project: Project }) {
  const { t } = useAppTranslation();
  const [searchParams] = useSearchParams();
  const setup = useSetup();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceUnavailable, setWorkspaceUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const requestSequence = useRef(0);
  const backends = useMemo(
    () => (setup.status?.backends ?? [])
      .filter((backend) => backend.runtimeStatus === "installed")
      .map((backend) => backend.id),
    [setup.status?.backends]
  );

  const load = useCallback(async (forceReload = false) => {
    const request = ++requestSequence.current;
    const current = () => request === requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const results = await Promise.all(backends.map((backend) => listSkills({
        scope: { kind: "project", projectId: project.id },
        backend,
        planMode: false,
        forceReload,
      })));
      if (current()) {
        setSkills(projectSkillUnion(results, project.id));
        setWorkspaceUnavailable(false);
      }
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof Error && cause.message.includes(PROJECT_UNAVAILABLE)) {
        setSkills([]);
        setWorkspaceUnavailable(true);
      } else {
        setError(t("projectSettings.skills.loadFailed"));
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [backends, project.id, t]);

  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (live) void load();
    });
    const unsubscribe = onSkillsChanged(() => void load());
    return () => {
      live = false;
      requestSequence.current += 1;
      unsubscribe();
    };
  }, [load, project.workspaceBinding.kind]);

  const skillImport = useSkillImport({ onImported: () => void load() });
  const noWorkspace = workspaceUnavailable || project.workspaceBinding.kind === "none";
  const needle = query.trim().toLocaleLowerCase();
  const packageIdentity = searchParams.get("package");
  const showSearch = Boolean(skills.length || packageIdentity || query);
  const shown = skills.filter((skill) =>
    (!packageIdentity || skill.extensionInstallIdentity === packageIdentity) &&
    `${skill.name} ${skill.displayName ?? ""} ${skill.description}`.toLocaleLowerCase().includes(needle)
  );

  return (
    <SettingsCanvas>
      <SettingsSection
        action={(
          <div className="ml-auto">
            <SkillAddButton disabled={skillImport.busy} onAdd={() => void skillImport.openDialog()} />
          </div>
        )}
        alert={error || undefined}
        title={t("common.skills")}
        titleAdornment={<SkillRefreshButton busy={loading} onRefresh={() => void load(true)} />}
      >
        {showSearch && <SkillSearch onChange={setQuery} value={query} />}
        {loading && !skills.length ? (
          <p className="flex items-center gap-2 py-8 text-muted-foreground text-sm" role="status">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            {t("common.loadingView")}
          </p>
        ) : shown.length ? (
          <SettingsList>
            {shown.map((skill) => (
              <SkillRow
                badges={<SkillBadge>{t(`projectSettings.skills.badge.${skill.scope}`)}</SkillBadge>}
                description={skill.description}
                key={skill.ref}
                name={skill.displayName ?? skill.name}
              />
            ))}
          </SettingsList>
        ) : showSearch ? (
          <p className="py-12 text-center text-muted-foreground text-sm">
            {t("settings.skills.noMatches")}
          </p>
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
      <SkillImportDialog {...skillImport.dialogProps} />
    </SettingsCanvas>
  );
}
