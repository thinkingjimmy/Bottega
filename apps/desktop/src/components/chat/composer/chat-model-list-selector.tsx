/**
 * [INPUT]: Depends on React, lucide Icons, ui DropdownMenu(Sub/RadioGroup/Portal) /Skeleton/SlimScroller, shared list-only Model directory and chat-model-selection Pure rules
 * [OUTPUT]: Provides ChatModelListSelector; The size of the trigger is only variable with content and width (unchanged geometry, model name omitted), the panel is divided into two lines of Model/Effort abstract, with the secondary menu, which is not configurable and is read-onlyThe directory unarrived triggers with the abstract walk the skeleton screen instead of the text formatting, only the model set submits to show local loading, session streaming feedback back to the Sidebar
 * [POS]: The list-only model controller for chat/composer; Separated from the Codex Rapid Panel, but using its trigger formatting and dual-column option visual language
 */

import { useState } from "react";
import { ChevronDown, LoaderCircle, RotateCw } from "lucide-react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  listModelEffortState,
  optionsForListModel,
} from "@/lib/chat-model-selection";
import type {
  AgentTurnOptions,
  BackendModelInfo,
} from "../../../../shared/agent-ipc";

type ChatModelListSelectorProps = {
  value: AgentTurnOptions;
  models: BackendModelInfo[];
  modelsLoading: boolean;
  modelsError: string;
  settingsError: string;
  disabled?: boolean;
  streaming?: boolean;
  saving?: boolean;
  onChange: (options: AgentTurnOptions) => Promise<void>;
  onRetryModels: () => void;
};

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
  pending,
}: {
  label: string;
  value: string;
  pending: boolean;
}) {
  return (
    <>
      <span className="flex-1 font-medium">{label}</span>
      {pending ? (
        <Skeleton className="h-3.5 w-20 rounded-full" />
      ) : (
        <span className="min-w-0 truncate text-muted-foreground">{value}</span>
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
}: {
  label: string;
  value: string;
  pending: boolean;
  reason?: string;
}) {
  /* 只读不等于次要：值仍然是用户此刻要读的事实，故标签与值的对比度与可下钻
     那行完全同构，两行的差别只有一个——箭头在不在。 */
  return (
    <div title={reason} className={cn("flex items-center px-2", summaryRowClass)}>
      <SummaryFace label={label} value={value} pending={pending} />
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

export function ChatModelListSelector({
  value,
  models,
  modelsLoading,
  modelsError,
  settingsError,
  disabled = false,
  streaming = false,
  saving = false,
  onChange,
  onRetryModels,
}: ChatModelListSelectorProps) {
  const [open, setOpen] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const current =
    models.find((model) => model.slug === value.model) ??
    models.find((model) => model.isDefault);
  const effort = listModelEffortState(value, current);
  const busy = disabled || saving || localBusy;
  const triggerLoading = saving || localBusy || (disabled && !streaming);
  const modelAdjustable = !busy && models.length > 1;
  const effortAdjustable = !busy && effort.adjustable;
  /* 目录未到之前，这一行没有任何依据：模型名无处可取，effort 更是
     listModelEffortState 在空目录上编出来的 "Default"。骨架屏是"还不知道"
     唯一诚实的形状——而 `未知` 与 `已知的默认` 是两件事，后者（目录已到、
     后端确实自选模型）仍旧照实说出"默认模型"。 */
  const pending = modelsLoading && !current;
  const modelName = current?.displayName ?? value.model;
  const modelText = modelName ?? "默认模型";
  const triggerText = pending
    ? "正在读取模型目录"
    : `当前模型 ${modelText}，Effort ${effort.label}`;

  /* 成功即退场，失败才留下：菜单选完就关是菜单的常态，但设置提交是会失败的，
     而错误只在这块面板上有地方说。关得太早等于把回执连同重试一起吞掉。 */
  const commitAndClose = (next: AgentTurnOptions) => {
    setLocalBusy(true);
    void onChange(next)
      .then(() => setOpen(false))
      .catch(() => {})
      .finally(() => setLocalBusy(false));
  };

  return (
    /* 非模态：它长在 Composer 上，身后是随时在流式更新的转录。为选一个模型
       把整页设成 inert，代价与收益不成比例。 */
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        {/* 触发器的几何只是内容的函数：展开只换底色，不换尺寸。宽度一旦改由
            open 决定，长模型名就会在点击时缩回去，而这行本就不该有多余的位移。 */}
        <button
          type="button"
          disabled={busy}
          aria-label={triggerText}
          aria-busy={pending}
          title={pending ? triggerText : `${modelText} · ${effort.label}`}
          className={cn(
            "flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-1.5 font-normal text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
            open ? "bg-muted hover:bg-muted/80" : "hover:bg-muted"
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {/* 名长者让位：模型名省略，Effort 短且不可猜，整块保留 */}
            {pending ? (
              <>
                <Skeleton className="h-3.5 w-16 rounded-full" />
                <Skeleton className="h-3.5 w-8 shrink-0 rounded-full" />
              </>
            ) : (
              <>
                <span className="truncate">{modelText}</span>
                <span className="shrink-0 text-muted-foreground">
                  {effort.label}
                </span>
              </>
            )}
          </span>
          {triggerLoading ? (
            <LoaderCircle
              className="size-4 shrink-0 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </button>
      </DropdownMenuTrigger>
      {/* 面板与触发器共边同宽：下限 15rem 恰好容得下「标签 + 完整模型名 + 箭头」，
          再宽就只是空气——而空气是有代价的，一级越宽，与内容定宽的二级越不像
          同一族。上限 24rem 由最长模型名决定。跟随的是触发器而非自身内容，
          开合才不会晃。 */}
      <DropdownMenuContent
        side="top"
        align="end"
        collisionPadding={VIEWPORT_MARGIN}
        className="min-w-60 max-w-[min(24rem,100vw-2rem)]"
        aria-label="聊天模型选择器"
      >
        {modelAdjustable ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={summaryRowClass}>
              <SummaryFace label="Model" value={modelText} pending={pending} />
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
                      if (model) commitAndClose(optionsForListModel(value, model));
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
                    正在读取模型目录…
                  </p>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ) : (
          <ReadOnlySummaryRow
            label="Model"
            value={modelText}
            pending={pending}
            reason={models.length <= 1 ? "当前只有一个可用模型" : undefined}
          />
        )}
        {effortAdjustable ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={summaryRowClass}>
              <SummaryFace label="Effort" value={effort.label} pending={pending} />
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent
                sideOffset={MENU_PADDING + LEVEL_GAP}
                collisionPadding={VIEWPORT_MARGIN}
                className="max-w-[min(20rem,100vw-2rem)]"
              >
                <SlimScroller className="max-h-[min(16rem,calc(var(--radix-dropdown-menu-content-available-height)-0.5rem))] overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={effort.value ?? ""}
                    onValueChange={(next) =>
                      commitAndClose({
                        ...value,
                        reasoningEffort: next,
                      } as AgentTurnOptions)
                    }
                  >
                    {effort.options.map((option) => (
                      <ChoiceItem
                        key={option.effort}
                        value={option.effort}
                        label={option.label}
                        description={option.description}
                        disabled={busy}
                      />
                    ))}
                  </DropdownMenuRadioGroup>
                </SlimScroller>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ) : (
          <ReadOnlySummaryRow
            label="Effort"
            value={effort.label}
            pending={pending}
            reason={
              effort.options.length <= 1
                ? "当前模型不支持调整 Effort"
                : undefined
            }
          />
        )}
        {!modelsLoading && !modelsError && models.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            未发现可用模型
          </p>
        )}
        {modelsError && (
          <>
            <p
              role="alert"
              className="mt-2 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
            >
              {modelsError}
            </p>
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
              重试模型目录
            </DropdownMenuItem>
          </>
        )}
        {settingsError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {settingsError}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
