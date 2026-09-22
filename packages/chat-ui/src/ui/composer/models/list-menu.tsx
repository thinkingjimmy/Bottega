/**
 * [INPUT]: Host-computed list-model state and shared menu presentation primitives.
 * [OUTPUT]: Provides the on-demand list-only menu — a flat model list with effort and speed — without moving native commit rules.
 * [POS]: The lazy content behind list.tsx's trigger in the composer models surface; the trigger itself stays in the eager composer.
 */

import { optionsForListModel } from "./selection";
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
import { ModelEffortSubmenu } from "@ai-chat/ui/components/ui/model-menu";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import { LoaderCircle, RotateCw } from "lucide-react";
import type { AgentTurnOptions } from "./contracts";
import type { ModelMenuState } from "./list";
/* ── 摘要行的脸 ────────────────────────────────────────────────
 * 标签吃掉全部余量，值列与右端图标各自定宽——这不只是为了让两行的值
 * 右对齐：`DropdownMenuSubTrigger` 自带一个 `ml-auto` 的箭头，余量若不
 * 被标签吸干，它就会与值列平分空隙，值于是浮在行中间。
 * ────────────────────────────────────────────────────────── */
const summaryRowClass = "min-h-8 gap-2 rounded-lg py-2 text-sm";

/* ── 两级之间的三个数 ──────────────────────────────────────────
 * 内边距不覆写，一律吃 DropdownMenu 原语的 `p-1`——一级与二级同族，
 * 内缩节奏必须同源；各自写各自的，就会得到两种缩进的同一个菜单。
 *
 * 而这 4px 同时是二级菜单的锚点误差：Radix 把二级锚在**行**上，人眼
 * 期待它贴着**面板**。行被内边距往里推了 4px，二级就要补回 4px 才不
 * 重叠——重叠不是审美问题，是两层浮层在争同一块像素的归属。补回之后
 * 再加 4px 气口，与触发器→面板同一节奏：每一级之间都是 4px。
 *
 * 视口留白独立成第三个数：贴着窗沿的菜单读起来像被裁掉了一截。
 * ────────────────────────────────────────────────────────── */
const MENU_PADDING = 4;
const LEVEL_GAP = 4;
const VIEWPORT_MARGIN = 12;

function SummaryFace({
  label,
  value,
  detail,
  pending,
}: {
  label: string;
  value: string;
  detail?: string;
  pending: boolean;
}) {
  return (
    <>
      <span className="flex-1 font-medium">{label}</span>
      {pending ? (
        <Skeleton className="h-3.5 w-20 rounded-full" />
      ) : (
        <span className="min-w-0 text-right text-muted-foreground">
          <span className="block truncate">{value}</span>
          {detail && <span className="block truncate text-xs">{detail}</span>}
        </span>
      )}
    </>
  );
}

/** 不可配置就不画箭头——没有下一级的行不该长着通往下一级的样子。 */
function ReadOnlySummaryRow({
  label,
  value,
  pending,
  reason,
  detail,
}: {
  label: string;
  value: string;
  pending: boolean;
  reason?: string;
  detail?: string;
}) {
  /* 只读不等于次要：值仍然是用户此刻要读的事实，故标签与值的对比度与可下钻
     那行完全同构，两行的差别只有一个——箭头在不在。 */
  return (
    <div title={reason} className={cn("flex items-center px-2", summaryRowClass)}>
      <SummaryFace label={label} value={value} detail={detail} pending={pending} />
      {/* 箭头缺席，但它占的位置要留着，否则两行的值列错开一格 */}
      <span className="size-3.5 shrink-0" aria-hidden="true" />
    </div>
  );
}

function ChoiceItem({
  value,
  label,
  description,
  disabled,
}: {
  value: string;
  label: string;
  description?: string;
  disabled: boolean;
}) {
  return (
    <DropdownMenuRadioItem
      value={value}
      disabled={disabled}
      /* 选中即提交，成功才退场——失败要留在原地把错误说完（见 commitAndClose）。 */
      onSelect={(event) => event.preventDefault()}
      /* 只加 py/text：`px-*` 会把右侧那 32px 一并覆盖，而它是选中标记的
         专属车位，压掉它勾就骑到文字上。 */
      className="py-2 text-sm"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {description && (
          <span className="block truncate text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </DropdownMenuRadioItem>
  );
}


export default function ModelMenu({ state }: { state: ModelMenuState }) {
  const { t, value, models, modelsLoading, modelsError, modelsEmpty, settingsError, onRetryModels, current, effort, speed, effortText, speedText, busy, modelAdjustable, effortAdjustable, speedAdjustable, pending, modelText, speedReason, commitAndClose } = state;
  return (
      <DropdownMenuContent
        side="top"
        align="end"
        collisionPadding={VIEWPORT_MARGIN}
        className="min-w-60 max-w-[min(24rem,100vw-2rem)]"
        aria-label={t("chat.composer.modelSelector.selector")}
      >
        {modelAdjustable ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={summaryRowClass}>
              <SummaryFace label={t("chat.composer.modelSelector.model")} value={modelText} pending={pending} />
            </DropdownMenuSubTrigger>
            {/* 必须过 Portal：父面板自带 `overflow-y-auto`，留在原地的二级菜单
                会被它裁掉一截。 */}
            <DropdownMenuPortal>
              <DropdownMenuSubContent
                sideOffset={MENU_PADDING + LEVEL_GAP}
                collisionPadding={VIEWPORT_MARGIN}
                className="max-w-[min(20rem,100vw-2rem)]"
              >
                {/* 16rem 是舒适上限，可用高度是硬上限——取小者，长目录在矮
                    窗口里才既滚得动又不会顶穿视口。减去的是面板自己的内边距。 */}
                <SlimScroller className="max-h-[min(16rem,calc(var(--radix-dropdown-menu-content-available-height)-0.5rem))] overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={current?.slug ?? ""}
                    onValueChange={(slug) => {
                      const model = models.find((item) => item.slug === slug);
                      if (model) {
                        commitAndClose(optionsForListModel(value, model), true);
                      }
                    }}
                  >
                    {models.map((model) => (
                      <ChoiceItem
                        key={model.slug}
                        value={model.slug}
                        label={model.displayName}
                        disabled={busy}
                      />
                    ))}
                  </DropdownMenuRadioGroup>
                </SlimScroller>
                {modelsLoading && (
                  <p className="mt-1 flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
                    <LoaderCircle
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    {t("chat.composer.modelSelector.loadingModels")}
                  </p>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ) : (
          <ReadOnlySummaryRow
            label={t("chat.composer.modelSelector.model")}
            value={modelText}
            pending={pending}
            reason={models.length <= 1 ? t("chat.composer.modelSelector.onlyOneModel") : undefined}
          />
        )}
        <ModelEffortSubmenu label={t("chat.composer.modelSelector.effort")} value={effortText} selected={effort.value}
          options={effort.options.map(option => ({ id: option.effort, label: option.label, description: option.description }))}
          adjustable={effortAdjustable} disabled={busy} pending={pending}
          reason={effort.options.length <= 1 ? t("chat.composer.modelSelector.effortUnavailable") : undefined}
          onChange={next => commitAndClose({ ...value, ...(current ? { model: current.slug } : {}), reasoningEffort: next } as AgentTurnOptions)} />
        {speed.adjustable && (speedAdjustable ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={summaryRowClass}>
              <SummaryFace
                label={t("chat.composer.modelSelector.speed")}
                value={speedText}
                detail={speedReason}
                pending={pending}
              />
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent
                sideOffset={MENU_PADDING + LEVEL_GAP}
                collisionPadding={VIEWPORT_MARGIN}
                className="max-w-[min(20rem,100vw-2rem)]"
              >
                <DropdownMenuRadioGroup
                  value={speed.value ?? ""}
                  onValueChange={(serviceTier) =>
                    commitAndClose(
                      { ...value, serviceTier } as AgentTurnOptions,
                      true
                    )
                  }
                >
                  {speed.options.map((option) => (
                    <ChoiceItem
                      key={option.id}
                      value={option.id}
                      label={option.displayName}
                      disabled={busy}
                    />
                  ))}
                </DropdownMenuRadioGroup>
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {t("chat.composer.modelSelector.speedDescription")}
                </p>
                {speedReason && (
                  <p role="status" className="px-2 pb-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{speedText}</span>
                    {` · ${speedReason}`}
                  </p>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ) : (
          <ReadOnlySummaryRow
            label={t("chat.composer.modelSelector.speed")}
            value={speedText}
            pending={pending}
            reason={speedReason}
            detail={speedReason}
          />
        ))}
        {/* An empty catalog is a fact, not a failure: it carries the host's reason and no retry. */}
        {!modelsLoading && !modelsError && models.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {modelsEmpty ?? t("chat.composer.modelSelector.noModels")}
          </p>
        )}
        {modelsError && (
          <>
            <div className="mt-2">
              {modelsError}
            </div>
            {/* 重试是这块面板里唯一的动作，必须是 menuitem：菜单里的裸 button
                方向键够不着、Tab 又会把整个菜单关掉，等于摆着不能按。 */}
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onRetryModels();
              }}
              className="mt-1 py-1.5 text-xs"
            >
              <RotateCw className="size-3.5" aria-hidden="true" />
              {t("chat.composer.modelSelector.retryModels")}
            </DropdownMenuItem>
          </>
        )}
        {settingsError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {settingsError}
          </p>
        )}
      </DropdownMenuContent>
  );
}
