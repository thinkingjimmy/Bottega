/**
 * [INPUT]: Depends on AppListItem/AppsProvider, upper level progress, open playback, app-state, text mapping, AppDeleteDialog/RepairConfirmDialog, ui card/dropdown, react-router and security outlet IPC
 * [OUTPUT]: Provides AppCard, rendering Base badge, durable import, exclusive continuation/cancellation, Web working mode, common failure repair and deletion of input,
 * [POS]: The app module listing units, the normal mode enters the details, the working mode goes back to the progress bounce window, the recoverability and the de-configuration are directly from AppRecord/operation
 */

import { useState } from "react";
import {
  ExternalLink,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Wrench,
  Trash2,
} from "lucide-react";
import { Link } from "react-router";
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
  cancelOperationLabel,
  isFailedState,
  isPendingBaseImport,
  isWorkingState,
  retryLabel,
  stateLabel,
} from "./app-state";
import { AppDeleteDialog } from "./delete-dialog";
import { RepairConfirmDialog } from "./repair-dialog";
import { errorMessage } from "@/lib/errors";

type AppCardProps = {
  app: AppListItem;
  onOpenProgress: (appId: string) => void;
};

export function AppCard({ app, onOpenProgress }: AppCardProps) {
  const { highlightedId, removeApp, retryApp, repairApp, cancelInstall, revealApp } =
    useApps();
  const [openError, setOpenError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
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
          <span className="text-muted-foreground text-xs">浏览器降级</span>
        </CardHeader>
      </Card>
    );
  }

  const { record } = app;
  const name = record.manifest?.name ?? record.displayName;
  const description =
    record.manifest?.description ?? `正在准备 ${record.displayName}`;
  const icon = record.manifest?.icon ?? "📦";
  const failed = isFailedState(record.state);
  const working = isWorkingState(record.state);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setOpenError("");
    try {
      await action();
      return true;
    } catch (cause) {
      setOpenError(errorMessage(cause, "操作失败"));
      return false;
    } finally {
      setBusy(false);
    }
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
            aria-label={`查看 ${name} 的安装过程`}
            className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => onOpenProgress(record.id)}
          >
            <span className="sr-only">查看 {name} 的安装过程</span>
          </button>
        ) : (
          <Link
            to={`/apps/${record.id}`}
            aria-label={`查看 ${name} 详情`}
            className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="sr-only">查看 {name} 详情</span>
          </Link>
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
                  working && "bg-amber-500/10 text-amber-700",
                  record.state === "ready" &&
                    "bg-emerald-500/10 text-emerald-700"
                )}
              >
                {working && <Spinner className="mr-1 inline size-3" />}
                {stateLabel[record.state]}
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
                {failed ? record.lastError?.message : app.step || "处理中…"}
              </p>
            )}
            {record.agentWarning && (
              <p className="line-clamp-2 text-amber-700 text-xs">
                Agent 警告：{record.agentWarning}
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
                aria-label={`打开源仓库 ${record.sourceRepoUrl}`}
                onClick={() => void act(() => openExternal(record.sourceRepoUrl!))}
                size="icon-sm"
                title={record.sourceRepoUrl}
                type="button"
                variant="ghost"
              >
                <ExternalLink />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="App 菜单"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-max min-w-0">
                {record.state !== "installing" && (
                  <DropdownMenuItem
                    className="cursor-pointer whitespace-nowrap"
                    onSelect={() => void act(() => revealApp(record.id))}
                  >
                    <FolderOpen />
                    在 Finder 中显示
                  </DropdownMenuItem>
                )}
                {isFailedState(record.state) && (
                  <DropdownMenuItem
                    className="cursor-pointer whitespace-nowrap"
                    onSelect={() => void act(() => retryApp(record.id))}
                  >
                    <RefreshCw />
                    {isPendingBaseImport(record)
                      ? "继续安装"
                      : retryLabel[record.state]}
                  </DropdownMenuItem>
                )}
                {isPendingBaseImport(record) && (
                  <DropdownMenuItem
                    variant="destructive"
                    className="cursor-pointer whitespace-nowrap"
                    onSelect={() => void act(() => cancelInstall(record.id))}
                  >
                    <Trash2 />
                    取消安装
                  </DropdownMenuItem>
                )}
                {!isPendingBaseImport(record) && repairSite(record) && (
                  <DropdownMenuItem
                    className="cursor-pointer whitespace-nowrap"
                    onSelect={() => setRepairOpen(true)}
                  >
                    <Wrench />
                    让维护 Agent 诊断修复
                  </DropdownMenuItem>
                )}
                {working && (
                  <DropdownMenuItem
                    variant="destructive"
                    className="cursor-pointer whitespace-nowrap"
                    onSelect={() => void act(() => cancelInstall(record.id))}
                  >
                    <Trash2 />
                    {cancelOperationLabel[app.operation ?? "install"]}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  className="cursor-pointer whitespace-nowrap"
                  // openError 是整张卡共用的：不清一次，上一个动作的失败会
                  // 换个上下文重新出现在删除弹窗里，冤枉了这次操作。
                  onSelect={() => {
                    setOpenError("");
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
      </Card>

      <AppDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        name={name}
        isBase={record.manifest?.kind === "base"}
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
