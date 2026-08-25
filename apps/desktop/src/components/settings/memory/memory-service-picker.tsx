/**
 * [INPUT]: Depends on React ReactNode, lucide status icons, shared descriptor/runtime agreement, settings-layout, memory-view, external/reveal IPC and cn
 * [OUTPUT]: Provides MemoryServicePicker: Tier 2 service option one, each file shows version facts, real running addresses, 44px data/home page actions, data location of the target instance tied to failed feedback and running operations
 * [POS]: The service file for settings/memory; Binary lists are drawn in binary rather than page tags, and are selected by substituting the Consent with the cutover authority of the main.It's a switch subset, not a layer of its brother-in-law surface, and it's a further shrinkage, which is a sign of its relationship
 */

import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  ExternalLink,
  PowerOff,
  RefreshCw,
  FolderOpen,
  XCircle,
} from "lucide-react";
import type {
  MemoryProviderDescriptor,
  MemoryRuntimeSnapshot,
} from "../../../../shared/memory-ipc";
import { openExternal } from "@/lib/agent-client";
import { revealMemoryDataRoot } from "@/lib/memory-client";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsChoiceRow } from "@/components/settings/settings-layout";
import {
  TONE_TEXT,
  memoryProviderStatusView,
  type MemoryCurrentFacts,
  type MemoryStatusLine,
  type MemoryTone,
} from "@/lib/memory-view";
import { cn } from "@ai-chat/ui/lib/utils";

const TONE_ICON: Record<MemoryTone, typeof CircleHelp> = {
  off: PowerOff,
  neutral: CircleHelp,
  ready: CheckCircle2,
  warn: CircleHelp,
  danger: XCircle,
};

/* ============================================================
 * 后端选择走完了下拉 → 双卡 → 页签，这是第四形，也是唯一一形没在
 * 发明新东西的：它就是这个枚举本来的样子。
 *
 * 页签解决了「下面这块归谁」，代价是把二选一画成了「来回切」。可
 * 页签点一下免费且可逆，换服务点一下要签字且回不去——中间隔着一次
 * cutover 披露，以及「Switching back later requires cleanup or a
 * rebuild first」。用一个可以来回拨的控件去表达一次不可逆的选择，
 * 是把代价从界面上抹掉了。
 *
 * 判据这一页自己早就写过，只是当时没往上再走一层：共享范围是三态
 * 枚举，于是两个联动布尔被换成三选一（见 settings-layout 的
 * SettingsChoiceRow）；memory service 是二态枚举，页签是同一种病的
 * 另一副面孔。一个枚举有几档，界面就画几档。
 *
 * 换成二选一之后「浏览态」这个概念整个消失：从前 view 层要自持
 * browsing{ownerProviderId, viewedProviderId}，再派生 viewed /
 * viewedIsCurrent / viewedRuntime 一串，才能回答「我此刻在看谁」。
 * 两档同时在场之后，这个问题不存在了——和当初 sharingSwitchState
 * 那对映射函数同一个死法：最好的状态是不必存在的那个。
 *
 * 它还是开关的子项，不是它的兄弟。provider 在 settings.memory 里就是
 * enabled 隔壁的一个字段，数据模型说的是父子；画成两张并排的卡，视觉
 * 语言就说成了兄弟。凹一档的表面、缩进一步的内容、常驻的组标签，三样
 * 都只为说同一件事：这是「记不记」下面的「存哪儿」。
 * ============================================================ */

export function MemoryServicePicker({
  descriptors,
  runtimes,
  currentId,
  currentFacts,
  open,
  locked,
  onOpenChange,
  onSelect,
  canSelect,
  renderRuntime,
}: {
  descriptors: MemoryProviderDescriptor[];
  runtimes: Record<string, MemoryRuntimeSnapshot | undefined>;
  currentId: string;
  currentFacts: MemoryCurrentFacts;
  open: boolean;
  /** 需要处置时收不起来：折叠永远藏不住一件坏掉的东西。 */
  locked: boolean;
  onOpenChange(next: boolean): void;
  onSelect(providerId: string): void;
  canSelect(providerId: string): boolean;
  renderRuntime(providerId: string): ReactNode;
}) {
  const { t } = useAppTranslation();
  const translate = (key: string, options?: Record<string, unknown>) =>
    t(key, options);
  const current =
    descriptors.find((item) => item.id === currentId) ?? descriptors[0];
  const currentView = memoryProviderStatusView(
    current,
    runtimes[current.id] ?? null,
    currentFacts,
    translate
  );
  const checking = currentFacts.enabled && currentFacts.health === "checking";

  return (
    <div
      data-testid="memory-services"
      data-open={open}
      className="divide-y divide-border bg-sunken"
    >
      {/* 头行：组标签常驻——那几个字就是二级的记号。折叠时它顺带把当前值
          带上（哪一家、它此刻怎么样）；展开后这句话已由选中那档亲口说过，
          于是右侧只剩收起控件。换的是密度，不是层级。 */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="memory-service-options"
        disabled={locked}
        className="flex min-h-11 w-full cursor-pointer touch-manipulation items-center gap-3 py-3 pr-4 pl-8 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset disabled:cursor-default"
        onClick={() => onOpenChange(!open)}
      >
        <span className="font-medium text-muted-foreground text-xs">
          {t("memory.page.serviceTitle")}
        </span>
        {!open && (
          <span className="ml-auto flex min-w-0 items-center gap-2 font-medium text-sm">
            <StatusMark line={currentView} spinning={checking} />
            <span className="truncate">{current.displayName}</span>
            <span className={cn("truncate", TONE_TEXT[currentView.tone])}>
              · {currentView.label}
            </span>
          </span>
        )}
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open ? "rotate-90" : "ml-auto",
            locked && "opacity-40"
          )}
        />
      </button>

      {open && (
        <div
          id="memory-service-options"
          role="radiogroup"
          aria-label={t("memory.backend.aria")}
          className="divide-y divide-border"
        >
          {descriptors.map((descriptor) => {
            const isCurrent = descriptor.id === currentId;
            const runtime = runtimes[descriptor.id] ?? null;
            const view = memoryProviderStatusView(
              descriptor,
              runtime,
              isCurrent ? currentFacts : null,
              translate
            );
            return (
              /* 选中不靠换表面，只靠单选圈——整个抽屉共用同一层 sunken 底，
                 没有「灰白灰」的交替；哪一档在用由 SettingsChoiceRow 的圈说清。 */
              <SettingsChoiceRow
                key={descriptor.id}
                nested
                label={descriptor.displayName}
                description={t(`memory.provider.${descriptor.id}.summary`, {
                  defaultValue: descriptor.summary,
                })}
                checked={isCurrent}
                /* 当前那一档永远可聚焦（它是这组唯一的 Tab 落点），选中它
                   本就是空操作；点不动的只有「还切不过去」的那一档。 */
                disabled={!isCurrent && !canSelect(descriptor.id)}
                onSelect={() => {
                  if (!isCurrent) onSelect(descriptor.id);
                }}
                trailing={
                  <span
                    data-testid={`memory-service-state-${descriptor.id}`}
                    data-tone={view.tone}
                    className={cn(
                      "flex items-center gap-2 font-medium text-xs",
                      TONE_TEXT[view.tone]
                    )}
                  >
                    <StatusMark line={view} spinning={isCurrent && checking} />
                    {view.label}
                  </span>
                }
              >
                <div className="space-y-3">
                  {view.detail && (
                    <p className="max-w-prose text-muted-foreground text-xs leading-relaxed">
                      {view.detail}
                    </p>
                  )}
                  <ProviderFacts
                    descriptor={descriptor}
                    runtime={runtime}
                    target={isCurrent ? currentFacts.target : null}
                    runningVersion={isCurrent ? currentFacts.runningVersion : null}
                  />
                  {renderRuntime(descriptor.id)}
                </div>
              </SettingsChoiceRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 语气决定形状：off 在这里是「它还不存在」，虚线圈与空态同一种语言。
    checking 的转圈也不是装饰——它是「正在问」与「问过了」唯一的区别。 */
function StatusMark({
  line,
  spinning,
}: {
  line: MemoryStatusLine;
  spinning?: boolean;
}) {
  const Icon = spinning
    ? RefreshCw
    : line.tone === "off"
      ? CircleDashed
      : TONE_ICON[line.tone];
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        TONE_TEXT[line.tone],
        spinning && "motion-safe:animate-spin"
      )}
    />
  );
}

/* 事实带：版本只在状态没说过它时才出现（非当前那一档的状态就写着
   「已安装 1.2.1」，再印一遍是回声）；生效地址只有当前那一档才有。 */
function ProviderFacts({
  descriptor,
  runtime,
  target,
  runningVersion,
}: {
  descriptor: MemoryProviderDescriptor;
  runtime: MemoryRuntimeSnapshot | null;
  target: MemoryCurrentFacts["target"];
  runningVersion: string | null | undefined;
}) {
  const { t } = useAppTranslation();
  const [failedTargetKey, setFailedTargetKey] = useState<string | null>(null);
  const targetKey = target
    ? `${descriptor.id}\0${target.providerDataInstanceId ?? target.baseUrl}`
    : null;
  const version = runningVersion ?? runtime?.installedVersion ?? "";
  const showVersion = Boolean(target && runtime?.installed && version);
  if (!showVersion && !target && !descriptor.homepage) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground/80 text-xs">
      {showVersion && <span className="tabular-nums">{version}</span>}
      {runtime?.updateAvailable && (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-primary">
          {t("memory.version.available", { version: runtime.latestVersion })}
        </span>
      )}
      {runtime?.versionSource === "selected" && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-foreground">
          {t("memory.version.selected")}
        </span>
      )}
      {Boolean(
        runtime?.installedVersion &&
        runtime.yankedVersions?.includes(runtime.installedVersion)
      ) && (
        <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-destructive">
          {t("memory.version.yanked")}
        </span>
      )}
      {target && (
        <>
          <span>{t(`memory.health.source.${target.source}`)}</span>
          <span className="truncate font-mono">{target.baseUrl}</span>
        </>
      )}
      {target?.managed && (
        <button
          type="button"
          className="inline-flex min-h-11 touch-manipulation items-center gap-1 rounded-sm px-1 underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => {
            setFailedTargetKey(null);
            void revealMemoryDataRoot(descriptor.id).catch(() => {
              setFailedTargetKey(targetKey);
            });
          }}
        >
          <FolderOpen className="size-3" />
          {t("memory.backend.dataLocation")}
        </button>
      )}
      {target?.managed && failedTargetKey === targetKey && (
        <span role="alert" className="text-destructive">
          {t("memory.backend.dataLocationFailed")}
        </span>
      )}
      {descriptor.homepage && (
        <a
          href={descriptor.homepage}
          className="inline-flex min-h-11 touch-manipulation items-center gap-1 rounded-sm px-1 underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={(event) => {
            event.preventDefault();
            void openExternal(descriptor.homepage!);
          }}
        >
          {t("memory.backend.homepage")}
          <ExternalLink className="size-3" />
        </a>
      )}
    </p>
  );
}
