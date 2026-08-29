/**
 * [INPUT]: Depends on React state, MemoryRuntimeSnapshot, shared/version-compare ordering, i18n, ui DropdownMenu/ConfirmationDialog, and settings-layout button primitives
 * [OUTPUT]: Provides MemoryVersionPicker — a dropdown that lists the release catalog and a confirmation dialog that states the consequence before switching
 * [POS]: Settings › Memory 的版本入口。挑版本是浏览，切版本才是决定；这里让两者各自成形，不再共用一个弹窗
 */

import { useState } from "react";
import { Check, GitBranch, Loader2 } from "lucide-react";
import type { MemoryRuntimeSnapshot } from "../../../../shared/memory-ipc";
import { compareVersions } from "../../../../shared/version-compare";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsButton,
  SettingsIconButton,
} from "@/components/settings/settings-layout";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { cn } from "@ai-chat/ui/lib/utils";

/* ============================================================
 * 挑版本是浏览，切版本才是决定。
 *
 * 从前这两件事挤在同一个弹窗里：一份 radio 目录 + 一颗「切换版本」。
 * 于是打开它要遮住整页，挑的过程里每一次点击都落在一个已经武装好的
 * 表单上，而真正该被郑重对待的那一下——不可逆的、要停服务重装的那一
 * 下——反而只是这个表单的提交键，和刚才那十几次浏览点击长得一模一样。
 * 一次决定被摊平成了一次滚动。
 *
 * 拆开之后各归其位：目录退回菜单——就地展开、Esc 即走、滚动天然，
 * 浏览本就该这么轻；确认独占一个弹窗，把降级、撤回、未验证三种后果
 * 当面说完再问一次。轻的事轻做，重的事重做。
 *
 * 「最近安装」留在菜单顶部：装错版本之后，回退的目标几乎总是「刚才
 * 那个」，而它此刻埋在几十行目录里。只做两次过滤——当前版本不是回退
 * 目标，目录里已经没有的版本不是可走的路：一个点不动的条目比没有这
 * 个条目更糟。
 * ============================================================ */

const ROLLBACK_LIMIT = 5;

export function MemoryVersionPicker({
  runtime,
  providerName,
  versions,
  listing,
  catalogError,
  disabled,
  /* 该不该长成一颗带文字的按钮：有新版可用时它是这一行最该做的事，
     其余时候它只是一个入口，缩回图标，把注意力让给真正的动作。 */
  prominent,
  busy,
  error,
  onOpen,
  onConfirm,
  onDismiss,
}: {
  runtime: MemoryRuntimeSnapshot;
  /** 标题里点名的那个后端；两家运行时共用这一个入口，标题不许写死一家。 */
  providerName: string;
  versions: string[];
  listing: boolean;
  /** 目录本身读失败/过期时的那句话；它属于这份列表，故住在菜单里。 */
  catalogError?: string | null;
  disabled: boolean;
  prominent: boolean;
  busy: boolean;
  error?: string | null;
  onOpen(): void;
  onConfirm(version: string): void;
  /** 确认弹窗退场：上一次的失败由此清空，退场焦点也由调用方在此接手
      ——切换在后台跑时触发器已变灰，焦点默认归还它就是掉进 body。 */
  onDismiss(): void;
}) {
  const { t } = useAppTranslation();
  /* 待确认的那个版本就是「确认弹窗开着没有」——两个状态说同一件事，
     多出来的那个迟早与它失配。 */
  const [pending, setPending] = useState<string | null>(null);

  const yanked = (version: string) =>
    runtime.yankedVersions?.includes(version) ?? false;
  const rollback = runtime.versionHistory
    .filter(
      (version) =>
        version !== runtime.installedVersion && versions.includes(version)
    )
    .slice(0, ROLLBACK_LIMIT);

  const badges = (version: string) =>
    [
      version === runtime.installedVersion ? t("memory.version.current") : "",
      version === runtime.lockedVersion ? t("memory.version.locked") : "",
      version === runtime.latestVersion ? t("memory.version.latest") : "",
      yanked(version) ? t("memory.version.yanked") : "",
    ]
      .filter(Boolean)
      .join(" · ");

  /* 回退目标会在两个小节里各出现一次，故 key 带上小节名：同名 key 落在
     同一层兄弟里，React 只会保留其中一个。 */
  const item = (section: string) => (version: string) => (
    <DropdownMenuItem
      key={`${section}:${version}`}
      disabled={version === runtime.installedVersion || yanked(version)}
      onSelect={() => setPending(version)}
      className="gap-3"
    >
      {/* 勾留给「就是它」，其余条目留一个等宽的空位——没有它，选中的
          那一行会比别人宽出一个字符，整列文字跟着错位。 */}
      <Check
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0",
          version === runtime.installedVersion ? "opacity-100" : "opacity-0"
        )}
      />
      <span className="flex-1 tabular-nums">{version}</span>
      {badges(version) && (
        <span className="text-muted-foreground text-xs">{badges(version)}</span>
      )}
    </DropdownMenuItem>
  );

  const installedYanked = Boolean(
    runtime.installedVersion && yanked(runtime.installedVersion)
  );
  const staleNotes = [
    catalogError,
    runtime.latestCheckError ? t("memory.version.catalogStaleWarning") : null,
    runtime.latestCheckWarning
      ? t("memory.version.catalogValidationWarning")
      : null,
  ].filter((note): note is string => Boolean(note));

  const downgrade = Boolean(
    pending &&
      runtime.installedVersion &&
      compareVersions(pending, runtime.installedVersion) < 0
  );

  return (
    <>
      <DropdownMenu
        onOpenChange={(next) => {
          if (next) onOpen();
        }}
      >
        <DropdownMenuTrigger asChild>
          {prominent ? (
            <SettingsButton variant="outline" disabled={disabled}>
              <GitBranch />
              {t("memory.version.action")}
            </SettingsButton>
          ) : (
            <SettingsIconButton
              label={t("memory.version.action")}
              disabled={disabled}
            >
              <GitBranch />
            </SettingsIconButton>
          )}
        </DropdownMenuTrigger>
        {/* 目录动辄几十条，菜单自己滚，不把整页顶长。 */}
        <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
          {/* 打开这个菜单最常见的理由就写在最上面：你正在用的那个版本
              已经被撤回了。 */}
          {installedYanked && (
            <p className="px-2 py-1.5 text-amber-700 text-xs leading-relaxed dark:text-amber-400">
              {t("memory.version.currentYanked", {
                version: runtime.installedVersion,
              })}
            </p>
          )}
          {listing && versions.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-3 text-muted-foreground text-xs">
              <Loader2 className="size-3.5 motion-safe:animate-spin" />
              {t("memory.version.loading")}
            </div>
          ) : (
            <>
              {rollback.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    {t("memory.version.historyTitle")}
                  </DropdownMenuLabel>
                  {rollback.map(item("recent"))}
                  <DropdownMenuSeparator />
                </>
              )}
              {versions.map(item("all"))}
            </>
          )}
          {/* 「这份名单可能不准」必须与名单同屏，否则它就是一句没有对象
              的免责声明。 */}
          {staleNotes.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {staleNotes.map((note) => (
                <p
                  key={note}
                  className="px-2 py-1.5 text-muted-foreground text-xs leading-relaxed"
                >
                  {note}
                </p>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmationDialog
        open={pending !== null}
        /* 刻意不传 busy：那会把弹窗焊死，而切换本就在后台跑——面板上有
           真进度条。锁住用户看一个已经搬到别处的进度，是拿模态换焦虑。
           能变的只有那颗确认键：它不该被按第二次。 */
        confirmDisabled={busy}
        cancelLabel={busy ? t("common.close") : undefined}
        title={t("memory.version.confirmTitle", {
          provider: providerName,
          version: pending ?? "",
        })}
        description={
          <span className="space-y-2">
            <span className="block">{t("memory.version.description")}</span>
            {downgrade && (
              <span className="block text-amber-700 dark:text-amber-400">
                {t("memory.version.downgradeWarning")}
              </span>
            )}
            {pending && pending !== runtime.lockedVersion && (
              <span className="block">
                {t("memory.version.unverifiedWarning")}
              </span>
            )}
            {busy && (
              <span className="block">
                {t("memory.version.runningInBackground")}
              </span>
            )}
            {error && (
              <span role="alert" className="block text-destructive">
                {error}
              </span>
            )}
          </span>
        }
        confirmLabel={t("memory.version.confirm", { version: pending ?? "" })}
        onOpenChange={(next) => {
          if (next) return;
          setPending(null);
          onDismiss();
        }}
        onConfirm={() => {
          if (pending) onConfirm(pending);
        }}
      />
    </>
  );
}
