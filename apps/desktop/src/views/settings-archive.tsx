/**
 * [INPUT]: Depends on React, route search params, archive-client, history provider optional snapshots and archiving actions, renderer, current Intl locale, shared Archive/history DTO, PageShell, settings, original language, confirmation dialog, Tooltip and Button
 * [OUTPUT]: Provides a view of the locator focused archive entity settings, a permanent control bar, a kind icon line, a row-level action, two-tier purge, confirmation and imported history archive recovery sections (recovering only, not deleting source files only, read only)
 * [POS]: The following is a list of the most common types of cookies that you can use: Archived search hits fall to focusable entities, parentheses recover unfolded, purge folded by main only executed
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Archive, Folder, MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import type {
  ArchivePurgeMode,
  ArchiveTarget,
  ArchivedEntity,
  PurgePreview,
} from "../../shared/archive-ipc";
import {
  executePurge,
  previewPurge,
  restoreArchiveTargets,
} from "@/lib/archive-client";
import { useArchive } from "@/components/providers/archive-provider";
import { useOptionalHistory } from "@/components/providers/history/history-provider";
import { historyBackend } from "../../shared/history-import-ipc";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { PageShell } from "@/components/page-shell";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsChoiceRow,
  SettingsEmpty,
  SettingsList,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { cn } from "@ai-chat/ui/lib/utils";
import { intlLocale } from "@/lib/i18n-locale";

const keyOf = (target: ArchiveTarget) => `${target.kind}:${target.id}`;
type PendingPurge = {
  targets: ArchiveTarget[];
  preview: PurgePreview;
  mode: ArchivePurgeMode;
};

const formatArchivedAt = (value: number) =>
  new Intl.DateTimeFormat(intlLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

/* 类型列说人话：kind 是内部枚举，成员数是它的限定语，两者同属「这是什么」 */
function entityKind(
  entity: ArchivedEntity,
  t: ReturnType<typeof useAppTranslation>["t"]
) {
  if (entity.target.kind === "project") {
    return t("archive.projectKind", { count: entity.memberCount });
  }
  return t("archive.chatKind");
}

/* ============================================================
 * 「Chat Home」是内部词汇：它指这个 Chat 的工作文件夹，用户没有
 * 义务知道我们内部管它叫什么。删除是不可逆操作，说明必须用一遍
 * 就懂的词，否则确认弹窗等于没有确认。
 *
 * 这一片此前整个是 <span className="block"> 写成的：ConfirmationDialog
 * 的 description 从前落在 <p> 里，而 <p> 只收 phrasing content。方言
 * 已随 app-dialog 改用 <div> 一并退场，卡片与单选组因此能直接用
 * settings 的现成原语，量度也就与设置页对上了。
 * ============================================================ */

const MEMORY_MODE_LABEL_ID = "archive-purge-memory-mode";

/* 一行事实：左边说的是哪一笔，右边是它的值。三笔本是同一族数字，
   此前却是三段各自成段的自由行文——读者得自己把它们认成一组。 */
function PurgeFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="shrink-0 text-muted-foreground text-xs">{label}</span>
      <span className="min-w-0 text-right font-medium text-xs break-all tabular-nums">
        {value}
      </span>
    </div>
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
  return (
    <div className="space-y-3">
      <p className="font-medium text-destructive">
        {t("archive.purgeIrreversible")}
      </p>

      <SettingsList>
        <PurgeFact
          label={t("archive.pinnedBasesLabel")}
          value={preview.pinnedBaseCount}
        />
        <PurgeFact
          label={t("archive.retainedLabel")}
          value={
            preview.retainedExternalBindings.length
              ? preview.retainedExternalBindings.join("、")
              : t("archive.none")
          }
        />
        {/* 路径清单是「将删除的工作文件夹」那一行的证据，故住在它肚子里，
            而不是另起一段——它解释的是哪个数字，位置本身就该说清楚。 */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs">
              {t("archive.deleteFoldersLabel")}
            </span>
            <span className="shrink-0 font-medium text-xs tabular-nums">
              {preview.deletePaths.length}
            </span>
          </div>
          <SlimScroller asChild>
            <div className="mt-2 max-h-40 overflow-y-auto rounded-md bg-muted/60 p-2 font-mono text-xs break-all whitespace-pre-wrap">
              {preview.deletePaths.length
                ? preview.deletePaths.join("\n")
                : t("archive.none")}
            </div>
          </SlimScroller>
        </div>
      </SettingsList>

      <p id={MEMORY_MODE_LABEL_ID} className="font-medium text-foreground">
        {t("archive.memoryMode")}
      </p>
      {/* 两档是一个枚举，不是两个方框：整行命中区、roving tabindex 与
          方向键闭环都焊在 SettingsChoiceRow 里，本页不再自带第四份实现。
          禁用态也归它管——「当前 Memory 目标不可重建」由说明文字讲，
          档位本身灰掉，两件事各说各的那一半。 */}
      <SettingsList role="radiogroup" aria-labelledby={MEMORY_MODE_LABEL_ID}>
        <SettingsChoiceRow
          label={t("archive.localOnlyTitle")}
          description={t("archive.localOnlyDetail")}
          checked={mode === "local-only"}
          onSelect={() => onModeChange?.("local-only")}
        />
        <SettingsChoiceRow
          label={t("archive.rebuildTitle")}
          description={
            memory
              ? t("archive.rebuildDetail", {
                  chats: memory.chats,
                  turns: memory.turns,
                  hostname: memory.hostname,
                  model: memory.model,
                })
              : t("archive.rebuildUnavailable")
          }
          checked={mode === "cleanup-and-rebuild"}
          disabled={!memory}
          onSelect={() => onModeChange?.("cleanup-and-rebuild")}
        />
      </SettingsList>
    </div>
  );
}

/* ============================================================
 * 44px 点击区包住 16px 视觉方块：触控可达，视觉不臃肿。
 * indeterminate 是 DOM property 而非 attribute，只能经 ref 落下。
 *
 * showLabel 只给控制条那一枚用：一个孤零零的方块不说自己管什么，
 * 而这枚管着整张列表。标签仍由 aria-label 播报，摊开的那份因此
 * aria-hidden——同一句话念两遍，读屏用户听到的是「全选 全选」。
 * 文字包在同一个 label 里，于是它和方块是同一个命中区，而不是
 * 「看得见的」与「点得动的」两块。
 * ============================================================ */

function SelectBox({
  label,
  showLabel = false,
  checked,
  indeterminate = false,
  disabled,
  onChange,
}: {
  label: string;
  showLabel?: boolean;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center",
        showLabel && "pr-2",
        disabled && "cursor-not-allowed"
      )}
    >
      <span className="flex size-11 shrink-0 touch-manipulation items-center justify-center">
        <input
          ref={(node) => {
            if (node) node.indeterminate = indeterminate;
          }}
          aria-label={label}
          type="checkbox"
          className="size-4 accent-foreground"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      </span>
      {showLabel && (
        <span aria-hidden="true" className="text-muted-foreground text-xs">
          {label}
        </span>
      )}
    </label>
  );
}

/* 图标 16px，点击区 44px——与同页 checkbox 同一条规矩。
   名字不在视觉里，就必须在可及名里：aria-label 与 tooltip 同文。

   destructive 只染 hover，不染静置：每行都挂一颗，恒亮红就是一整列
   红色贯穿全表，版面重心全押在删除上——而这一页最常做的事是恢复。
   红是「你正指着它」的回答，不是列表的底色。 */
function RowAction({
  label,
  icon,
  destructive = false,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof RotateCcw;
  destructive?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          disabled={disabled}
          className={cn(
            "size-11 touch-manipulation text-muted-foreground",
            destructive && "hover:text-destructive"
          )}
          onClick={onClick}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ArchiveSettingsView() {
  const { t } = useAppTranslation();
  const { snapshot, busy, error, run } = useArchive();
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingPurge, setPendingPurge] = useState<PendingPurge | null>(null);

  const entities = snapshot.entities;
  const searchTarget = searchParams.get("target");
  const resolvedSearchTarget = entities.some((entity) => keyOf(entity.target) === searchTarget)
    ? searchTarget
    : null;
  useEffect(() => {
    if (!resolvedSearchTarget) return;
    const row = document.getElementById(archiveRowId(resolvedSearchTarget));
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [resolvedSearchTarget]);
  const targets = useMemo(
    () =>
      entities
        .filter((entity) => selected.has(keyOf(entity.target)))
        .map((entity) => entity.target),
    [selected, entities]
  );

  const commit = async (
    task: Parameters<typeof run>[0],
    clearSelection = true
  ) => {
    const completed = await run(task);
    if (completed && clearSelection) setSelected(new Set());
    return completed;
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

  const toggle = (target: ArchiveTarget, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(keyOf(target));
      else next.delete(keyOf(target));
      return next;
    });

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

  const allSelected = entities.length > 0 && targets.length === entities.length;

  // 与侧栏同名：这一页收 Chat 与 Project 两种，items 才盖得住
  return (
    <PageShell title={t("common.archivedItems")} icon={<Archive />}>
      <SettingsCanvas>
        <div className="space-y-8">
          <SettingsSection
            title={t("archive.sectionTitle")}
            description={t("archive.description")}
            alert={error}
          >
            {entities.length === 0 ? (
              <SettingsEmpty
                icon={<Archive />}
                title={t("archive.emptyTitle")}
                hint={t("archive.emptyDetail")}
              />
            ) : (
              <SettingsList data-testid="archive-list">
                <div className="flex items-center gap-2 pr-2 pl-1">
                  <SelectBox
                    label={
                      allSelected
                        ? t("archive.deselectAll")
                        : t("archive.selectAll")
                    }
                    showLabel
                    checked={allSelected}
                    indeterminate={targets.length > 0 && !allSelected}
                    disabled={busy}
                    onChange={(checked) =>
                      setSelected(
                        checked
                          ? new Set(entities.map((item) => keyOf(item.target)))
                          : new Set()
                      )
                    }
                  />
                  {targets.length > 0 && (
                    <div
                      data-testid="archive-bulk-actions"
                      className="ml-auto flex items-center gap-2"
                    >
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {t("archive.selected", { count: targets.length })}
                      </span>
                      <SettingsButton
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setSelected(new Set())}
                      >
                        {t("archive.clearSelection")}
                      </SettingsButton>
                      <SettingsButton
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void commit(() => restoreArchiveTargets(targets))
                        }
                      >
                        {t("archive.restoreSelected")}
                      </SettingsButton>
                      <SettingsButton
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void requestPurge(targets)}
                      >
                        {t("archive.deleteSelected")}
                      </SettingsButton>
                    </div>
                  )}
                </div>

                {entities.map((entity) => (
                  <ArchiveRow
                    key={keyOf(entity.target)}
                    entity={entity}
                    searchTargeted={resolvedSearchTarget === keyOf(entity.target)}
                    checked={selected.has(keyOf(entity.target))}
                    onChange={(checked) => toggle(entity.target, checked)}
                    busy={busy}
                    onRestore={() =>
                      void commit(() => restoreArchiveTargets([entity.target]))
                    }
                    onPurge={() => void requestPurge([entity.target])}
                  />
                ))}
              </SettingsList>
            )}
          </SettingsSection>

          <ImportedHistoryArchiveSection />
        </div>
      </SettingsCanvas>

      <ConfirmationDialog
        open={pendingPurge !== null}
        title={
          pendingPurge?.mode === "cleanup-and-rebuild"
            ? t("archive.confirmRebuildTitle")
            : t("archive.confirmTitle")
        }
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

function ArchiveRow({
  entity,
  searchTargeted,
  checked,
  onChange,
  busy,
  onRestore,
  onPurge,
}: {
  entity: ArchivedEntity;
  searchTargeted: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const { t } = useAppTranslation();
  const isProject = entity.target.kind === "project";
  const KindIcon = isProject ? Folder : MessageSquare;
  return (
    <div
      id={archiveRowId(keyOf(entity.target))}
      data-testid="archive-row"
      data-selected={checked}
      data-search-targeted={searchTargeted}
      tabIndex={-1}
      className={cn(
        "flex items-center gap-2 pr-2 pl-1 transition-colors hover:bg-muted/50 focus-visible:outline-none motion-reduce:transition-none",
        searchTargeted && "bg-accent ring-2 ring-inset ring-ring"
      )}
    >
      <SelectBox
        label={t("archive.selectEntity", { title: entity.title })}
        checked={checked}
        disabled={busy}
        onChange={onChange}
      />

      {/* 类型不再占一整列：11 行里 10 行写着同一个词，那不是一列数据，
          是一列复述。一个 16px 图标说完「这是什么」，余量全给名称；
          真正带信息的那一半——Project 的成员数——跟着名字走。
          图标是唯一的类型载体，故它必须有可及名，不能只是装饰。 */}
      <span
        role="img"
        aria-label={entityKind(entity, t)}
        className="flex shrink-0 items-center text-muted-foreground"
      >
        <KindIcon aria-hidden="true" className="size-4" />
      </span>

      <span
        title={entity.title}
        className="min-w-0 flex-1 truncate font-medium text-sm"
      >
        {entity.title}
        {isProject && (
          /* aria-hidden：同一个数已由上面图标的可及名念过一遍 */
          <span aria-hidden="true" className="font-normal text-muted-foreground">
            {" · "}
            {t("archive.chatCount", { count: entity.memberCount })}
          </span>
        )}
      </span>

      {/* 定宽右对齐：行各自是一个 flex 容器，宽度不定死就没有列，
          归档时刻也就无法竖着比——而「哪些是同一天归的」正是这一页
          唯一会被扫读的关系。 */}
      <span className="w-40 shrink-0 truncate text-right text-muted-foreground text-xs tabular-nums">
        {formatArchivedAt(entity.archivedAt)}
      </span>

      <span className="flex shrink-0 items-center">
        <RowAction
          label={t("archive.restoreEntity", { title: entity.title })}
          icon={RotateCcw}
          disabled={busy}
          onClick={onRestore}
        />
        <RowAction
          label={t("archive.deleteEntity", { title: entity.title })}
          icon={Trash2}
          destructive
          disabled={busy}
          onClick={onPurge}
        />
      </span>
    </div>
  );
}

const archiveRowId = (key: string) => `archive-target-${key.replaceAll(":", "-")}`;

/* ============================================================
 * 导入历史的归档段：产品实体走 archive-ipc 的恢复/purge 全家桶，
 * 而外源会话的「归档」只是产品侧 sessionPrefs overlay——源文件只读，
 * 因此这里只有恢复、没有永久删除（删不掉不属于我们的东西，就不许诺）。
 * 只列产品侧归档（productArchivedAt 非空）：源生归档（codex 自己的
 * archived_sessions）不是本应用做的决定，恢复也轮不到本应用。
 * 空则整段消失——这一段是从属陈述，不是常驻主体。
 * ============================================================ */
function ImportedHistoryArchiveSection() {
  const { t } = useAppTranslation();
  const history = useOptionalHistory();
  const [busyId, setBusyId] = useState<string | null>(null);
  const entries = (history?.snapshot.entries ?? [])
    .filter((entry) => entry.productArchivedAt !== null)
    .sort((left, right) => (right.productArchivedAt ?? 0) - (left.productArchivedAt ?? 0));
  if (!history || entries.length === 0) return null;
  return (
    <SettingsSection
      title={t("history.archivedSectionTitle")}
      description={t("history.archivedSectionDescription")}
    >
      <SettingsList data-testid="archive-history-list">
        {entries.map((entry) => (
          <div
            key={entry.opaqueId}
            data-testid="archive-history-row"
            className="flex items-center gap-2 py-1 pr-2 pl-2 transition-colors hover:bg-muted/50 motion-reduce:transition-none"
          >
            <span className="flex shrink-0 items-center text-muted-foreground">
              <AgentBackendIcon
                backend={historyBackend(entry.sourceKind)}
                className="size-4"
                aria-label={backendLabel(historyBackend(entry.sourceKind))}
              />
            </span>
            <span
              title={entry.title}
              className="min-w-0 flex-1 truncate font-medium text-sm"
            >
              {entry.title}
            </span>
            <span className="w-40 shrink-0 truncate text-right text-muted-foreground text-xs tabular-nums">
              {formatArchivedAt(entry.productArchivedAt ?? 0)}
            </span>
            <span className="flex shrink-0 items-center">
              <RowAction
                label={t("history.archivedRestore", { title: entry.title })}
                icon={RotateCcw}
                disabled={busyId === entry.opaqueId}
                onClick={() => {
                  setBusyId(entry.opaqueId);
                  void history
                    .setSessionArchived(entry.opaqueId, false)
                    .catch(() => {})
                    .finally(() => setBusyId(null));
                }}
              />
            </span>
          </div>
        ))}
      </SettingsList>
    </SettingsSection>
  );
}
