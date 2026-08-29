"use client";

/**
 * [INPUT]: Depends on Project contract, Project Personalization client, reusable InstructionsEditor/PathBar, Agent icons, Settings/Tabs primitives, routing, and i18n
 * [OUTPUT]: Provides ProjectInstructionsSection with two file-identity tabs, preserved drafts, workspace-generation conflict handling, and searchable App read-only guidance
 * [POS]: Project Settings Personalization tab; renderer owns drafts while main owns workspace/path/write authority
 */

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { FileText } from "lucide-react";
import type { Project } from "../../../../shared/projects-ipc";
import type {
  ProjectInstructionsErrorCode,
  ProjectInstructionsFile,
  ProjectInstructionsFileId,
  ProjectInstructionsSnapshot,
} from "../../../../shared/personalization-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsAlert,
  SettingsCanvas,
  SettingsEmpty,
  SettingsSection,
} from "@/components/settings/settings-layout";
import {
  InstructionsEditor,
  InstructionsPathBar,
  type InstructionsFileView,
  type InstructionsSaveOutcome,
} from "@/views/settings-personalization";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import {
  hasProjectPersonalizationBridge,
  listProjectInstructions,
  revealProjectInstructions,
  saveProjectInstructions,
} from "@/lib/project-personalization-client";
import { Tabs, TabsList, TabsTrigger } from "@ai-chat/ui/components/ui/tabs";

type FileMap = Partial<Record<ProjectInstructionsFileId, ProjectInstructionsFile>>;
type DraftMap = Partial<Record<ProjectInstructionsFileId, string>>;

export function ProjectInstructionsSection({ project }: { project: Project }) {
  const { t } = useAppTranslation();
  const [files, setFiles] = useState<FileMap>({});
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [selected, setSelected] = useState<ProjectInstructionsFileId>("agents");
  const [finding, setFinding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [workspaceChanged, setWorkspaceChanged] = useState(false);
  const bridge = hasProjectPersonalizationBridge();
  const appId = project.workspaceBinding.kind === "app"
    ? project.workspaceBinding.appId
    : null;

  const adopt = (snapshot: ProjectInstructionsSnapshot, preserveDrafts: boolean) => {
    setFiles(Object.fromEntries(snapshot.files.map((file) => [file.fileId, file])) as FileMap);
    setDrafts((current) => Object.fromEntries(snapshot.files.map((file) => [
      file.fileId,
      preserveDrafts ? current[file.fileId] ?? file.content ?? "" : file.content ?? "",
    ])) as DraftMap);
    setWorkspaceRevision(snapshot.workspaceRevision);
  };

  useEffect(() => {
    if (!bridge || project.workspaceBinding.kind === "none") return;
    let live = true;
    void listProjectInstructions(project.id)
      .then((snapshot) => {
        if (live) adopt(snapshot, false);
      })
      .catch(() => {
        // 读失败就说读失败：saveFailed 是保存通道的话，别借。
        if (live) setLoadError(t("settings.personalization.errors.readFailed"));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [bridge, project.id, project.workspaceBinding.kind, t]);

  if (project.workspaceBinding.kind === "none") {
    return (
      <SettingsCanvas fill>
        <SettingsSection title={t("projectSettings.instructions.section")} description={t("projectSettings.instructions.description")}>
          <SettingsEmpty icon={<FileText />} title={t("projectSettings.instructions.noWorkspace")} hint={t("projectSettings.instructions.description")} />
        </SettingsSection>
      </SettingsCanvas>
    );
  }
  if (!bridge) {
    return (
      <SettingsCanvas fill>
        <SettingsSection title={t("projectSettings.instructions.section")} description={t("projectSettings.instructions.description")}>
          <SettingsAlert>{t("projectSettings.instructions.bridgeMissing")}</SettingsAlert>
        </SettingsSection>
      </SettingsCanvas>
    );
  }
  if (loading || !files[selected]) {
    return (
      <SettingsCanvas fill>
        <SettingsSection title={t("projectSettings.instructions.section")} description={t("projectSettings.instructions.description")} alert={loadError || undefined}>
          {/* 读失败后不再谎称「加载中」：alert 已在段头说明结局。 */}
          {!loadError && (
            <SettingsEmpty icon={<FileText />} title={t("projectSettings.instructions.loading")} hint={t("projectSettings.instructions.description")} />
          )}
        </SettingsSection>
      </SettingsCanvas>
    );
  }

  const file = files[selected]!;
  const appReadOnly = project.workspaceBinding.kind === "app";
  const save = async (
    content: string,
    expectedDigest: string | null
  ): Promise<InstructionsSaveOutcome> => {
    const result = await saveProjectInstructions({
      projectId: project.id,
      fileId: selected,
      content,
      expectedDigest,
      expectedWorkspaceRevision: workspaceRevision,
    });
    if (result.status === "workspace-changed") {
      adopt(result.snapshot, true);
      setWorkspaceChanged(true);
      return { status: "error", code: "workspace-changed" };
    }
    if (result.status === "ok") {
      setWorkspaceRevision(result.workspaceRevision);
      return { status: "ok", file: result.file };
    }
    return result;
  };

  return (
    <SettingsCanvas fill>
      <SettingsSection title={t("projectSettings.instructions.section")} description={t("projectSettings.instructions.description")} alert={loadError || undefined}>
        {workspaceChanged && <SettingsAlert tone="warn">{t("projectSettings.instructions.workspaceChanged")}</SettingsAlert>}
        {appReadOnly && (
          <SettingsAlert tone="warn">
            {t("projectSettings.instructions.appReadOnly")} {" "}
            <Link className="underline underline-offset-2" to={`/apps/${appId}`}>
              {t("projectSettings.instructions.appEditGuide")}
            </Link>
          </SettingsAlert>
        )}
        <Tabs
          className="min-h-0 flex-1 gap-3"
          value={selected}
          onValueChange={(value) => {
            setSelected(value as ProjectInstructionsFileId);
            setFinding(false);
          }}
        >
          <InstructionsEditor
            editorId={selected}
            ariaLabel={file.displayPath}
            advisory={selected === "claude" ? { kind: "lines", value: 200 } : null}
            draft={drafts[selected] ?? ""}
            errorText={(code) => projectInstructionError(t, code)}
            file={file as InstructionsFileView}
            finding={finding}
            header={
              <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b bg-sunken px-3">
                <TabsList variant="line" className="w-fit shrink-0 self-stretch group-data-horizontal/tabs:h-auto">
                  {(["agents", "claude"] as const).map((fileId) => {
                    const candidate = files[fileId];
                    if (!candidate) return null;
                    return (
                      <TabsTrigger className="flex-none cursor-pointer gap-1.5 px-2" key={fileId} value={fileId}>
                        <span>{candidate.displayPath}</span>
                        {candidate.readBy.map((backend) => (
                          <AgentBackendIcon
                            aria-label={backendLabel(backend)}
                            backend={backend}
                            className="size-3"
                            key={backend}
                          />
                        ))}
                        {candidate.content !== null && drafts[fileId] !== candidate.content && (
                          <span aria-hidden className="size-1.5 rounded-full bg-foreground" />
                        )}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                <InstructionsPathBar
                  file={file as InstructionsFileView}
                  findable={file.content !== null}
                  onFind={() => setFinding(true)}
                  onReveal={() => {
                    /* 拒绝定位（如越界文件）时前提带已经在讲这个文件的结局，
                       再挂一条「保存失败」横幅只会说错话。 */
                    void revealProjectInstructions(project.id, file.fileId)
                      .catch(() => undefined);
                  }}
                />
              </div>
            }
            onDraft={(content) => setDrafts((current) => ({ ...current, [selected]: content }))}
            onFile={(next) => setFiles((current) => ({ ...current, [selected]: next as ProjectInstructionsFile }))}
            onFindClose={() => setFinding(false)}
            premise={selected === "claude" && file.content?.trim() === "@AGENTS.md" ? t("projectSettings.instructions.pointerHint") : undefined}
            readOnly={appReadOnly}
            save={save}
          />
        </Tabs>
      </SettingsSection>
    </SettingsCanvas>
  );
}

type Translate = ReturnType<typeof useAppTranslation>["t"];
function projectInstructionError(t: Translate, code: string) {
  const keys: Record<string, string> = {
    conflict: "settings.personalization.errors.conflict",
    "too-large": "settings.personalization.errors.tooLarge",
    "oversized-file": "settings.personalization.errors.oversizedFile",
    "symlink-unresolvable": "settings.personalization.errors.symlinkUnresolvable",
    "read-failed": "settings.personalization.errors.readFailed",
    "write-failed": "settings.personalization.errors.writeFailed",
    "outside-workspace": "projectSettings.instructions.outsideWorkspace",
    "app-managed": "projectSettings.instructions.appManaged",
    "workspace-changed": "projectSettings.instructions.workspaceChanged",
  } satisfies Record<ProjectInstructionsErrorCode | "workspace-changed", string>;
  return t(keys[code] ?? "projectSettings.instructions.saveFailed");
}
