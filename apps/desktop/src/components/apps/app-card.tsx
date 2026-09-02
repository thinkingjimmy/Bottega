/**
 * [INPUT]: Depends on AppListItem/AppsProvider, progress, app-state, dialogs, UI card/dropdown, router, surface residence intents, AppWindow icon, shared system-file-manager copy, and external/reveal IPC
 * [OUTPUT]: Provides AppCard with platform-correct Reveal copy, plain waiting-for-access recovery, current-surface navigation, direct Pin/Unpin beside More, lifecycle actions, frozen deletion-dialog identity, and non-cancellable deletion progress
 * [POS]: App listing unit; the badge follows generation readiness without exposing internal terminology, and main-owned navigation focuses an existing Studio instead of rendering twice
 */

import { useState } from "react";
import {
  AppWindowIcon,
  ExternalLink,
  FolderOpen,
  MoreHorizontal,
  Pin,
  PinOff,
  RefreshCw,
  Wrench,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router";
import type { AppListItem } from "@/components/providers/apps-provider";
import { useApps } from "@/components/providers/apps-provider";
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
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";
import { openExternal } from "@/lib/agent-client";
import { repairSite } from "../../../shared/apps-ipc";
import {
  appStateLabelKey,
  cancelOperationLabelKey,
  effectiveAppOperation,
  isAwaitingGeneration,
  isCancelableOperation,
  isFailedState,
  isPendingBaseImport,
  isWorkingState,
  retryLabelKey,
} from "./app-state";
import { AppDeleteDialog } from "./delete-dialog";
import { RepairConfirmDialog } from "./repair-dialog";
import { errorMessage } from "@/lib/errors";
import { appStudioSurface } from "../../../shared/window-surfaces-ipc";
import {
  openSurfaceInWindow,
  showSurface,
} from "@/lib/window-surfaces-client";
import {
  useAppTranslation,
  useSystemFileManagerRevealLabel,
} from "@/components/providers/i18n-provider";

type AppCardProps = {
  app: AppListItem;
  onOpenProgress: (appId: string) => void;
};

export function AppCard({ app, onOpenProgress }: AppCardProps) {
  const { t } = useAppTranslation();
  const revealLabel = useSystemFileManagerRevealLabel();
  const navigate = useNavigate();
  const {
    highlightedId,
    removeApp,
    retryApp,
    repairApp,
    cancelInstall,
    revealApp,
    setPinned,
  } = useApps();
  const [openError, setOpenError] = useState("");
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    name: "",
    isBase: false,
  });
  const [repairOpen, setRepairOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (app.kind === "placeholder") {
    return (
      <Card className="h-full border-dashed opacity-70">
        <CardHeader>
          <div className="mb-1 text-3xl">{app.icon}</div>
          <CardTitle className="text-base">{app.name}</CardTitle>
          <CardDescription className="line-clamp-2">
            {app.description}
          </CardDescription>
          <span className="text-muted-foreground text-xs">
            {t("apps.card.browserFallback")}
          </span>
        </CardHeader>
      </Card>
    );
  }

  const { record } = app;
  const name = record.manifest?.name ?? record.displayName;
  const description =
    record.manifest?.description ??
    (isAwaitingGeneration(record)
      ? t("apps.card.awaitingAuthorization")
      : t("apps.card.preparing", { name: record.displayName }));
  const icon = record.manifest?.icon ?? "📦";
  const failed = isFailedState(record.state);
  const working = isWorkingState(record.state);
  const effectiveOperation = effectiveAppOperation(record, app.operation);
  /* 徽标只在真的成了代时才敢说绿：否则它会和同一张卡上的占位图标、
     「正在准备…」描述当面对质。 */
  const awaitingGeneration = isAwaitingGeneration(record);
  const detailRoute = `/apps/${record.id}/app`;
  const surface = appStudioSurface(record.id);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setOpenError("");
    try {
      await action();
      return true;
    } catch (cause) {
      setOpenError(errorMessage(cause, t("apps.card.operationFailed")));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openCurrent = async () => {
    const result = await showSurface(surface, detailRoute);
    if (!result) navigate(detailRoute);
  };

  const openWindow = async () => {
    const result = await openSurfaceInWindow(surface, record.id, detailRoute);
    if (!result) throw new Error(t("windowSurface.openInWindowUnavailable"));
  };

  return (
    <>
      <Card
        data-app-id={record.id}
        className={cn(
          "relative h-full cursor-pointer transition-all hover:bg-accent/40 hover:ring-primary/40 active:bg-accent/60",
          highlightedId === record.id && "ring-2 ring-primary"
        )}
      >
        {working ? (
          <button
            type="button"
            aria-label={t("apps.card.openProgress", { name })}
            className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => onOpenProgress(record.id)}
          >
            <span className="sr-only">
              {t("apps.card.openProgress", { name })}
            </span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={t("apps.card.openDetails", { name })}
            className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => void act(openCurrent)}
          >
            <span className="sr-only">
              {t("apps.card.openDetails", { name })}
            </span>
          </button>
        )}

        {/* CardHeader 自己就是那条横排：外面再套一层 flex 容器，卡片就有了
            两个直接子元素，于是吃掉 Card 的 gap-(--card-spacing)，白白多出
            一道 16px。层级少一层，空白也少一道。 */}
        <CardHeader className="pointer-events-none relative z-10 flex gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            {/* Base App 徽章退场：卡片已经用图标、标题和描述说清自己是什么，
                再挂一个分类标签是让读者替系统记住一个它不需要的分类。 */}
            <div className="mb-1 flex items-center gap-2">
              <span className="text-3xl">{icon}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px]",
                  failed && "bg-destructive/10 text-destructive",
                  (working || awaitingGeneration) &&
                    "bg-amber-500/10 text-amber-700",
                  record.state === "ready" &&
                    !awaitingGeneration &&
                    "bg-emerald-500/10 text-emerald-700"
                )}
              >
                {working && <Spinner className="mr-1 inline size-3" />}
                {t(appStateLabelKey(record))}
              </span>
            </div>
            <CardTitle className="truncate text-base transition-colors group-hover/card:text-primary">
              {name}
            </CardTitle>
            <CardDescription className="line-clamp-2">
              {description}
            </CardDescription>
            {(working || failed) && (
              <p
                className={cn(
                  "line-clamp-2 text-xs",
                  failed ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {failed
                  ? record.lastError?.message
                  : app.step || t("apps.card.processing")}
              </p>
            )}
            {record.agentWarning && (
              <p className="line-clamp-2 text-amber-700 text-xs">
                {t("apps.card.agentWarning", { warning: record.agentWarning })}
              </p>
            )}
            {/* 错误从前只挂在仓库链接那一段里，没有仓库地址的卡片做任何操作
                失败都无声无息——它属于整张卡，不属于其中一个按钮。 */}
            {openError && (
              <p role="alert" className="text-destructive text-xs">
                {openError}
              </p>
            )}
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-0.5">
            {/* 仓库地址收成图标：它是一条出口，不是卡片要陈述的内容。整行 URL
                在卡片底部既截断又占掉一整行高度，而读者从不需要读它，只需要
                能去。真身留在 title/aria-label 里，鼠标一停就看得见。
                用 ExternalLink 而非 GitHub 标记：sourceRepoUrl 未必是 GitHub，
                挂上品牌图标就是在替来源撒谎。 */}
            {record.sourceRepoUrl && (
              <Button
                aria-label={t("apps.card.openSource", {
                  url: record.sourceRepoUrl,
                })}
                onClick={() => void act(() => openExternal(record.sourceRepoUrl!))}
                size="icon-sm"
                title={record.sourceRepoUrl}
                type="button"
                variant="ghost"
              >
                <ExternalLink />
              </Button>
            )}
            <Button
              aria-label={t(
                record.pinnedAt === null ? "apps.pin" : "apps.unpin"
              )}
              aria-pressed={record.pinnedAt !== null}
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await setPinned(record.id, record.pinnedAt === null);
                })
              }
              size="icon-sm"
              title={t(record.pinnedAt === null ? "apps.pin" : "apps.unpin")}
              type="button"
              variant="ghost"
            >
              {record.pinnedAt === null ? <Pin /> : <PinOff />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("apps.menu")}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-max min-w-0">
                {record.state === "ready" && (
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    onSelect={() => void act(openWindow)}
                  >
                    <AppWindowIcon />
                    {t("windowSurface.openInWindow")}
                  </DropdownMenuItem>
                )}
                {record.state !== "installing" && (
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    onSelect={() => void act(() => revealApp(record.id))}
                  >
                    <FolderOpen />
                    {revealLabel}
                  </DropdownMenuItem>
                )}
                {isFailedState(record.state) && (
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    onSelect={() => void act(() => retryApp(record.id))}
                  >
                    <RefreshCw />
                    {isPendingBaseImport(record)
                      ? t("apps.card.continueInstall")
                      : t(retryLabelKey[record.state])}
                  </DropdownMenuItem>
                )}
                {isPendingBaseImport(record) && (
                  <DropdownMenuItem
                    variant="destructive"
                    className="whitespace-nowrap"
                    onSelect={() => void act(() => cancelInstall(record.id))}
                  >
                    <Trash2 />
                    {t("apps.card.cancelInstall")}
                  </DropdownMenuItem>
                )}
                {!isPendingBaseImport(record) && repairSite(record) && (
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    onSelect={() => setRepairOpen(true)}
                  >
                    <Wrench />
                    {t("apps.card.repair")}
                  </DropdownMenuItem>
                )}
                {working && isCancelableOperation(effectiveOperation) && (
                  <DropdownMenuItem
                    variant="destructive"
                    className="whitespace-nowrap"
                    onSelect={() => void act(() => cancelInstall(record.id))}
                  >
                    <Trash2 />
                    {t(cancelOperationLabelKey[effectiveOperation])}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  className="whitespace-nowrap"
                  // openError 是整张卡共用的：不清一次，上一个动作的失败会
                  // 换个上下文重新出现在删除弹窗里，冤枉了这次操作。
                  onSelect={() => {
                    setOpenError("");
                    /* 删除会先撤掉 active generation，中间快照的 manifest
                       因此为 null。弹窗的题型属于用户刚刚确认的意图，不能
                       跟着生命周期快照从 Base 选择题变成 Web 确认题。 */
                    setDeleteDialog({
                      open: true,
                      name,
                      isBase: record.manifest?.kind === "base",
                    });
                  }}
                >
                  <Trash2 />
                  {t("apps.card.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
      </Card>

      <AppDeleteDialog
        open={deleteDialog.open}
        onOpenChange={(open) =>
          setDeleteDialog((current) => ({ ...current, open }))
        }
        name={deleteDialog.name}
        isBase={deleteDialog.isBase}
        error={openError}
        onDelete={(mode) => act(() => removeApp(record.id, mode))}
      />

      <RepairConfirmDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        busy={busy}
        onConfirm={() =>
          void act(() => repairApp(record.id)).then((ok) => ok && setRepairOpen(false))
        }
      />
    </>
  );
}
