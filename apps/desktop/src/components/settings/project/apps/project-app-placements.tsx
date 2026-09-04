"use client";

/**
 * [INPUT]: Depends on Apps/Projects providers, explicit positive Project grants, the shared App authorization dialog, the shared data-level wording, fenced grant commands, shared Card/DropdownMenu primitives, Settings list primitives, and i18n
 * [OUTPUT]: Provides the Project App section — its own SettingsSection, an AppCard-shaped grid, direct Pin/Unpin, and a per-App menu holding permissions and Project removal
 * [POS]: Contextual Project App manager shared by Project Settings and the Sidebar Project shortcut; the card anatomy is the Apps page's, so one App wears one face everywhere
 */

import { useState } from "react";
import {
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  PanelsTopLeft,
  Pin,
  PinOff,
  Plus,
  Unlink,
} from "lucide-react";
import {
  isPositiveAppGrant,
  type AppGrantRecord,
  type AppRecord,
} from "../../../../../shared/apps-ipc";
import type { Project } from "../../../../../shared/projects-ipc";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ai-chat/ui/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { useApps } from "@/components/providers/apps-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AppAuthorizationDialog } from "@/components/apps/authorization/app-authorization-dialog";
import {
  SettingsAlert,
  SettingsBadge,
  SettingsButton,
  SettingsEmpty,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { APP_DATA_LEVEL_KEYS } from "@/components/apps/data-levels";
import { setAppGrantState } from "@/lib/apps-client";
import { errorMessage } from "@/lib/errors";

type AppsSnapshotState = "loading" | "failed" | "ready";

type ProjectAppPlacementRow = Readonly<{
  appId: string;
  record: AppRecord | undefined;
  pinned: boolean;
  unavailable: boolean;
}>;

const canNewPin = (record: AppRecord) =>
  record.state === "ready" && Boolean(record.generationBinding.active);

export function joinProjectAppPlacements(
  project: Project,
  records: readonly AppRecord[],
  snapshotState: AppsSnapshotState
): ProjectAppPlacementRow[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const pinned = new Map(
    project.appPlacements.map((placement) => [placement.appId, placement])
  );
  const candidateIds = new Set(
    project.grants.filter(isPositiveAppGrant).map((grant) => grant.appId)
  );
  return [...candidateIds]
    .map((appId) => ({
      appId,
      record: byId.get(appId),
      pinned: pinned.has(appId),
      unavailable:
        snapshotState === "ready" &&
        (!byId.has(appId) || !canNewPin(byId.get(appId)!)),
    }))
    .sort((left, right) => {
      const leftPinned = pinned.get(left.appId)?.pinnedAt ?? Number.MAX_SAFE_INTEGER;
      const rightPinned = pinned.get(right.appId)?.pinnedAt ?? Number.MAX_SAFE_INTEGER;
      return leftPinned - rightPinned || left.appId.localeCompare(right.appId);
    });
}

export function ProjectAppPlacements({ project }: { project: Project }) {
  const { t } = useAppTranslation();
  const { records, loading, listWarning, refresh } = useApps();
  const { setProjectAppPinned } = useProjects();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [settingsAppId, setSettingsAppId] = useState("");
  const state: AppsSnapshotState = loading
    ? "loading"
    : listWarning
      ? "failed"
      : "ready";
  const rows = joinProjectAppPlacements(project, records, state);
  const target = {
    kind: "project" as const,
    projectId: project.id,
    expectedProjectLifecycleRevision: project.projectLifecycleRevision,
  };

  const act = async (appId: string, action: () => Promise<unknown>, fallback: string) => {
    setPending((current) => ({ ...current, [appId]: true }));
    setErrors((current) => ({ ...current, [appId]: "" }));
    try {
      await action();
    } catch (cause) {
      setErrors((current) => ({
        ...current,
        [appId]: errorMessage(cause) || fallback,
      }));
    } finally {
      setPending((current) => ({ ...current, [appId]: false }));
    }
  };

  const addButton = (
    <SettingsButton onClick={() => setAddOpen(true)}>
      <Plus className="size-4" />
      {t("apps.authorization.selectTitle")}
    </SettingsButton>
  );

  return (
    <SettingsSection
      action={rows.length > 0 ? addButton : undefined}
      description={t("projectSettings.general.appsDescription")}
      title={t("projectSettings.general.appsSection")}
    >
      {state === "loading" && (
        <p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          {t("projectSettings.general.placements.loading")}
        </p>
      )}
      {state === "failed" && (
        <div className="flex items-center justify-between gap-3">
          <SettingsAlert>
            {t("projectSettings.general.placements.failed")}
          </SettingsAlert>
          <SettingsButton onClick={refresh} variant="outline">
            {t("projectSettings.general.placements.retry")}
          </SettingsButton>
        </div>
      )}
      {rows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <ProjectAppCard
              busy={Boolean(pending[row.appId])}
              error={errors[row.appId] ?? ""}
              grant={project.grants.find((entry) => entry.appId === row.appId)}
              key={`${project.id}:${row.appId}`}
              onOpenPermissions={() => setSettingsAppId(row.appId)}
              onRemove={() =>
                void act(
                  row.appId,
                  () =>
                    setAppGrantState({
                      appId: row.appId,
                      target,
                      state: "disabled",
                    }),
                  t("apps.authorization.saveFailed")
                )
              }
              onTogglePin={(pinned) =>
                void act(
                  row.appId,
                  () =>
                    setProjectAppPinned({
                      projectId: project.id,
                      appId: row.appId,
                      pinned,
                      expectedProjectLifecycleRevision:
                        project.projectLifecycleRevision,
                    }),
                  t("projectSettings.general.placements.pinFailed")
                )
              }
              projectId={project.id}
              row={row}
            />
          ))}
        </div>
      )}
      {!loading && rows.length === 0 && (
        <SettingsEmpty
          hint={
            <>
              {t("projectSettings.general.placements.emptyHint")}
              <span className="mt-3 block">{addButton}</span>
            </>
          }
          icon={<PanelsTopLeft />}
          title={t("projectSettings.general.placements.empty")}
        />
      )}
      <AppAuthorizationDialog
        mode="add"
        onOpenChange={setAddOpen}
        open={addOpen}
        target={target}
      />
      {settingsAppId && (
        <AppAuthorizationDialog
          appId={settingsAppId}
          mode="edit"
          onOpenChange={(next) => {
            if (!next) setSettingsAppId("");
          }}
          open
          target={target}
        />
      )}
    </SettingsSection>
  );
}

/* ============================================================
 * Project 里的一张 App 卡：解剖照抄 Apps 页的 AppCard。
 *
 * 同一个 App 在 Apps 页是一张有图标、有名字、右上角带 Pin 与 ⋯ 的卡，
 * 到这里从前缩成一行 14px 的名字加一个开关——它还是同一个东西，界面
 * 却让它像两个。表面 token 本就同源（rounded-lg + bg-card +
 * ring-foreground/10 两处一字不差），所以搬过来不是引入第二种表面，
 * 只是从堆叠改成平铺。
 *
 * 内容不照抄：Apps 页那一行说「这个 App 是什么」，这里说「它能看到
 * 什么」。已经加进来的 App，后者才是用户要的答案。绿色「已就绪」徽标
 * 同理不搬——那一页管生命周期，这一页管授权，一排绿徽标只是噪音。
 *
 * 整卡可点打开权限，与 Apps 页「点卡片打开这个东西」同一条手势；⋯ 里
 * 另有明写的两条出口，「从 Project 移除」尤其重要——它此前只藏在授权
 * 弹窗的编辑态里，想移除一个 App 得先打开一个讲权限的弹窗。
 * ============================================================ */
function ProjectAppCard({
  row,
  grant,
  projectId,
  busy,
  error,
  onTogglePin,
  onOpenPermissions,
  onRemove,
}: {
  row: ProjectAppPlacementRow;
  grant: AppGrantRecord | undefined;
  projectId: string;
  busy: boolean;
  error: string;
  onTogglePin(pinned: boolean): void;
  onOpenPermissions(): void;
  onRemove(): void;
}) {
  const { t } = useAppTranslation();
  const name = row.record?.manifest?.name ?? row.record?.displayName ?? row.appId;
  const icon = row.record?.manifest?.icon ?? "📦";
  const canToggleOn = Boolean(row.record && canNewPin(row.record));
  /* tooltip 说动作（与 Apps 页一字不差），aria-label 说对象（三张卡上
     三颗同名按钮，读屏用户分不出是谁），状态一律交给 aria-pressed。 */
  const pinLabel = t(row.pinned ? "apps.unpin" : "apps.pin");
  const statusId = `project-app-placement-${projectId}-${row.appId}-status`;
  const errorId = `project-app-placement-${projectId}-${row.appId}-error`;

  return (
    <Card className="relative h-full cursor-pointer transition-all hover:bg-accent/40 hover:ring-primary/40 active:bg-accent/60">
      <button
        aria-label={t("apps.authorization.settingsTitle", { name })}
        className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onOpenPermissions}
        type="button"
      />
      {/* CardHeader 自己就是那条横排，外面不再套 flex：多一层容器就多吃一份
          Card 的 gap-(--card-spacing)。items-start 让右上那两颗按钮与图标行
          顶端对齐，而不是浮在整卡的垂直中线上。 */}
      <CardHeader className="pointer-events-none relative z-10 flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-3xl">{icon}</span>
            {row.unavailable && (
              <SettingsBadge tone="warn">
                {t("projectSettings.general.placements.unavailableBadge")}
              </SettingsBadge>
            )}
          </div>
          <CardTitle className="truncate text-base">{name}</CardTitle>
          <CardDescription className="line-clamp-2">
            {row.unavailable
              ? t("projectSettings.general.placements.unavailable")
              : grantSummary(grant, t)}
          </CardDescription>
          {busy && (
            <p className="text-muted-foreground text-xs" id={statusId} role="status">
              {t("projectSettings.general.placements.pending")}
            </p>
          )}
          {error && (
            <p className="text-destructive text-xs" id={errorId} role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-0.5">
          <Button
            aria-describedby={error ? errorId : busy ? statusId : undefined}
            aria-label={t("projectSettings.general.placements.pinControl", { name })}
            aria-pressed={row.pinned}
            disabled={busy || (!row.pinned && !canToggleOn)}
            onClick={() => onTogglePin(!row.pinned)}
            size="icon-sm"
            title={pinLabel}
            type="button"
            variant="ghost"
          >
            {row.pinned ? <PinOff /> : <Pin />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={t("apps.menu")} size="icon-sm" variant="ghost">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-max min-w-0">
              <DropdownMenuItem
                className="whitespace-nowrap"
                onSelect={onOpenPermissions}
              >
                <KeyRound />
                {t("apps.authorization.openPermissions")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="whitespace-nowrap"
                disabled={busy}
                onSelect={onRemove}
                variant="destructive"
              >
                <Unlink />
                {t("apps.authorization.removeFromProject")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
    </Card>
  );
}

function grantSummary(
  grant: AppGrantRecord | undefined,
  t: (key: string, values?: Record<string, unknown>) => string
) {
  if (!grant || !isPositiveAppGrant(grant)) {
    return t("projectSettings.general.placements.noGrant");
  }
  return t("projectSettings.general.placements.grantSummary", {
    grant: t(APP_DATA_LEVEL_KEYS[grant.data?.level ?? "none"]),
    agent: t(
      grant.agentDelegation.fileRead || grant.agentDelegation.useData
        ? "projectSettings.general.placements.agentOn"
        : "projectSettings.general.placements.agentOff"
    ),
  });
}
