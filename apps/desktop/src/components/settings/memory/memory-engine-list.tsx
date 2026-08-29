/**
 * [INPUT]: Depends on React ReactNode, lucide status/homepage icons, shared descriptor/runtime agreement, settings-layout SettingsChoiceRow/SettingsLabelAction, external navigation, memory-view tone derivation and cn
 * [OUTPUT]: Provides MemoryEngineList: the page's only engine roster — one row per engine naming it, the release it holds or would install (its update reminder alongside) and its current status, whose name owns the project-homepage action, whose full width opens the management drawer, and whose radio knob alone switches which engine holds memory
 * [POS]: settings/memory 的引擎册。开关只说记不记，这里说存哪儿与怎么管；安装、升级、配置都收在这一处，不再有第二张列同一批引擎的表
 */

import type { ReactNode } from "react";
import {
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  ExternalLink,
  PowerOff,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type {
  MemoryProviderDescriptor,
  MemoryRuntimeSnapshot,
} from "../../../../shared/memory-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsChoiceRow,
  SettingsLabelAction,
} from "@/components/settings/settings-layout";
import { openExternal } from "@/lib/agent-client";
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
 * 引擎册取代了从前的「服务抽屉」。
 *
 * 那一版把两档服务锁在一个可折叠的抽屉里，抽屉的头行还要兼职当
 * 当前服务的状态行——一个位置两副面孔。更要命的是同一批引擎在页面上
 * 被列了两遍：上面「用哪个」，下面「装哪个/怎么管」，各说一半，读者
 * 得自己把两处拼起来才知道 EverOS 到底能不能选。
 *
 * 现在只有这一张表。一行 = 一个引擎，行内回答「它是什么、此刻怎么样」，
 * 展开回答「怎么管它」。名字之后紧跟版本——装好的说装的是哪一版，没装
 * 的说装上会得到哪一版，同一个问题的同一个答案位置，两档因此可以直接
 * 比。正常时一行就到此为止：那句「两档差在哪」是给还在挑的人看的，留在
 * 初次设置的第一步。装另一个引擎不是第二个入口，就是这张表里那一行
 * 展开后的动作——列表是完整的，未安装的那档也在场，只是它的抽屉里放的
 * 是安装而不是升级。
 *
 * 单选圈与展开是两件事，故是两颗按钮，但铺法与直觉相反：整行归展开，
 * 圈只占自己那 44px。判据是后果不是控件大小——展开免费、可逆，看完收
 * 起来什么也没发生；换档要签字、回不去。把不可逆的那个铺满整行，一次
 * 好奇心就会变成一次换代；反过来铺，最坏也只是多开一次抽屉。
 *
 * 顺带解开一个死结：还切不过去的那一档，圈是灰的，而它的抽屉里装的
 * 正是让它能切过去的那个动作（安装）。圈铺满整行时，那扇门连同门把手
 * 一起被画灰了。
 * ============================================================ */

export function MemoryEngineList({
  descriptors,
  runtimes,
  currentId,
  currentFacts,
  openId,
  lockedId,
  onOpenChange,
  onSelect,
  canSelect,
  renderManage,
}: {
  descriptors: MemoryProviderDescriptor[];
  runtimes: Record<string, MemoryRuntimeSnapshot | undefined>;
  currentId: string;
  currentFacts: MemoryCurrentFacts;
  /** 哪一档的抽屉摊开着；null = 全部收起。 */
  openId: string | null;
  /** 需要处置的那一档收不起来：折叠永远藏不住一件坏掉的东西。 */
  lockedId: string | null;
  onOpenChange(next: string | null): void;
  onSelect(providerId: string): void;
  canSelect(providerId: string): boolean;
  renderManage(providerId: string): ReactNode;
}) {
  const { t } = useAppTranslation();
  const translate = (key: string, options?: Record<string, unknown>) =>
    t(key, options);
  const checking = currentFacts.enabled && currentFacts.health === "checking";

  return (
    <div
      data-testid="memory-engines"
      role="radiogroup"
      aria-label={t("memory.engines.aria")}
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
        const open = openId === descriptor.id || lockedId === descriptor.id;
        const locked = lockedId === descriptor.id;
        /* 装好的说事实，没装的说意图：锁定版就是「装上它会得到哪一版」。
           而装了却读不出版本时（安装身份待修复），锁定版不是事实——那一
           档宁可不说版本，也不能拿一个号称的版本冒充装着的那个。 */
        const version = runtime?.installed
          ? runtime.installedVersion
          : descriptor.lockedVersion;
        return (
          <SettingsChoiceRow
            key={descriptor.id}
            label={descriptor.displayName}
            /* 版本紧跟名字：它是这一档的身份的一部分（「你要的是哪一版」），
               不是一句需要读完整行才连得上的说明。装好的说装的是哪一版，
               没装的说装上会得到哪一版——同一个问题的同一个答案位置。 */
            labelMeta={
              <>
                {version && (
                  <span
                    data-memory-engine-version=""
                    className="font-mono text-muted-foreground/80 text-xs tabular-nums"
                  >
                    {version}
                  </span>
                )}
                {/* 提醒必须挨着它所提醒的那个数字。它从前住在行尾，与版本
                    隔着半行、中间还夹着状态，读者得自己把两者连起来。 */}
                {runtime?.updateAvailable && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-primary text-xs">
                    {t("memory.engines.updateAvailable")}
                  </span>
                )}
              </>
            }
            labelAction={
              descriptor.homepage ? (
                <SettingsLabelAction
                  label={t("memory.backend.homepage")}
                  onClick={() => void openExternal(descriptor.homepage!)}
                >
                  <ExternalLink />
                </SettingsLabelAction>
              ) : undefined
            }
            /* 一切正常时这一行没有第二句话可说：名字、版本、状态已经把
               「它是什么、此刻怎么样」答完了。描述位只留给病因——而病因
               必须是看得见的文字，不能只挂在徽标的悬停里：那是给鼠标的
               补充，「为什么这一档切不过去」是键盘与读屏用户同样要读到
               的事实。安静本身就是「没有问题」的说法。 */
            description={
              view.detail && (view.tone === "warn" || view.tone === "danger") ? (
                <span className={TONE_TEXT[view.tone]}>{view.detail}</span>
              ) : undefined
            }
            checked={isCurrent}
            /* 当前那一档永远可聚焦（它是这组唯一的 Tab 落点），选中它
               本就是空操作；点不动的只有「还切不过去」的那一档。 */
            disabled={!isCurrent && !canSelect(descriptor.id)}
            onSelect={() => {
              if (!isCurrent) onSelect(descriptor.id);
            }}
            trailing={
              /* 行尾只说此刻怎么样。版本与它的更新提醒都已在行上说过，
                 再复述一遍就是同一个事实的第二次陈述。 */
              <span
                data-testid={`memory-engine-state-${descriptor.id}`}
                data-tone={view.tone}
                title={view.detail ?? undefined}
                className={cn(
                  "flex items-center gap-2 font-medium text-xs",
                  view.detail && "cursor-help",
                  TONE_TEXT[view.tone]
                )}
              >
                <StatusMark line={view} spinning={isCurrent && checking} />
                {isCurrent && view.tone === "ready"
                  ? `${t("memory.engines.inUse")} · ${view.label}`
                  : view.label}
              </span>
            }
            disclosure={{
              open,
              disabled: locked,
              label: t(
                open ? "memory.engines.collapse" : "memory.engines.manage",
                { provider: descriptor.displayName }
              ),
              onToggle: () => onOpenChange(open ? null : descriptor.id),
            }}
          >
            {open ? renderManage(descriptor.id) : null}
          </SettingsChoiceRow>
        );
      })}
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
