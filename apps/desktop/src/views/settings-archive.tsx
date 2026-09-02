/**
 * [INPUT]: Depends on React, route search params and canonical archive locators, archive-client, the optional History warning, shared Archive DTOs, the archive-list presentation module, PageShell, Settings primitives, confirmation dialog, and Tooltip
 * [OUTPUT]: Provides one chronological archived-item list for product Chats and Projects, unified targeted focus/selection/restore, capability-aware delete actions, and a single-container purge confirmation whose only box is the deleted-path evidence, zero-valued facts omitted and Memory rebuild offered as an opt-in checkbox
 * [POS]: Settings archive composition surface; main owns purge authority and read-only entities keep an accessible non-destructive delete boundary
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Archive } from "lucide-react";
import type {
  ArchivePurgeMode,
  ArchiveTarget,
  PurgeMemoryPreview,
  PurgePreview,
} from "../../shared/archive-ipc";
import {
  executePurge,
  previewPurge,
  restoreArchiveTargets,
} from "@/lib/archive-client";
import { useArchive } from "@/components/providers/archive-provider";
import { useOptionalHistory } from "@/components/providers/history/history-provider";
import {
  ArchivedItemRow,
  ArchiveSelectBox,
  archiveRowId,
  type ArchiveListItem,
} from "./settings-archive-list";
import { PageShell } from "@/components/page-shell";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsEmpty,
  SettingsList,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { cn } from "@ai-chat/ui/lib/utils";
import { archiveSettingsTargetKey } from "@/lib/settings-navigation";

const keyOf = (target: ArchiveTarget) => archiveSettingsTargetKey(target);

type PendingPurge = {
  targets: ArchiveTarget[];
  preview: PurgePreview;
  mode: ArchivePurgeMode;
};

/* ============================================================
 * 「Chat Home」是内部词汇：它指这个 Chat 的工作文件夹，用户没有
 * 义务知道我们内部管它叫什么。删除是不可逆操作，说明必须用一遍
 * 就懂的词，否则确认弹窗等于没有确认。
 *
 * 这一片此前是四个圆角容器套着的：弹窗 → 卡片 → 路径块 → 第二张卡。
 * 而常见情形下第一张卡里只装一样东西——包一个东西的盒子不是分组，
 * 是包装。现在正文里只剩一个盒子，就是路径块；它留下不是因为好看，
 * 是因为它是这次操作里唯一不可逆的那份证据。
 *
 * 分组改由排版承担：一条 1px 线切开「删什么」与「Memory 怎么办」，
 * 字重跃迁与留白负责其余层级。一条线比两个圆角容器轻一个量级，
 * 干的却是同一件事。
 * ============================================================ */

/* 一行事实：左边说的是哪一笔，右边是它的值。
   为零的那一笔由调用方整行摘掉，而不是渲染成「0」或「无」——
   「一并删除的 Base 0」在版面上占着与真事实同等的分量，讲的却是
   「什么也没发生」。能消失的分支永远比能写对的分支优雅。 */
function PurgeFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium break-all tabular-nums">
        {value}
      </span>
    </div>
  );
}

/* 路径的层级本身就是信息：前缀说位置，末段说要死的是哪一个文件夹。
   红只染末段——整条都红等于没有重点，而重点恰恰是最后那一节。 */
function PurgePath({ path }: { path: string }) {
  const cut = path.lastIndexOf("/");
  return (
    <div className="font-mono text-xs/[18px] break-all">
      {cut > 0 && (
        <span className="text-muted-foreground">{path.slice(0, cut + 1)}</span>
      )}
      <span className="font-semibold text-destructive">
        {path.slice(cut + 1)}
      </span>
    </div>
  );
}

/* 成本明细：四行「标签 + 值」，不是四行散文。信息量一样，扫读成本
   差一个量级——费用与耗时是要签字的那部分，埋在句子中间等于没写。 */
function RebuildFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3 text-xs/[18px]">
      <span className="w-7 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0", mono && "font-mono break-all")}>
        {value}
      </span>
    </div>
  );
}

function RebuildDetail({ memory }: { memory: PurgeMemoryPreview }) {
  const { t } = useAppTranslation();
  return (
    <>
      <div className="mt-2 space-y-1.5">
        <RebuildFact
          label={t("archive.rebuildScopeLabel")}
          value={t("archive.rebuildScope")}
        />
        <RebuildFact
          label={t("archive.rebuildSizeLabel")}
          value={t("archive.rebuildSize", {
            chats: memory.chats,
            turns: memory.turns,
          })}
        />
        <RebuildFact
          label={t("archive.rebuildTargetLabel")}
          value={`${memory.hostname} · ${memory.model}`}
          mono
        />
        <RebuildFact
          label={t("archive.rebuildImpactLabel")}
          value={t("archive.rebuildImpact")}
        />
      </div>
      <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
        {t("archive.rebuildNote")}
      </p>
    </>
  );
}

export function PurgePreviewDescription({
  preview,
  mode = "local-only",
  onModeChange,
}: {
  preview: PurgePreview;
  mode?: ArchivePurgeMode;
  onModeChange?: (mode: ArchivePurgeMode) => void;
}) {
  const { t } = useAppTranslation();
  const memory = preview.memory;
  const rebuilding = mode === "cleanup-and-rebuild";
  const hasFolders = preview.deletePaths.length > 0;
  const hasBases = preview.pinnedBaseCount > 0;
  const hasRetained = preview.retainedExternalBindings.length > 0;
  return (
    <>
      {/* 红不再泼在这一整段上。它是所有删除确认都要说的那句套话，
          而这次特有的东西是下面那几条路径——红该落在那里。 */}
      <p>
        {t("archive.purgeIrreversible")}
        {hasFolders ? ` ${t("archive.purgeFolders")}` : ""}
      </p>

      {hasFolders && (
        <div className="mt-3 space-y-1 rounded-md bg-destructive/[0.06] px-2.5 py-2">
          {preview.deletePaths.map((path) => (
            <PurgePath key={path} path={path} />
          ))}
        </div>
      )}

      {(hasBases || hasRetained) && (
        <div className="mt-3 space-y-2">
          {hasBases && (
            <PurgeFact
              label={t("archive.basesDeletedLabel")}
              value={preview.pinnedBaseCount}
            />
          )}
          {hasRetained && (
            <PurgeFact
              label={t("archive.retainedLabel")}
              value={preview.retainedExternalBindings.join("、")}
            />
          )}
        </div>
      )}

      {/* 一条 1px 线切开「删什么」与「Memory 怎么办」，替下从前那两张卡 */}
      <div className="my-5 h-px bg-border" />

      {/* 这一句不是选项，是既成事实，所以它没有单选圈，只有一句话。
          从前它顶着一个 radio：给「什么也不额外做」发一个圈，等于把
          默认伪装成选择，于是用户被迫在两个看起来同权的东西里挑一个。 */}
      <p className="font-semibold text-foreground text-sm/5">
        {t("archive.memoryRetainedTitle")}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed">
        {t("archive.memoryRetainedDetail")}
      </p>

      {/* 勾上才浮出那层浅底：容器按需出现，而不是先画好一个盒子再往里
          塞东西。内外边距两态恒定，故切换时文字一像素不动，变的只是
          背景。整个 label 就是命中区，44px 由这一行的实际高度给足。 */}
      <label
        className={cn(
          "mt-4 flex cursor-pointer items-start gap-3 rounded-lg p-3 transition-colors",
          rebuilding && "bg-muted",
          !memory && "cursor-not-allowed opacity-50"
        )}
      >
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-foreground"
          checked={rebuilding}
          disabled={!memory}
          onChange={(event) =>
            onModeChange?.(
              event.currentTarget.checked ? "cleanup-and-rebuild" : "local-only"
            )
          }
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground text-sm/5">
            {t("archive.rebuildTitle")}
          </div>
          {!memory ? (
            <p className="mt-1 text-xs leading-relaxed">
              {t("archive.rebuildUnavailable")}
            </p>
          ) : rebuilding ? (
            <RebuildDetail memory={memory} />
          ) : (
            <p className="mt-1 text-xs leading-relaxed">
              {t("archive.rebuildDetail", {
                chats: memory.chats,
                turns: memory.turns,
              })}
            </p>
          )}
        </div>
      </label>
    </>
  );
}

export function ArchiveSettingsView() {
  const { t } = useAppTranslation();
  const { snapshot, busy, error, run } = useArchive();
  const history = useOptionalHistory();
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingPurge, setPendingPurge] = useState<PendingPurge | null>(null);

  const entities = snapshot.entities;
  const items = useMemo<ArchiveListItem[]>(() => {
    const productItems: ArchiveListItem[] = entities.map((entity) => ({
      key: keyOf(entity.target),
      archivedAt: entity.archivedAt,
      entity,
    }));
    return productItems.sort(
      (left, right) => right.archivedAt - left.archivedAt
    );
  }, [entities]);
  const searchTarget = searchParams.get("target");
  const resolvedSearchTarget = items.some((item) => item.key === searchTarget)
    ? searchTarget
    : null;
  useEffect(() => {
    if (!resolvedSearchTarget) return;
    const row = document.getElementById(archiveRowId(resolvedSearchTarget));
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [resolvedSearchTarget]);
  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.key)),
    [items, selected]
  );
  const selectedTargets = selectedItems.map((item) => item.entity.target);
  const operationBusy = busy;
  const selectionIncludesReadOnly = selectedItems.some(
    (item) => item.entity.readOnly === true
  );

  const commit = async (
    task: Parameters<typeof run>[0],
    clearSelection = true
  ) => {
    const completed = await run(task);
    if (completed && clearSelection) setSelected(new Set());
    return completed;
  };

  /* 标题先说删的是什么：确认页从前只说「所选归档」，而人此刻最需要
     知道的正是「所选」到底是哪几样。三句各自成句而不是一句话里塞
     两个复数——中日英法西的连接词与量词规则不同，硬拼必翻车。 */
  const purgeTitle = (purgeTargets: ArchiveTarget[]) => {
    const projects = purgeTargets.filter(
      (target) => target.kind === "project"
    ).length;
    const chats = purgeTargets.length - projects;
    if (chats && projects) {
      return t("archive.confirmTitleMixed", { chats, projects });
    }
    return projects
      ? t("archive.confirmTitleProjects", { count: projects })
      : t("archive.confirmTitleChats", { count: chats });
  };

  const requestPurge = (nextTargets: ArchiveTarget[]) =>
    commit(async () => {
      const preview = await previewPurge(nextTargets);
      if (preview.blockedReasons.length) {
        throw new Error(preview.blockedReasons.join("；"));
      }
      setPendingPurge({
        targets: [...nextTargets],
        preview,
        mode: "local-only",
      });
      return snapshot;
    }, false);

  const confirmPurge = async () => {
    if (!pendingPurge) return;
    const completed = await commit(() =>
      executePurge(
        pendingPurge.preview.executionToken,
        pendingPurge.targets,
        pendingPurge.mode
      )
    );
    if (completed) setPendingPurge(null);
  };

  const toggle = (key: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  const restoreSelected = async () => {
    if (selectedTargets.length === 0) return;
    if (await run(() => restoreArchiveTargets(selectedTargets))) {
      setSelected(new Set());
    }
  };

  /* ==========================================================
   * 控制条常驻，只有它肚子里的批量动作随选择态出现。
   *
   * 从前它是列表上方一条「选中才存在」的浮动行：一勾中，整张列表
   * 被往下顶 44px——而人此刻的视线正落在刚点的那一行上。工具条自己
   * 制造了它要服务的那次跳动。
   *
   * 现在它是列表卡片的第一行，与行共用同一条 divide 分隔：位置由
   * 表面固定，出现的只是右侧那三颗按钮。左侧那句永远只说「点它会
   * 发生什么」（全选／取消全选），从不复述「共 N 项」——数量是列表
   * 自己会说的事，写一行就是把同一个事实说第二遍。
   *
   * 「清空归档」当年一并删除：它和「全选 + 永久删除」是逐字相同的
   * 调用，一件事有两条路径，早晚会有一条改漏。最危险的操作多按一次，
   * 是好事。
   * ========================================================== */

  const allSelected =
    items.length > 0 && selectedItems.length === items.length;

  // 与侧栏同名：这一页收 Chat、Project 与导入历史，items 才盖得住
  return (
    <PageShell title={t("common.archivedItems")} icon={<Archive />}>
      <SettingsCanvas>
        <div className="space-y-8">
          <SettingsSection
            title={t("archive.sectionTitle")}
            description={t("archive.description")}
            alert={error || history?.warning}
          >
            {items.length === 0 ? (
              <SettingsEmpty
                icon={<Archive />}
                title={t("archive.emptyTitle")}
                hint={t("archive.emptyDetail")}
              />
            ) : (
              <SettingsList data-testid="archive-list">
                <div className="flex items-center gap-2 pr-2 pl-1">
                  <ArchiveSelectBox
                    label={
                      allSelected
                        ? t("archive.deselectAll")
                        : t("archive.selectAll")
                    }
                    showLabel
                    checked={allSelected}
                    indeterminate={selectedItems.length > 0 && !allSelected}
                    disabled={operationBusy}
                    onChange={(checked) =>
                      setSelected(
                        checked
                          ? new Set(items.map((item) => item.key))
                          : new Set()
                      )
                    }
                  />
                  {selectedItems.length > 0 && (
                    <div
                      data-testid="archive-bulk-actions"
                      className="ml-auto flex items-center gap-2"
                    >
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {t("archive.selected", { count: selectedItems.length })}
                      </span>
                      <SettingsButton
                        variant="ghost"
                        disabled={operationBusy}
                        onClick={() => setSelected(new Set())}
                      >
                        {t("archive.clearSelection")}
                      </SettingsButton>
                      <SettingsButton
                        variant="outline"
                        disabled={operationBusy}
                        onClick={() => void restoreSelected()}
                      >
                        {t("archive.restoreSelected")}
                      </SettingsButton>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <SettingsButton
                            data-testid="archive-bulk-delete"
                            variant="destructive"
                            aria-disabled={selectionIncludesReadOnly || undefined}
                            aria-description={
                              selectionIncludesReadOnly
                                ? t("archive.importedDeleteUnavailable")
                                : undefined
                            }
                            disabled={operationBusy}
                            className={cn(
                              selectionIncludesReadOnly &&
                                "cursor-not-allowed bg-transparent text-muted-foreground opacity-50 hover:bg-transparent hover:text-muted-foreground"
                            )}
                            onClick={
                              selectionIncludesReadOnly
                                ? undefined
                                : () => void requestPurge(selectedTargets)
                            }
                          >
                            {t("archive.deleteSelected")}
                          </SettingsButton>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {selectionIncludesReadOnly
                            ? t("archive.importedDeleteUnavailable")
                            : t("archive.deleteSelected")}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>

                {items.map((item) => (
                  <ArchivedItemRow
                    key={item.key}
                    item={item}
                    searchTargeted={resolvedSearchTarget === item.key}
                    checked={selected.has(item.key)}
                    onChange={(checked) => toggle(item.key, checked)}
                    busy={operationBusy}
                    onRestore={() =>
                      void commit(() =>
                        restoreArchiveTargets([item.entity.target])
                      )
                    }
                    onPurge={
                      item.entity.readOnly
                        ? undefined
                        : () => void requestPurge([item.entity.target])
                    }
                  />
                ))}
              </SettingsList>
            )}
          </SettingsSection>
        </div>
      </SettingsCanvas>

      <ConfirmationDialog
        open={pendingPurge !== null}
        title={pendingPurge ? purgeTitle(pendingPurge.targets) : ""}
        description={
          pendingPurge
            ? (
                <PurgePreviewDescription
                  preview={pendingPurge.preview}
                  mode={pendingPurge.mode}
                  onModeChange={(mode) =>
                    setPendingPurge((current) =>
                      current ? { ...current, mode } : current
                    )
                  }
                />
              )
            : null
        }
        confirmLabel={
          pendingPurge?.mode === "cleanup-and-rebuild"
            ? t("archive.confirmRebuild")
            : t("archive.confirmLocal")
        }
        cancelLabel={t("common.cancel")}
        confirmTone="destructive"
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setPendingPurge(null);
        }}
        onConfirm={() => void confirmPurge()}
      />
    </PageShell>
  );
}
